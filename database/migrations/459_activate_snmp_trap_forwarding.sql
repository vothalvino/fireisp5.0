-- =============================================================================

-- Every DDL stage below is restartable. MySQL commits DDL independently, so a
-- process crash before schema_migrations is recorded must not wedge the next
-- deployment on a duplicate column or index.
DELIMITER $$

DROP PROCEDURE IF EXISTS fireisp_459_exec_if_missing$$
CREATE PROCEDURE fireisp_459_exec_if_missing(IN object_count BIGINT, IN ddl_sql TEXT)
BEGIN
    IF object_count = 0 THEN
        SET @fireisp_459_ddl = ddl_sql;
        PREPARE fireisp_459_stmt FROM @fireisp_459_ddl;
        EXECUTE fireisp_459_stmt;
        DEALLOCATE PREPARE fireisp_459_stmt;
        SET @fireisp_459_ddl = NULL;
    END IF;
END$$

DELIMITER ;
-- Migration 459: Activate SNMP trap forwarding with durable delivery tracking
-- =============================================================================

-- Every outbound row snapshots a trigger-managed organization lifecycle epoch.
-- Suspension/archive increments it, so work queued before a revoke can never
-- become eligible merely because the organization is later reactivated. This
-- comparison also works for webhook outboxes stored in an isolated tenant DB.
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'organizations'
        AND column_name = 'outbound_delivery_epoch'),
    'ALTER TABLE organizations ADD COLUMN outbound_delivery_epoch BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT ''Monotonic fence for queued outbound deliveries'' AFTER status'
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries'
        AND column_name = 'organization_epoch'),
    'ALTER TABLE webhook_deliveries ADD COLUMN organization_epoch BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT ''Owning organization outbound-delivery epoch at enqueue'' AFTER webhook_id'
);
-- Rules created before this migration were configuration-only and were never
-- executed. They have not passed the destination/SSRF validation introduced by
-- the working delivery service. Pause every legacy rule so upgrading cannot
-- unexpectedly send traps to a stale address; an operator must review and
-- explicitly re-enable each rule through the validated API/UI.
-- =============================================================================

-- Pre-459 generic CRUD audit snapshots may contain trap destination tokens,
-- webhook signing secrets, or unused legacy template text. Keep a second
-- immutable guard installed while the original trigger is temporarily removed
-- so a crash cannot leave audit history writable. The session-local bypass is
-- lost automatically if the migration connection dies, and IF NOT EXISTS makes
-- this privacy scrub safe to resume after any intermediate statement.
DELIMITER $$

CREATE TRIGGER IF NOT EXISTS trg_audit_logs_459_scrub_guard_bu
BEFORE UPDATE ON audit_logs
FOR EACH ROW
BEGIN
    IF COALESCE(@fireisp_459_audit_scrub, 0) <> 1 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Audit logs are immutable and cannot be updated';
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_audit_logs_immutable_bu$$
SET @fireisp_459_audit_scrub = 1$$

UPDATE audit_logs
SET old_values = JSON_REMOVE(old_values,
        '$.forward_to_url', '$.forward_to_email',
        '$.forward_to_webhook_id', '$.transform_template',
        '$.url', '$.secret', '$.secret_encrypted'),
    new_values = JSON_REMOVE(new_values,
        '$.forward_to_url', '$.forward_to_email',
        '$.forward_to_webhook_id', '$.transform_template',
        '$.url', '$.secret', '$.secret_encrypted')
WHERE entity_type = 'snmp_trap_forwarding_rules'
   OR entity_type = 'webhooks'$$

SET @fireisp_459_audit_scrub = NULL$$

CREATE TRIGGER IF NOT EXISTS trg_audit_logs_immutable_bu
BEFORE UPDATE ON audit_logs
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Audit logs are immutable and cannot be updated';
END$$

DROP TRIGGER IF EXISTS trg_audit_logs_459_scrub_guard_bu$$

DELIMITER ;

CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'snmp_trap_forwarding_rules'
        AND column_name = 'configuration_reviewed_at'),
    'ALTER TABLE snmp_trap_forwarding_rules ADD COLUMN configuration_reviewed_at DATETIME NULL COMMENT ''Set only after the current matcher and destination pass the secure API validator'''
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'snmp_trap_forwarding_rules'
        AND column_name = 'last_delivery_status'),
    'ALTER TABLE snmp_trap_forwarding_rules ADD COLUMN last_delivery_status ENUM(''pending'',''processing'',''retrying'',''success'',''dead_letter'',''cancelled'') NULL COMMENT ''Most recent durable delivery outcome for simple rule-list visibility'''
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'snmp_trap_forwarding_rules'
        AND column_name = 'last_delivery_at'),
    'ALTER TABLE snmp_trap_forwarding_rules ADD COLUMN last_delivery_at DATETIME NULL COMMENT ''Time of the most recent delivery state change'''
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'snmp_trap_forwarding_rules'
        AND column_name = 'last_error'),
    'ALTER TABLE snmp_trap_forwarding_rules ADD COLUMN last_error VARCHAR(500) NULL COMMENT ''Truncated non-sensitive error from the most recent failed delivery'''
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'snmp_trap_forwarding_rules'
        AND column_name = 'last_delivery_is_test'),
    'ALTER TABLE snmp_trap_forwarding_rules ADD COLUMN last_delivery_is_test TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''TRUE when the summary reflects an operator-triggered test rather than a received trap'''
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'snmp_trap_forwarding_rules'
        AND index_name = 'idx_stfr_org_active_deleted'),
    'ALTER TABLE snmp_trap_forwarding_rules ADD INDEX idx_stfr_org_active_deleted (organization_id, is_active, deleted_at)'
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'snmp_trap_forwarding_rules'
        AND index_name = 'idx_stfr_match_ready'),
    'ALTER TABLE snmp_trap_forwarding_rules ADD INDEX idx_stfr_match_ready (organization_id, is_active, deleted_at, configuration_reviewed_at)'
);

UPDATE snmp_trap_forwarding_rules
SET is_active = FALSE,
    configuration_reviewed_at = NULL;

-- Rolling-upgrade safety: an older application version does not know about
-- configuration_reviewed_at. Any old/new writer that changes a matcher,
-- destination, or activation state automatically clears the marker. The new
-- validated API marks it reviewed in a separate UPDATE after its write.
DELIMITER $$

DROP TRIGGER IF EXISTS trg_stfr_clear_review_bu$$
CREATE TRIGGER trg_stfr_clear_review_bu
BEFORE UPDATE ON snmp_trap_forwarding_rules
FOR EACH ROW
BEGIN
    IF NOT (BINARY NEW.match_trap_type <=> BINARY OLD.match_trap_type)
       OR NOT (BINARY NEW.match_source_ip <=> BINARY OLD.match_source_ip)
       OR NOT (BINARY NEW.match_oid_prefix <=> BINARY OLD.match_oid_prefix)
       OR NOT (BINARY NEW.forward_to_url <=> BINARY OLD.forward_to_url)
       OR NOT (BINARY NEW.forward_to_email <=> BINARY OLD.forward_to_email)
       OR NOT (NEW.forward_to_webhook_id <=> OLD.forward_to_webhook_id)
       OR NOT (NEW.is_active <=> OLD.is_active)
       OR NOT (NEW.deleted_at <=> OLD.deleted_at) THEN
        SET NEW.configuration_reviewed_at = NULL;
        SET NEW.last_delivery_status = 'cancelled';
        SET NEW.last_delivery_at = NOW();
        SET NEW.last_error = 'Forwarding rule configuration changed.';
        SET NEW.last_delivery_is_test = FALSE;
    END IF;
END$$

DELIMITER ;

CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'devices'
        AND column_name = 'ip_address_bin'),
    'ALTER TABLE devices ADD COLUMN ip_address_bin VARBINARY(16) GENERATED ALWAYS AS (CASE WHEN IS_IPV4(ip_address) THEN INET6_ATON(ip_address) WHEN IS_IPV6(ip_address) AND IS_IPV4_MAPPED(INET6_ATON(ip_address)) THEN SUBSTR(INET6_ATON(ip_address),13,4) WHEN IS_IPV6(ip_address) THEN INET6_ATON(ip_address) ELSE NULL END) STORED COMMENT ''Canonical indexed primary management address for atomic trap-source locking'''
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'devices'
        AND index_name = 'idx_devices_ip_address_bin'),
    'ALTER TABLE devices ADD INDEX idx_devices_ip_address_bin (ip_address_bin)'
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'devices'
        AND column_name = 'ipv6_address_bin'),
    'ALTER TABLE devices ADD COLUMN ipv6_address_bin VARBINARY(16) GENERATED ALWAYS AS (CASE WHEN IS_IPV4(ipv6_address) THEN INET6_ATON(ipv6_address) WHEN IS_IPV6(ipv6_address) AND IS_IPV4_MAPPED(INET6_ATON(ipv6_address)) THEN SUBSTR(INET6_ATON(ipv6_address),13,4) WHEN IS_IPV6(ipv6_address) THEN INET6_ATON(ipv6_address) ELSE NULL END) STORED COMMENT ''Canonical indexed secondary management address for atomic trap-source locking'''
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'devices'
        AND index_name = 'idx_devices_ipv6_address_bin'),
    'ALTER TABLE devices ADD INDEX idx_devices_ipv6_address_bin (ipv6_address_bin)'
);

-- SNMP communities are shared credentials, never operational event data.
-- Remove historical copies before the API/detail boundary is tightened. This
-- privacy cleanup is deliberately irreversible on rollback.
UPDATE snmp_traps
SET community = NULL
WHERE community IS NOT NULL;

UPDATE snmp_traps
SET varbinds = JSON_ARRAY()
WHERE organization_id IS NULL;

CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'snmp_traps'
        AND column_name = 'varbinds_truncated'),
    'ALTER TABLE snmp_traps ADD COLUMN varbinds_truncated TINYINT(1) NOT NULL DEFAULT 0 AFTER varbinds'
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'snmp_traps'
        AND column_name = 'varbinds_original_count'),
    'ALTER TABLE snmp_traps ADD COLUMN varbinds_original_count SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER varbinds_truncated'
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'snmp_traps'
        AND column_name = 'varbinds_truncation_reason'),
    'ALTER TABLE snmp_traps ADD COLUMN varbinds_truncation_reason ENUM(''count_limit'',''size_limit'',''count_and_size_limit'',''daily_byte_quota'') NULL AFTER varbinds_original_count'
);

-- Trap Forwarding Rules are the only supported external SNMP-trap path. Any
-- generic webhook delivery queued by an older release is terminalized before
-- workers start so upgrade cannot revive the insecure legacy fan-out.
UPDATE webhook_deliveries
SET status = 'dead_letter', next_retry_at = NULL, response_body = NULL
WHERE event_name IN ('device.trap', 'snmp.trap')
  AND status IN ('pending', 'retrying');

-- Pre-upgrade pending rows have neither a securely validated immutable URL
-- snapshot nor an ownership claim. Preserve their audit metadata but never
-- surprise-send them after the delivery engine is hardened.
UPDATE webhook_deliveries
SET status = 'dead_letter', next_retry_at = NULL, response_body = NULL
WHERE status IN ('pending', 'retrying');

-- Older releases stored webhook HMAC secrets as plaintext despite the column
-- name. SQL cannot produce the application's AES-GCM envelope, so fail closed:
-- disable those registrations and erase the plaintext. Re-entering the secret
-- through the upgraded API encrypts it and allows deliberate reactivation.
UPDATE webhooks
SET is_active = FALSE,
    secret_encrypted = NULL
WHERE secret_encrypted IS NOT NULL;

-- Response bodies from tenant-controlled webhook endpoints were previously
-- cached and returned by delivery APIs. They are neither needed nor safe.
UPDATE webhook_deliveries
SET response_body = NULL
WHERE response_body IS NOT NULL;

-- Generic saved-webhook delivery rows use the same durable ownership model:
-- the scheduled sweep only queues IDs and a single worker owns each attempt.
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries'
        AND column_name = 'locked_at'),
    'ALTER TABLE webhook_deliveries ADD COLUMN locked_at DATETIME NULL AFTER next_retry_at'
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries'
        AND column_name = 'claim_token'),
    'ALTER TABLE webhook_deliveries ADD COLUMN claim_token CHAR(36) NULL AFTER locked_at'
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries'
        AND column_name = 'revoked_at'),
    'ALTER TABLE webhook_deliveries ADD COLUMN revoked_at DATETIME NULL COMMENT ''Set when a claimed immutable delivery is revoked; the active claim may finish but cannot be recovered'' AFTER claim_token'
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries'
        AND column_name = 'target_url'),
    'ALTER TABLE webhook_deliveries ADD COLUMN target_url VARCHAR(2048) NULL AFTER payload'
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries'
        AND column_name = 'recovery_count'),
    'ALTER TABLE webhook_deliveries ADD COLUMN recovery_count TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER attempt_number'
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries'
        AND column_name = 'status' AND column_type LIKE '%processing%'),
    'ALTER TABLE webhook_deliveries MODIFY COLUMN status ENUM(''pending'',''processing'',''success'',''failed'',''retrying'',''dead_letter'') NOT NULL DEFAULT ''pending'' COMMENT ''Delivery outcome status'''
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries'
        AND index_name = 'idx_webhook_deliveries_processing'),
    'ALTER TABLE webhook_deliveries ADD INDEX idx_webhook_deliveries_processing (status, locked_at)'
);

CREATE TABLE IF NOT EXISTS snmp_trap_ingest_daily_usage (
    usage_date          DATE NOT NULL,
    scope_type         ENUM('global','organization') NOT NULL,
    scope_id           BIGINT UNSIGNED NOT NULL COMMENT '0 for global; organization ID for organization scope',
    trap_count          BIGINT UNSIGNED NOT NULL DEFAULT 0,
    varbind_bytes       BIGINT UNSIGNED NOT NULL DEFAULT 0,
    delivery_count      BIGINT UNSIGNED NOT NULL DEFAULT 0,
    metadata_only_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    dropped_trap_count  BIGINT UNSIGNED NOT NULL DEFAULT 0,
    forwarding_skipped_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (usage_date, scope_type, scope_id),
    CONSTRAINT chk_snmp_trap_ingest_scope CHECK (
        (scope_type = 'global' AND scope_id = 0)
        OR (scope_type = 'organization' AND scope_id > 0)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Install-wide UTC-day SNMP ingest quota; transaction-locked before trap/outbox persistence';

CREATE TABLE IF NOT EXISTS snmp_trap_forwarding_deliveries (
    id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id    BIGINT UNSIGNED NOT NULL,
    organization_epoch BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Owning organization outbound-delivery epoch at enqueue',
    rule_id             BIGINT UNSIGNED NULL,
    trap_id             BIGINT UNSIGNED NULL,
    webhook_id          BIGINT UNSIGNED NULL,
    target_type         ENUM('url','email','webhook') NOT NULL,
    target_url          VARCHAR(2048) NULL COMMENT 'Immutable URL snapshot; never returned by delivery-list API',
    target_email        VARCHAR(255) NULL COMMENT 'Immutable email snapshot; never returned by delivery-list API',
    payload             JSON NOT NULL COMMENT 'Allowlisted trap metadata only; never community/credentials/varbind values',
    is_test             TINYINT(1) NOT NULL DEFAULT 0,
    status              ENUM('pending','processing','retrying','success','dead_letter','cancelled')
                        NOT NULL DEFAULT 'pending',
    attempt_number      TINYINT UNSIGNED NOT NULL DEFAULT 0,
    max_attempts        TINYINT UNSIGNED NOT NULL DEFAULT 4,
    recovery_count      TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Bounded same-attempt recovery after an ambiguous final worker crash',
    http_status_code    SMALLINT UNSIGNED NULL,
    response_time_ms    INT UNSIGNED NULL,
    last_error          VARCHAR(1000) NULL,
    next_attempt_at     DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at           DATETIME NULL,
    claim_token         CHAR(36) NULL COMMENT 'Per-claim UUID used to reject stale worker outcomes',
    revoked_at          DATETIME NULL COMMENT 'Set when a claimed immutable delivery is revoked; the active claim may finish but cannot be recovered',
    delivered_at        DATETIME NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_stfd_rule_trap (organization_id, rule_id, trap_id),
    KEY idx_stfd_org_created (organization_id, created_at),
    KEY idx_stfd_due (status, next_attempt_at),
    KEY idx_stfd_processing (status, locked_at),
    KEY idx_stfd_rule_created (rule_id, created_at),
    KEY idx_stfd_trap (trap_id),
    KEY idx_stfd_webhook (webhook_id),
    CONSTRAINT fk_stfd_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT fk_stfd_rule FOREIGN KEY (rule_id)
        REFERENCES snmp_trap_forwarding_rules (id) ON DELETE SET NULL ON UPDATE RESTRICT,
    CONSTRAINT fk_stfd_trap FOREIGN KEY (trap_id)
        REFERENCES snmp_traps (id) ON DELETE SET NULL ON UPDATE RESTRICT,
    CONSTRAINT fk_stfd_webhook FOREIGN KEY (webhook_id)
        REFERENCES webhooks (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT chk_stfd_target_shape CHECK (
        (target_type = 'email' AND target_email IS NOT NULL AND target_url IS NULL AND webhook_id IS NULL)
        OR (target_type = 'url' AND target_url IS NOT NULL AND target_email IS NULL AND webhook_id IS NULL)
        OR (target_type = 'webhook' AND target_url IS NOT NULL AND target_email IS NULL AND webhook_id IS NOT NULL)
    ),
    CONSTRAINT chk_stfd_attempts CHECK (
        max_attempts BETWEEN 1 AND 11 AND attempt_number <= max_attempts
        AND recovery_count <= 1
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'snmp_trap_forwarding_deliveries'
        AND column_name = 'recovery_count'),
    'ALTER TABLE snmp_trap_forwarding_deliveries ADD COLUMN recovery_count TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT ''Bounded same-attempt recovery after an ambiguous final worker crash'' AFTER max_attempts'
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'snmp_trap_forwarding_deliveries'
        AND column_name = 'organization_epoch'),
    'ALTER TABLE snmp_trap_forwarding_deliveries ADD COLUMN organization_epoch BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT ''Owning organization outbound-delivery epoch at enqueue'' AFTER organization_id'
);
CALL fireisp_459_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'snmp_trap_forwarding_deliveries'
        AND column_name = 'revoked_at'),
    'ALTER TABLE snmp_trap_forwarding_deliveries ADD COLUMN revoked_at DATETIME NULL COMMENT ''Set when a claimed immutable delivery is revoked; the active claim may finish but cannot be recovered'' AFTER claim_token'
);

-- Serialize webhook activation against the owning organization row. The
-- trigger is the race-safe boundary; dispatch also applies the same hard cap
-- so any pre-existing excess registrations cannot create unbounded fan-out.
DELIMITER $$

DROP TRIGGER IF EXISTS trg_stfr_active_limit_bi$$
CREATE TRIGGER trg_stfr_active_limit_bi
BEFORE INSERT ON snmp_trap_forwarding_rules
FOR EACH ROW
BEGIN
    DECLARE v_owner BIGINT UNSIGNED;
    DECLARE v_active BIGINT UNSIGNED;
    IF NEW.is_active = 1 AND NEW.deleted_at IS NULL THEN
        SELECT id INTO v_owner FROM organizations
         WHERE id = NEW.organization_id FOR UPDATE;
        SELECT COUNT(*) INTO v_active FROM snmp_trap_forwarding_rules
         WHERE organization_id = NEW.organization_id
           AND is_active = 1 AND deleted_at IS NULL;
        IF v_active >= 100 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'An organization may have at most 100 active trap forwarding rules';
        END IF;
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_stfr_active_limit_bu$$
CREATE TRIGGER trg_stfr_active_limit_bu
BEFORE UPDATE ON snmp_trap_forwarding_rules
FOR EACH ROW
BEGIN
    DECLARE v_owner BIGINT UNSIGNED;
    DECLARE v_active BIGINT UNSIGNED;
    IF NEW.is_active = 1 AND NEW.deleted_at IS NULL
       AND (OLD.is_active <> 1 OR OLD.deleted_at IS NOT NULL) THEN
        SELECT id INTO v_owner FROM organizations
         WHERE id = NEW.organization_id FOR UPDATE;
        SELECT COUNT(*) INTO v_active FROM snmp_trap_forwarding_rules
         WHERE organization_id = NEW.organization_id
           AND is_active = 1 AND deleted_at IS NULL AND id <> OLD.id;
        IF v_active >= 100 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'An organization may have at most 100 active trap forwarding rules';
        END IF;
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_webhooks_active_limit_bi$$
CREATE TRIGGER trg_webhooks_active_limit_bi
BEFORE INSERT ON webhooks
FOR EACH ROW
BEGIN
    DECLARE v_owner BIGINT UNSIGNED;
    DECLARE v_active BIGINT UNSIGNED;
    IF NEW.is_active = 1 AND NEW.deleted_at IS NULL THEN
        SELECT id INTO v_owner FROM organizations
         WHERE id = NEW.organization_id FOR UPDATE;
        SELECT COUNT(*) INTO v_active FROM webhooks
         WHERE organization_id = NEW.organization_id
           AND is_active = 1 AND deleted_at IS NULL;
        IF v_active >= 50 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'An organization may have at most 50 active webhooks';
        END IF;
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_webhooks_active_limit_bu$$
CREATE TRIGGER trg_webhooks_active_limit_bu
BEFORE UPDATE ON webhooks
FOR EACH ROW
BEGIN
    DECLARE v_owner BIGINT UNSIGNED;
    DECLARE v_active BIGINT UNSIGNED;
    IF NEW.is_active = 1 AND NEW.deleted_at IS NULL
       AND (OLD.is_active <> 1 OR OLD.deleted_at IS NOT NULL) THEN
        SELECT id INTO v_owner FROM organizations
         WHERE id = NEW.organization_id FOR UPDATE;
        SELECT COUNT(*) INTO v_active FROM webhooks
         WHERE organization_id = NEW.organization_id
           AND is_active = 1 AND deleted_at IS NULL AND id <> OLD.id;
        IF v_active >= 50 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'An organization may have at most 50 active webhooks';
        END IF;
    END IF;
END$$

-- Revocation is atomic with configuration mutation. A processing attempt owns
-- its immutable snapshot and may finish once, but its durable marker prevents
-- a crashed attempt from being reclaimed after an A-to-B-to-A configuration
-- change. Every unclaimed row is cancelled before the mutation commits.
DROP TRIGGER IF EXISTS trg_stfr_cancel_unclaimed_bu$$
CREATE TRIGGER trg_stfr_cancel_unclaimed_bu
AFTER UPDATE ON snmp_trap_forwarding_rules
FOR EACH ROW
BEGIN
    IF NOT (BINARY NEW.match_trap_type <=> BINARY OLD.match_trap_type)
       OR NOT (BINARY NEW.match_source_ip <=> BINARY OLD.match_source_ip)
       OR NOT (BINARY NEW.match_oid_prefix <=> BINARY OLD.match_oid_prefix)
       OR NOT (BINARY NEW.forward_to_url <=> BINARY OLD.forward_to_url)
       OR NOT (BINARY NEW.forward_to_email <=> BINARY OLD.forward_to_email)
       OR NOT (NEW.forward_to_webhook_id <=> OLD.forward_to_webhook_id)
       OR NOT (NEW.is_active <=> OLD.is_active)
       OR NOT (NEW.deleted_at <=> OLD.deleted_at) THEN
        UPDATE snmp_trap_forwarding_deliveries
           SET status = 'cancelled', next_attempt_at = NULL,
               locked_at = NULL, claim_token = NULL,
               last_error = 'Forwarding rule configuration changed.'
         WHERE rule_id = OLD.id AND organization_id = OLD.organization_id
           AND status IN ('pending','retrying');
        UPDATE snmp_trap_forwarding_deliveries
           SET revoked_at = COALESCE(revoked_at, NOW())
         WHERE rule_id = OLD.id AND organization_id = OLD.organization_id
           AND status = 'processing';
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_webhooks_cancel_trap_unclaimed_bu$$
CREATE TRIGGER trg_webhooks_cancel_trap_unclaimed_bu
AFTER UPDATE ON webhooks
FOR EACH ROW
BEGIN
    IF NOT (BINARY NEW.url <=> BINARY OLD.url)
       OR NOT (NEW.is_active <=> OLD.is_active)
       OR NOT (NEW.deleted_at <=> OLD.deleted_at) THEN
        UPDATE snmp_trap_forwarding_deliveries
           SET status = 'cancelled', next_attempt_at = NULL,
               locked_at = NULL, claim_token = NULL,
               last_error = 'Registered webhook configuration changed.'
         WHERE webhook_id = OLD.id AND organization_id = OLD.organization_id
           AND status IN ('pending','retrying');
        UPDATE snmp_trap_forwarding_deliveries
           SET revoked_at = COALESCE(revoked_at, NOW())
         WHERE webhook_id = OLD.id AND organization_id = OLD.organization_id
           AND status = 'processing';
        UPDATE webhook_deliveries
           SET status = 'dead_letter', next_retry_at = NULL,
               locked_at = NULL, claim_token = NULL, response_body = NULL
         WHERE webhook_id = OLD.id
           AND status IN ('pending','retrying');
        UPDATE webhook_deliveries
           SET revoked_at = COALESCE(revoked_at, NOW())
         WHERE webhook_id = OLD.id AND status = 'processing';
        UPDATE snmp_trap_forwarding_rules
           SET last_delivery_status = 'cancelled', last_delivery_at = NOW(),
               last_error = 'Registered webhook configuration changed.',
               last_delivery_is_test = FALSE
         WHERE organization_id = OLD.organization_id
           AND forward_to_webhook_id = OLD.id AND deleted_at IS NULL;
    END IF;
END$$

-- Direct SQL writers and old application versions cannot bypass lifecycle
-- revocation. The BEFORE trigger owns the epoch; the AFTER trigger immediately
-- terminalizes primary outboxes and their rule summaries. Isolated generic
-- outboxes carry the old epoch and are terminalized by their next claim.
DROP TRIGGER IF EXISTS trg_organizations_outbound_epoch_bu$$
CREATE TRIGGER trg_organizations_outbound_epoch_bu
BEFORE UPDATE ON organizations
FOR EACH ROW
BEGIN
    IF NOT (NEW.status <=> OLD.status)
       OR NOT (NEW.deleted_at <=> OLD.deleted_at) THEN
        SET NEW.outbound_delivery_epoch = OLD.outbound_delivery_epoch + 1;
    ELSE
        SET NEW.outbound_delivery_epoch = OLD.outbound_delivery_epoch;
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_organizations_cancel_outbound_au$$
CREATE TRIGGER trg_organizations_cancel_outbound_au
AFTER UPDATE ON organizations
FOR EACH ROW
BEGIN
    IF NEW.outbound_delivery_epoch <> OLD.outbound_delivery_epoch THEN
        UPDATE snmp_trap_forwarding_deliveries
           SET status = 'cancelled', next_attempt_at = NULL,
               locked_at = NULL, claim_token = NULL,
               last_error = 'Organization lifecycle changed after this delivery was queued.'
         WHERE organization_id = OLD.id
           AND organization_epoch <> NEW.outbound_delivery_epoch
           AND status IN ('pending','retrying');
        UPDATE webhook_deliveries wd
          JOIN webhooks w ON w.id = wd.webhook_id
           SET wd.status = 'dead_letter', wd.next_retry_at = NULL,
               wd.locked_at = NULL, wd.claim_token = NULL,
               wd.response_body = NULL
         WHERE w.organization_id = OLD.id
           AND wd.organization_epoch <> NEW.outbound_delivery_epoch
           AND wd.status IN ('pending','retrying');
        UPDATE snmp_trap_forwarding_rules
           SET last_delivery_status = 'cancelled', last_delivery_at = NOW(),
               last_error = 'Organization lifecycle changed after this delivery was queued.',
               last_delivery_is_test = FALSE
         WHERE organization_id = OLD.id AND deleted_at IS NULL;
    END IF;
END$$

DELIMITER ;

INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('snmp_traps.payload.view', 'View raw SNMP trap varbind values (community is never stored)', 'monitoring');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
  ON p.name = 'snmp_traps.payload.view'
WHERE r.name IN ('admin', 'super_admin') AND r.deleted_at IS NULL;

UPDATE scheduled_tasks
SET description = 'Process due registered-webhook and SNMP trap-forwarding deliveries, rescheduling retryable failures and dead-lettering exhausted attempts.'
WHERE task_name = 'webhook_retry';

-- Refuse to record a partially-created migration as complete. CREATE TABLE is
-- atomic, while the guarded ALTER stages above are safe to rerun after a crash.
DELIMITER $$

DROP PROCEDURE IF EXISTS fireisp_459_assert_complete$$
CREATE PROCEDURE fireisp_459_assert_complete()
BEGIN
    IF (SELECT COUNT(*) FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND ((table_name = 'snmp_trap_forwarding_rules' AND column_name IN
                 ('configuration_reviewed_at','last_delivery_status','last_delivery_at','last_error','last_delivery_is_test'))
             OR (table_name = 'devices' AND column_name IN ('ip_address_bin','ipv6_address_bin'))
             OR (table_name = 'snmp_trap_forwarding_deliveries' AND column_name IN
                 ('id','organization_id','organization_epoch','target_type','payload','claim_token','recovery_count','revoked_at'))
                 OR (table_name = 'snmp_trap_ingest_daily_usage' AND column_name IN
                     ('usage_date','scope_type','scope_id','trap_count','varbind_bytes','delivery_count',
                      'metadata_only_count','dropped_trap_count','forwarding_skipped_count'))
                 OR (table_name = 'webhook_deliveries' AND column_name IN
                     ('status','locked_at','claim_token','target_url','recovery_count','organization_epoch','revoked_at'))
                 OR (table_name = 'snmp_traps' AND column_name IN
                     ('varbinds_truncated','varbinds_original_count','varbinds_truncation_reason'))
                 OR (table_name = 'organizations' AND column_name = 'outbound_delivery_epoch'))) <> 35 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Migration 459 schema is incomplete; rerun after repairing conflicting objects';
    END IF;
END$$

CALL fireisp_459_assert_complete()$$
DROP PROCEDURE IF EXISTS fireisp_459_assert_complete$$
DROP PROCEDURE IF EXISTS fireisp_459_exec_if_missing$$

DELIMITER ;
