-- =============================================================================
-- Migration 457 — tenant-safe subscriber sessions and IP attribution evidence
-- =============================================================================
-- connection_logs remains the compatibility/current-session table.  The new
-- organization_id is intentionally nullable during rollout so legacy direct
-- FreeRADIUS writers are not broken before they are updated.  Existing rows are
-- backfilled only where ownership is unambiguous.  New application writes set
-- the value explicitly; a trigger also derives it for direct SQL writers when a
-- unique NAS/contract/client owner is available.
--
-- radius_accounting_events is the application-appended evidence stream for normalized
-- lifecycle milestones: Start, the first Interim-Update transition, Stop, and
-- a corrected final Stop. Routine Interim heartbeats update the projection
-- without appending another evidence row. Privacy-minimal CGNAT allocation and
-- release events store only the public/private attribution tuple and exporter
-- integrity metadata; destination addresses, URLs, content and traffic flows
-- are deliberately excluded. Application retention fans out across shared and
-- isolated databases and defaults attribution/session evidence to 24 months.
-- =============================================================================

-- Create the evidence sink before altering the live projection. The lifecycle
-- triggers are installed immediately after the ALTER below. MySQL cannot make
-- the ALTER + trigger handoff atomic, so production rollout must briefly pause
-- direct/application accounting writes for that DDL window; otherwise a row
-- changed between the ALTER commit and trigger creation cannot be reconstructed
-- from the final mutable projection.
CREATE TABLE IF NOT EXISTS radius_accounting_events (
    id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id        BIGINT UNSIGNED NOT NULL,
    connection_log_id      BIGINT UNSIGNED NULL,
    contract_id            BIGINT UNSIGNED NULL,
    client_id              BIGINT UNSIGNED NULL,
    nas_id                 BIGINT UNSIGNED NULL,
    username               VARCHAR(64)     NOT NULL,
    acct_session_id        VARCHAR(64)     NULL,
    session_instance_id    CHAR(36)        NULL,
    status_type            ENUM('start','interim-update','stop') NOT NULL,
    event_at               TIMESTAMP(3)    NOT NULL,
    observed_at            TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    nas_ip_address         VARCHAR(45)     NULL,
    nas_port_id            VARCHAR(100)    NULL,
    called_station_id      VARCHAR(100)    NULL,
    calling_station_id     VARCHAR(100)    NULL,
    framed_ip              VARCHAR(45)     NULL,
    framed_ipv6_prefix     VARCHAR(64)     NULL,
    bytes_in               BIGINT UNSIGNED NULL,
    bytes_out              BIGINT UNSIGNED NULL,
    packets_in             BIGINT UNSIGNED NULL,
    packets_out            BIGINT UNSIGNED NULL,
    session_duration       INT UNSIGNED    NULL,
    terminate_cause        VARCHAR(64)     NULL,
    acct_delay_seconds     INT UNSIGNED    NULL,
    source                 VARCHAR(32)     NOT NULL DEFAULT 'connection_log_trigger',
    dedupe_key             CHAR(64)        NOT NULL,
    integrity_hash         CHAR(64)        NOT NULL,
    raw_attributes         JSON            NULL,

    PRIMARY KEY (id, event_at),
    UNIQUE KEY uq_radius_event_dedupe (organization_id, dedupe_key, event_at),
    KEY idx_radius_events_org_time (organization_id, event_at),
    KEY idx_radius_events_org_observed (organization_id, observed_at),
    KEY idx_radius_events_org_session (organization_id, acct_session_id, event_at),
    KEY idx_radius_events_org_instance (organization_id, session_instance_id, event_at),
    KEY idx_radius_events_client_time (organization_id, client_id, event_at),
    KEY idx_radius_events_integrity (organization_id, integrity_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Application-appended normalized RADIUS lifecycle evidence; 24-month default retention'
PARTITION BY RANGE (UNIX_TIMESTAMP(event_at)) (
    PARTITION p2026_08 VALUES LESS THAN (UNIX_TIMESTAMP('2026-09-01')),
    PARTITION p2026_09 VALUES LESS THAN (UNIX_TIMESTAMP('2026-10-01')),
    PARTITION p2026_10 VALUES LESS THAN (UNIX_TIMESTAMP('2026-11-01')),
    PARTITION p2026_11 VALUES LESS THAN (UNIX_TIMESTAMP('2026-12-01')),
    PARTITION p2026_12 VALUES LESS THAN (UNIX_TIMESTAMP('2027-01-01')),
    PARTITION p_future  VALUES LESS THAN MAXVALUE
);

DROP PROCEDURE IF EXISTS migration_457_connection_log_org;
DELIMITER //
CREATE PROCEDURE migration_457_connection_log_org()
BEGIN
  DECLARE v_alter LONGTEXT DEFAULT '';
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'organization_id') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'ADD COLUMN organization_id BIGINT UNSIGNED NULL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'session_instance_id') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'ADD COLUMN session_instance_id CHAR(36) NULL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'last_accounting_at') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'ADD COLUMN last_accounting_at TIMESTAMP(3) NULL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'last_accounting_received_at') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'ADD COLUMN last_accounting_received_at TIMESTAMP(3) NULL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'acct_delay_seconds') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'ADD COLUMN acct_delay_seconds INT UNSIGNED NULL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'usage_accounting_complete') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'ADD COLUMN usage_accounting_complete TINYINT(1) NOT NULL DEFAULT 0');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'attribution_evidence_complete') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''),
      'ADD COLUMN attribution_evidence_complete TINYINT(1) NOT NULL DEFAULT 0');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'attribution_anomaly_reason') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''),
      'ADD COLUMN attribution_anomaly_reason VARCHAR(64) NULL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'usage_anomaly_count') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'ADD COLUMN usage_anomaly_count INT UNSIGNED NOT NULL DEFAULT 0');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'usage_last_bytes_in') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'ADD COLUMN usage_last_bytes_in BIGINT UNSIGNED NULL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'usage_last_bytes_out') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'ADD COLUMN usage_last_bytes_out BIGINT UNSIGNED NULL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'usage_last_packets_in') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'ADD COLUMN usage_last_packets_in BIGINT UNSIGNED NULL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'usage_last_packets_out') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'ADD COLUMN usage_last_packets_out BIGINT UNSIGNED NULL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'usage_last_duration') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'ADD COLUMN usage_last_duration INT UNSIGNED NULL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'retention_at') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''),
      'ADD COLUMN retention_at DATETIME(3) GENERATED ALWAYS AS (COALESCE(last_accounting_received_at, last_accounting_at, event_at)) STORED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND INDEX_NAME = 'idx_conn_logs_org_time') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'ADD KEY idx_conn_logs_org_time (organization_id, event_at)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND INDEX_NAME = 'idx_conn_logs_org_session') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'ADD KEY idx_conn_logs_org_session (organization_id, acct_session_id, event_at)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND INDEX_NAME = 'idx_conn_logs_org_instance') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'ADD KEY idx_conn_logs_org_instance (organization_id, session_instance_id, event_at)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND INDEX_NAME = 'idx_conn_logs_retention') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'ADD KEY idx_conn_logs_retention (retention_at)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND INDEX_NAME = 'idx_conn_logs_org_retention') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'ADD KEY idx_conn_logs_org_retention (organization_id, retention_at)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND INDEX_NAME = 'idx_conn_logs_app_lookup') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''),
      'ADD KEY idx_conn_logs_app_lookup (organization_id, nas_id, username, acct_session_id, last_accounting_at)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND INDEX_NAME = 'idx_conn_logs_legacy_lookup') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''),
      'ADD KEY idx_conn_logs_legacy_lookup (organization_id, nas_id, username, session_id, event_at)');
  END IF;
  IF v_alter <> '' THEN
    SET @sql = CONCAT('ALTER TABLE connection_logs ', v_alter);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL migration_457_connection_log_org();
DROP PROCEDURE IF EXISTS migration_457_connection_log_org;

-- Install the fail-closed ownership trigger before the legacy backfill. This
-- closes the rolling-deployment window in which a concurrent direct-SQL writer
-- could otherwise create a new unattributed row after the one-time UPDATE.
DROP TRIGGER IF EXISTS trg_connection_logs_before_insert_org;
DELIMITER //
CREATE TRIGGER trg_connection_logs_before_insert_org
BEFORE INSERT ON connection_logs
FOR EACH ROW
BEGIN
  DECLARE v_nas_org BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_contract_org BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_client_org BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_nas_ip_org BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_candidate BIGINT UNSIGNED DEFAULT NULL;

  IF NEW.nas_id IS NOT NULL THEN
    SELECT MAX(n.organization_id) INTO v_nas_org FROM nas n
     WHERE n.id = NEW.nas_id AND n.organization_id IS NOT NULL;
  END IF;
  IF NEW.contract_id <> 0 THEN
    SELECT MAX(c.organization_id) INTO v_contract_org FROM contracts c
     WHERE c.id = NEW.contract_id AND c.organization_id IS NOT NULL;
  END IF;
  IF NEW.client_id <> 0 THEN
    SELECT MAX(c.organization_id) INTO v_client_org FROM clients c
     WHERE c.id = NEW.client_id AND c.organization_id IS NOT NULL;
  END IF;
  IF NEW.nas_ip_address IS NOT NULL THEN
    SELECT IF(COUNT(DISTINCT n.organization_id) = 1, MIN(n.organization_id), NULL)
      INTO v_nas_ip_org
      FROM nas n WHERE n.ip_address = NEW.nas_ip_address
       AND n.organization_id IS NOT NULL AND n.deleted_at IS NULL;
  END IF;

  SET v_candidate = COALESCE(v_nas_org, v_contract_org, v_client_org, v_nas_ip_org);
  IF v_candidate IS NOT NULL AND (
       (v_nas_org IS NOT NULL AND v_nas_org <> v_candidate)
    OR (v_contract_org IS NOT NULL AND v_contract_org <> v_candidate)
    OR (v_client_org IS NOT NULL AND v_client_org <> v_candidate)
    OR (v_nas_ip_org IS NOT NULL AND v_nas_ip_org <> v_candidate)
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Connection log tenant anchors disagree';
  END IF;
  IF NEW.organization_id IS NOT NULL AND v_candidate IS NOT NULL
     AND NEW.organization_id <> v_candidate THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Connection log organization does not own its anchors';
  END IF;
  IF NEW.organization_id IS NULL THEN SET NEW.organization_id = v_candidate; END IF;
END //
DELIMITER ;

-- Install the evidence triggers immediately after the projection ALTER and
-- ownership trigger. After this point live writers remain covered while the
-- remaining backfills and auxiliary-table DDL run.
DROP TRIGGER IF EXISTS trg_connection_logs_after_insert_evidence;
DELIMITER //
CREATE TRIGGER trg_connection_logs_after_insert_evidence
AFTER INSERT ON connection_logs
FOR EACH ROW
BEGIN
  DECLARE v_event_at TIMESTAMP(3);
  DECLARE v_observed_at TIMESTAMP(3);
  DECLARE v_dedupe CHAR(64);
  DECLARE v_integrity CHAR(64);
  DECLARE v_raw JSON;
  DECLARE v_is_milestone BOOLEAN DEFAULT FALSE;

  SET v_event_at = COALESCE(NEW.last_accounting_at, NEW.event_at);
  SET v_observed_at = COALESCE(NEW.last_accounting_received_at, CURRENT_TIMESTAMP(3));
  SET v_is_milestone = NEW.session_instance_id IS NOT NULL
    OR NEW.event_type IN ('start', 'stop');
  IF NEW.organization_id IS NOT NULL AND v_is_milestone THEN
    SET v_raw = JSON_OBJECT(
      'event_type', NEW.event_type,
      'ip_address', COALESCE(NEW.framed_ip, NEW.ip_address),
      'ipv6_prefix', COALESCE(NEW.framed_ipv6_prefix, NEW.ipv6_delegated_prefix),
      'acct_delay_seconds', NEW.acct_delay_seconds
    );
    SET v_dedupe = SHA2(CAST(JSON_ARRAY(
      NEW.organization_id, NULLIF(NEW.contract_id, 0), NULLIF(NEW.client_id, 0),
      NEW.nas_id, NEW.username, NEW.session_instance_id,
      COALESCE(NEW.acct_session_id, NEW.session_id), NEW.event_type,
      ROUND(UNIX_TIMESTAMP(v_event_at) * 1000), NEW.nas_ip_address,
      NEW.nas_port_id, NEW.called_station_id, NEW.calling_station_id,
      COALESCE(NEW.framed_ip, NEW.ip_address),
      COALESCE(NEW.framed_ipv6_prefix, NEW.ipv6_delegated_prefix),
      NEW.bytes_in, NEW.bytes_out, NEW.packets_in, NEW.packets_out,
      NEW.session_duration, NEW.terminate_cause, NEW.acct_delay_seconds
    ) AS CHAR), 256);
    SET v_integrity = SHA2(CAST(JSON_ARRAY(
      v_dedupe, NEW.id, ROUND(UNIX_TIMESTAMP(v_observed_at) * 1000),
      'connection_log_trigger', v_raw
    ) AS CHAR), 256);

    INSERT INTO radius_accounting_events
      (organization_id, connection_log_id, contract_id, client_id, nas_id,
       username, acct_session_id, session_instance_id, status_type, event_at, observed_at, nas_ip_address,
       nas_port_id, called_station_id, calling_station_id, framed_ip,
       framed_ipv6_prefix, bytes_in, bytes_out, packets_in, packets_out,
       session_duration, terminate_cause, acct_delay_seconds, source, dedupe_key, integrity_hash,
       raw_attributes)
    VALUES
      (NEW.organization_id, NEW.id, NULLIF(NEW.contract_id, 0), NULLIF(NEW.client_id, 0), NEW.nas_id,
       NEW.username, COALESCE(NEW.acct_session_id, NEW.session_id), NEW.session_instance_id,
       NEW.event_type, v_event_at, v_observed_at, NEW.nas_ip_address, NEW.nas_port_id, NEW.called_station_id,
       NEW.calling_station_id, COALESCE(NEW.framed_ip, NEW.ip_address),
       COALESCE(NEW.framed_ipv6_prefix, NEW.ipv6_delegated_prefix),
       NEW.bytes_in, NEW.bytes_out, NEW.packets_in, NEW.packets_out,
       NEW.session_duration, NEW.terminate_cause, NEW.acct_delay_seconds, 'connection_log_trigger',
       v_dedupe, v_integrity, v_raw)
    ON DUPLICATE KEY UPDATE id = id;
  END IF;
END //
DELIMITER ;

DROP TRIGGER IF EXISTS trg_connection_logs_after_update_evidence;
DELIMITER //
CREATE TRIGGER trg_connection_logs_after_update_evidence
AFTER UPDATE ON connection_logs
FOR EACH ROW
BEGIN
  DECLARE v_event_at TIMESTAMP(3);
  DECLARE v_observed_at TIMESTAMP(3);
  DECLARE v_dedupe CHAR(64);
  DECLARE v_integrity CHAR(64);
  DECLARE v_raw JSON;
  IF NEW.organization_id IS NOT NULL AND (
       NOT (NEW.event_type <=> OLD.event_type)
    OR NOT (NEW.framed_ip <=> OLD.framed_ip)
    OR NOT (NEW.framed_ipv6_prefix <=> OLD.framed_ipv6_prefix)
    OR NOT (NEW.calling_station_id <=> OLD.calling_station_id)
    OR (NEW.event_type = 'stop' AND OLD.event_type = 'stop'
        AND (NOT (NEW.bytes_in <=> OLD.bytes_in)
          OR NOT (NEW.bytes_out <=> OLD.bytes_out)
          OR NOT (NEW.packets_in <=> OLD.packets_in)
          OR NOT (NEW.packets_out <=> OLD.packets_out)
          OR NOT (NEW.session_duration <=> OLD.session_duration)
          OR NOT (NEW.terminate_cause <=> OLD.terminate_cause)
          OR NOT (NEW.framed_ip <=> OLD.framed_ip)
          OR NOT (NEW.framed_ipv6_prefix <=> OLD.framed_ipv6_prefix)
          OR NOT (NEW.acct_delay_seconds <=> OLD.acct_delay_seconds)))
  ) THEN
    SET v_event_at = COALESCE(NEW.last_accounting_at, NEW.event_at);
    SET v_observed_at = COALESCE(NEW.last_accounting_received_at, CURRENT_TIMESTAMP(3));
    SET v_raw = JSON_OBJECT(
      'event_type', NEW.event_type,
      'ip_address', COALESCE(NEW.framed_ip, NEW.ip_address),
      'ipv6_prefix', COALESCE(NEW.framed_ipv6_prefix, NEW.ipv6_delegated_prefix),
      'acct_delay_seconds', NEW.acct_delay_seconds
    );
    SET v_dedupe = SHA2(CAST(JSON_ARRAY(
      NEW.organization_id, NULLIF(NEW.contract_id, 0), NULLIF(NEW.client_id, 0),
      NEW.nas_id, NEW.username, NEW.session_instance_id,
      COALESCE(NEW.acct_session_id, NEW.session_id), NEW.event_type,
      ROUND(UNIX_TIMESTAMP(v_event_at) * 1000), NEW.nas_ip_address,
      NEW.nas_port_id, NEW.called_station_id, NEW.calling_station_id,
      COALESCE(NEW.framed_ip, NEW.ip_address),
      COALESCE(NEW.framed_ipv6_prefix, NEW.ipv6_delegated_prefix),
      NEW.bytes_in, NEW.bytes_out, NEW.packets_in, NEW.packets_out,
      NEW.session_duration, NEW.terminate_cause, NEW.acct_delay_seconds
    ) AS CHAR), 256);
    SET v_integrity = SHA2(CAST(JSON_ARRAY(
      v_dedupe, NEW.id, ROUND(UNIX_TIMESTAMP(v_observed_at) * 1000),
      'connection_log_trigger', v_raw
    ) AS CHAR), 256);

    INSERT INTO radius_accounting_events
      (organization_id, connection_log_id, contract_id, client_id, nas_id,
       username, acct_session_id, session_instance_id, status_type, event_at, observed_at, nas_ip_address,
       nas_port_id, called_station_id, calling_station_id, framed_ip,
       framed_ipv6_prefix, bytes_in, bytes_out, packets_in, packets_out,
       session_duration, terminate_cause, acct_delay_seconds, source, dedupe_key, integrity_hash,
       raw_attributes)
    VALUES
      (NEW.organization_id, NEW.id, NULLIF(NEW.contract_id, 0), NULLIF(NEW.client_id, 0), NEW.nas_id,
       NEW.username, COALESCE(NEW.acct_session_id, NEW.session_id), NEW.session_instance_id,
       NEW.event_type, v_event_at, v_observed_at, NEW.nas_ip_address, NEW.nas_port_id,
       NEW.called_station_id, NEW.calling_station_id,
       COALESCE(NEW.framed_ip, NEW.ip_address),
       COALESCE(NEW.framed_ipv6_prefix, NEW.ipv6_delegated_prefix),
       NEW.bytes_in, NEW.bytes_out, NEW.packets_in, NEW.packets_out,
       NEW.session_duration, NEW.terminate_cause, NEW.acct_delay_seconds, 'connection_log_trigger',
       v_dedupe, v_integrity, v_raw)
    ON DUPLICATE KEY UPDATE id = id;
  END IF;
END //
DELIMITER ;

-- Freeze legacy NULL-org API tokens to their owner's current home organization
-- so credentials remain listable/revocable and cannot silently follow a later
-- user home-org change. Rows without a home organization remain NULL and fail
-- authentication closed.
UPDATE api_tokens token
JOIN users owner_row ON owner_row.id = token.user_id
  AND owner_row.status = 'active' AND owner_row.deleted_at IS NULL
JOIN organizations home_org ON home_org.id = owner_row.organization_id
  AND home_org.status = 'active' AND home_org.deleted_at IS NULL
SET token.organization_id = owner_row.organization_id
WHERE token.organization_id IS NULL
  AND owner_row.organization_id IS NOT NULL;

-- Preserve the API-token identity behind sensitive report views/exports. No FK
-- is intentional: revoking/deleting a token must not erase access provenance.
DROP PROCEDURE IF EXISTS migration_457_report_access_token;
DELIMITER //
CREATE PROCEDURE migration_457_report_access_token()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'report_access_logs'
      AND COLUMN_NAME = 'api_token_id') THEN
    ALTER TABLE report_access_logs ADD COLUMN api_token_id BIGINT UNSIGNED NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'report_access_logs'
      AND INDEX_NAME = 'idx_report_access_logs_api_token') THEN
    ALTER TABLE report_access_logs ADD KEY idx_report_access_logs_api_token
      (api_token_id, accessed_at);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'report_access_logs'
      AND COLUMN_NAME = 'gov_data_request_id') THEN
    ALTER TABLE report_access_logs ADD COLUMN gov_data_request_id BIGINT UNSIGNED NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'report_access_logs'
      AND INDEX_NAME = 'idx_report_access_logs_gov_request') THEN
    ALTER TABLE report_access_logs ADD KEY idx_report_access_logs_gov_request
      (organization_id, gov_data_request_id, accessed_at);
  END IF;
END //
DELIMITER ;

CALL migration_457_report_access_token();
DROP PROCEDURE IF EXISTS migration_457_report_access_token;

-- An IP-traceability case authorizes one exact public-IP lookup. Public port
-- and protocol are both NULL for direct public assignments and both populated
-- for shared CGNAT. Approval metadata makes the legal-review transition
-- explicit rather than treating case creation as authorization.
DROP PROCEDURE IF EXISTS migration_457_gov_ip_attribution_scope;
DELIMITER //
CREATE PROCEDURE migration_457_gov_ip_attribution_scope()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gov_data_requests'
      AND COLUMN_NAME = 'public_port') THEN
    ALTER TABLE gov_data_requests ADD COLUMN public_port SMALLINT UNSIGNED NULL AFTER ip_address;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gov_data_requests'
      AND COLUMN_NAME = 'protocol') THEN
    ALTER TABLE gov_data_requests ADD COLUMN protocol VARCHAR(16) NULL AFTER public_port;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gov_data_requests'
      AND COLUMN_NAME = 'observed_at') THEN
    ALTER TABLE gov_data_requests ADD COLUMN observed_at TIMESTAMP(3) NULL AFTER protocol;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gov_data_requests'
      AND COLUMN_NAME = 'contract_id') THEN
    ALTER TABLE gov_data_requests ADD COLUMN contract_id BIGINT UNSIGNED NULL AFTER client_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gov_data_requests'
      AND COLUMN_NAME = 'legal_reviewed_at') THEN
    ALTER TABLE gov_data_requests ADD COLUMN legal_reviewed_at TIMESTAMP(3) NULL AFTER status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gov_data_requests'
      AND COLUMN_NAME = 'legal_reviewed_by') THEN
    ALTER TABLE gov_data_requests ADD COLUMN legal_reviewed_by BIGINT UNSIGNED NULL AFTER legal_reviewed_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gov_data_requests'
      AND COLUMN_NAME = 'created_by') THEN
    ALTER TABLE gov_data_requests ADD COLUMN created_by BIGINT UNSIGNED NULL AFTER organization_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gov_data_requests'
      AND COLUMN_NAME = 'rejected_at') THEN
    ALTER TABLE gov_data_requests ADD COLUMN rejected_at TIMESTAMP(3) NULL AFTER fulfilled_by;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gov_data_requests'
      AND COLUMN_NAME = 'rejected_by') THEN
    ALTER TABLE gov_data_requests ADD COLUMN rejected_by BIGINT UNSIGNED NULL AFTER rejected_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gov_data_requests'
      AND COLUMN_NAME = 'rejection_reason') THEN
    ALTER TABLE gov_data_requests ADD COLUMN rejection_reason VARCHAR(500) NULL AFTER rejected_by;
  END IF;
  ALTER TABLE gov_data_requests MODIFY COLUMN status
    ENUM('received','processing','fulfilled','rejected','pending_legal_review')
    NOT NULL DEFAULT 'received';
END //
DELIMITER ;

CALL migration_457_gov_ip_attribution_scope();
DROP PROCEDURE IF EXISTS migration_457_gov_ip_attribution_scope;

INSERT INTO scheduled_tasks
    (organization_id, task_name, description, cron_expression, is_enabled, priority)
SELECT NULL,
       'purge_radius_accounting',
       'Purge tenant session/lifecycle and closed IP-attribution evidence after configured calendar-month retention',
       '0 3 * * *',
       TRUE,
       'low'
  FROM DUAL
 WHERE NOT EXISTS (
   SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'purge_radius_accounting' AND organization_id IS NULL
 );

UPDATE scheduled_tasks
   SET description = 'Purge tenant session/lifecycle and closed IP-attribution evidence after configured calendar-month retention'
 WHERE task_name = 'purge_radius_accounting'
   AND organization_id IS NULL;

-- Fail closed when legacy anchors disagree.  A dirty row that points at a NAS
-- from tenant A and a contract/client from tenant B remains unattributed rather
-- than being exposed to either tenant.  NAS-IP is a candidate only when one
-- organization in this database uniquely owns it.
UPDATE connection_logs cl
LEFT JOIN nas n_id ON n_id.id = cl.nas_id AND n_id.organization_id IS NOT NULL
LEFT JOIN contracts contract_owner
  ON contract_owner.id = NULLIF(cl.contract_id, 0)
 AND contract_owner.organization_id IS NOT NULL
LEFT JOIN clients client_owner
  ON client_owner.id = NULLIF(cl.client_id, 0)
 AND client_owner.organization_id IS NOT NULL
LEFT JOIN (
  SELECT ip_address, MIN(organization_id) AS organization_id
    FROM nas
   WHERE organization_id IS NOT NULL
     AND deleted_at IS NULL
   GROUP BY ip_address
  HAVING COUNT(DISTINCT organization_id) = 1
) n_ip ON n_ip.ip_address = cl.nas_ip_address
SET cl.organization_id = COALESCE(
  n_id.organization_id, contract_owner.organization_id,
  client_owner.organization_id, n_ip.organization_id
)
WHERE cl.organization_id IS NULL
  AND COALESCE(
    n_id.organization_id, contract_owner.organization_id,
    client_owner.organization_id, n_ip.organization_id
  ) IS NOT NULL
  AND (n_id.organization_id IS NULL OR n_id.organization_id = COALESCE(
    contract_owner.organization_id, client_owner.organization_id,
    n_ip.organization_id, n_id.organization_id
  ))
  AND (contract_owner.organization_id IS NULL OR contract_owner.organization_id = COALESCE(
    n_id.organization_id, client_owner.organization_id,
    n_ip.organization_id, contract_owner.organization_id
  ))
  AND (client_owner.organization_id IS NULL OR client_owner.organization_id = COALESCE(
    n_id.organization_id, contract_owner.organization_id,
    n_ip.organization_id, client_owner.organization_id
  ))
  AND (n_ip.organization_id IS NULL OR n_ip.organization_id = COALESCE(
    n_id.organization_id, contract_owner.organization_id,
    client_owner.organization_id, n_ip.organization_id
  ));

CREATE TABLE IF NOT EXISTS cgnat_exporter_configs (
    id                         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id            BIGINT UNSIGNED NOT NULL,
    exporter_id                VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    exporter_nas_id            BIGINT UNSIGNED NULL,
    exporter_ip                VARCHAR(15)     NULL,
    nat_instance_id            VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    nat_pool_id                VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    nat_pool_record_id         BIGINT UNSIGNED NOT NULL,
    collector_api_token_id     BIGINT UNSIGNED NOT NULL,
    recovery_collector_api_token_id BIGINT UNSIGNED NULL,
    recovery_reference        VARCHAR(500) NULL,
    recovery_approved_by      BIGINT UNSIGNED NULL,
    recovery_approved_at      TIMESTAMP(3) NULL,
    public_ipv4_start          VARCHAR(15) NOT NULL,
    public_ipv4_end            VARCHAR(15) NOT NULL,
    nat_realm                  VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    purpose_reference          VARCHAR(500) NULL,
    tuple_exclusivity_confirmed TINYINT(1) NOT NULL DEFAULT 0,
    authoritative_baseline_confirmed TINYINT(1) NOT NULL DEFAULT 0,
    baseline_reference          VARCHAR(500) NULL,
    baseline_confirmed_by       BIGINT UNSIGNED NULL,
    baseline_confirmed_at       TIMESTAMP(3) NULL,
    collection_approved_by     BIGINT UNSIGNED NULL,
    collection_approved_at     TIMESTAMP(3) NULL,
    is_required                TINYINT(1)      NOT NULL DEFAULT 1,
    enabled                    TINYINT(1)      NOT NULL DEFAULT 0,
    retired_at                 TIMESTAMP(3)    NULL,
    retired_by                 BIGINT UNSIGNED NULL,
    last_binding_received_at   TIMESTAMP(3)    NULL,
    last_device_recorded_at    TIMESTAMP(3)    NULL,
    last_corrected_device_at   TIMESTAMP(3)    NULL,
    coverage_horizon_at        TIMESTAMP(3)    NULL,
    last_exporter_boot_id      VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
    last_sequence_number       BIGINT UNSIGNED NULL,
    sequence_gap_events        BIGINT UNSIGNED NOT NULL DEFAULT 0,
    sequence_missing_records   BIGINT UNSIGNED NOT NULL DEFAULT 0,
    out_of_order_events        BIGINT UNSIGNED NOT NULL DEFAULT 0,
    reported_lost_records      BIGINT UNSIGNED NOT NULL DEFAULT 0,
    incomplete_metadata_events BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at                 TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at                 TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_cgnat_exporter_identity
      (organization_id, exporter_id, nat_instance_id, nat_pool_id, nat_realm),
    UNIQUE KEY uq_cgnat_exporter_collector_token (organization_id, collector_api_token_id),
    UNIQUE KEY uq_cgnat_exporter_recovery_token (organization_id, recovery_collector_api_token_id),
    KEY idx_cgnat_exporter_coverage (organization_id, enabled, is_required, last_binding_received_at),
    KEY idx_cgnat_exporter_nas (organization_id, exporter_nas_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Explicit tenant CGNAT exporter/NAT/pool inventory used for truthful coverage readiness';

-- Serializes allocation checks for one externally searchable public tuple.
-- It contains no subscriber or destination information and is not aged out.
CREATE TABLE IF NOT EXISTS cgnat_public_tuple_locks (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NOT NULL,
    public_ipv4     VARCHAR(15)     NOT NULL,
    protocol        TINYINT UNSIGNED NOT NULL,
    updated_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_cgnat_public_tuple_lock (organization_id, public_ipv4, protocol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Serialization anchors for non-overlapping CGNAT public port allocations';

CREATE TABLE IF NOT EXISTS cgnat_attribution_bindings (
    id                              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id                 BIGINT UNSIGNED NOT NULL,
    exporter_config_id              BIGINT UNSIGNED NOT NULL,
    connection_log_id               BIGINT UNSIGNED NOT NULL,
    client_id                       BIGINT UNSIGNED NOT NULL,
    contract_id                     BIGINT UNSIGNED NOT NULL,
    username                        VARCHAR(64)     NOT NULL,
    radius_session_id               VARCHAR(64)     NOT NULL,
    session_instance_id             CHAR(36)        NOT NULL,
    radius_evidence_id              BIGINT UNSIGNED NOT NULL,
    radius_evidence_event_at        TIMESTAMP(3)    NOT NULL,
    radius_evidence_observed_at     TIMESTAMP(3)    NOT NULL,
    radius_evidence_integrity_hash  CHAR(64)        NOT NULL,
    binding_key                     VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    binding_type                    ENUM('single_port','port_block') NOT NULL,
    private_ipv4                    VARCHAR(15)     NOT NULL,
    private_port_start              SMALLINT UNSIGNED NULL,
    private_port_end                SMALLINT UNSIGNED NULL,
    public_ipv4                     VARCHAR(15)     NOT NULL,
    public_port_start               SMALLINT UNSIGNED NOT NULL,
    public_port_end                 SMALLINT UNSIGNED NOT NULL,
    protocol                        TINYINT UNSIGNED NOT NULL,
    allocated_at                    TIMESTAMP(3)    NOT NULL,
    released_at                     TIMESTAMP(3)    NULL,
    exporter_nas_id                 BIGINT UNSIGNED NULL,
    collector_api_token_id          BIGINT UNSIGNED NOT NULL,
    exporter_id                     VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    exporter_ip                     VARCHAR(15)     NULL,
    exporter_boot_id                VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    nat_instance_id                 VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    nat_pool_id                     VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    nat_realm                       VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    allocation_event_id             VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    allocation_sequence_number      BIGINT UNSIGNED NOT NULL,
    allocation_sequence_status      ENUM('initial','contiguous','reset','gap','out_of_order') NOT NULL,
    allocation_device_recorded_at   TIMESTAMP(3)    NOT NULL,
    allocation_received_at          TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    release_event_id                VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
    release_sequence_number         BIGINT UNSIGNED NULL,
    release_sequence_status         ENUM('initial','contiguous','reset','gap','out_of_order') NULL,
    release_device_recorded_at      TIMESTAMP(3)    NULL,
    release_received_at             TIMESTAMP(3)    NULL,
    allocation_clock_offset_ms      INT             NULL,
    allocation_clock_uncertainty_ms INT UNSIGNED    NULL,
    allocation_records_lost_before  BIGINT UNSIGNED NULL,
    release_clock_offset_ms         INT             NULL,
    release_clock_uncertainty_ms    INT UNSIGNED    NULL,
    release_records_lost_before     BIGINT UNSIGNED NULL,
    metadata_complete               TINYINT(1)      NOT NULL DEFAULT 0,
    payload_hash                    CHAR(64)        NOT NULL,
    integrity_hash                  CHAR(64)        NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_cgnat_binding_org_id (id, organization_id),
    UNIQUE KEY uq_cgnat_binding_key (organization_id, exporter_config_id, binding_key),
    UNIQUE KEY uq_cgnat_allocation_event
      (organization_id, exporter_config_id, exporter_boot_id, allocation_event_id),
    KEY idx_cgnat_exact_lookup
      (organization_id, public_ipv4, protocol, public_port_start, public_port_end, allocated_at, released_at),
    KEY idx_cgnat_client_time (organization_id, client_id, allocated_at),
    KEY idx_cgnat_contract_time (organization_id, contract_id, allocated_at),
    KEY idx_cgnat_session_time (organization_id, session_instance_id, allocated_at),
    KEY idx_cgnat_radius_evidence (organization_id, radius_evidence_id),
    KEY idx_cgnat_retention (released_at),
    KEY idx_cgnat_integrity (organization_id, integrity_hash),
    CONSTRAINT chk_cgnat_public_ports CHECK (public_port_start BETWEEN 1 AND 65535
      AND public_port_end BETWEEN public_port_start AND 65535),
    CONSTRAINT chk_cgnat_private_ports CHECK (
      (binding_type = 'single_port' AND private_port_start BETWEEN 1 AND 65535
        AND private_port_end = private_port_start AND public_port_end = public_port_start)
      OR (binding_type = 'port_block' AND private_port_start IS NULL
        AND private_port_end IS NULL AND public_port_end > public_port_start)),
    CONSTRAINT chk_cgnat_protocol CHECK (protocol IN (6,17)),
    CONSTRAINT chk_cgnat_interval CHECK (released_at IS NULL OR released_at > allocated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Privacy-minimal current CGNAT allocation projection; no destinations, URLs, content or traffic flows';

CREATE TABLE IF NOT EXISTS cgnat_binding_events (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id       BIGINT UNSIGNED NOT NULL,
    binding_id            BIGINT UNSIGNED NOT NULL,
    exporter_config_id    BIGINT UNSIGNED NOT NULL,
    collector_api_token_id BIGINT UNSIGNED NOT NULL,
    event_type            ENUM('allocate','release') NOT NULL,
    binding_key           VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    exporter_id           VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    exporter_boot_id      VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_id              VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    sequence_number       BIGINT UNSIGNED NOT NULL,
    sequence_status       ENUM('initial','contiguous','reset','gap','out_of_order') NOT NULL,
    device_recorded_at    TIMESTAMP(3)    NOT NULL,
    received_at           TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    clock_offset_ms       INT             NULL,
    clock_uncertainty_ms  INT UNSIGNED    NULL,
    records_lost_before   BIGINT UNSIGNED NULL,
    allocated_at          TIMESTAMP(3)    NOT NULL,
    released_at           TIMESTAMP(3)    NULL,
    payload_hash          CHAR(64)        NOT NULL,
    integrity_hash        CHAR(64)        NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_cgnat_event_replay (organization_id, exporter_config_id, exporter_boot_id, event_id),
    KEY idx_cgnat_events_binding (organization_id, binding_id, received_at),
    KEY idx_cgnat_events_received (organization_id, received_at),
    KEY idx_cgnat_events_integrity (organization_id, integrity_hash),
    CONSTRAINT fk_cgnat_events_binding
      FOREIGN KEY (binding_id, organization_id)
      REFERENCES cgnat_attribution_bindings (id, organization_id)
      ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Append-only allocate/release receipts for the CGNAT binding projection';

CREATE TABLE IF NOT EXISTS ip_attribution_case_evidence (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id       BIGINT UNSIGNED NOT NULL,
    gov_data_request_id   BIGINT UNSIGNED NOT NULL,
    evidence_type         ENUM('cgnat_binding','direct_public_assignment') NOT NULL,
    binding_id            BIGINT UNSIGNED NULL,
    connection_log_id     BIGINT UNSIGNED NULL,
    source_integrity_hash CHAR(64)        NOT NULL,
    evidence_snapshot     JSON            NOT NULL,
    evidence_hash         CHAR(64)        NOT NULL,
    query_key             CHAR(64)        NOT NULL,
    public_ipv4           VARCHAR(15)     NOT NULL,
    public_port           SMALLINT UNSIGNED NULL,
    protocol              TINYINT UNSIGNED NULL,
    observed_at           TIMESTAMP(3)    NOT NULL,
    pinned_by             BIGINT UNSIGNED NULL,
    pinned_at             TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    hold_released_at      TIMESTAMP(3)    NULL,
    hold_released_by      BIGINT UNSIGNED NULL,
    hold_release_reason   VARCHAR(500)    NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ip_attribution_case_evidence
      (organization_id, gov_data_request_id, evidence_type, query_key, evidence_hash),
    KEY idx_ip_case_binding_hold (organization_id, binding_id, hold_released_at),
    KEY idx_ip_case_session_hold (organization_id, connection_log_id, hold_released_at),
    KEY idx_ip_case_request (organization_id, gov_data_request_id, pinned_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Approved-case evidence preservation links; holds require explicit terminal-case release';

-- Bounded accounting usage deltas for billing/FUP/reporting. This is distinct
-- from sparse lifecycle evidence: each accepted projection update contributes
-- only the monotonic counter increase to one UTC session-day row. Exact replays
-- and out-of-order packets contribute zero. Legacy direct-SQL event writers do
-- not populate this rollup and are not a supported billing source.
CREATE TABLE IF NOT EXISTS radius_accounting_usage_daily (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id       BIGINT UNSIGNED NOT NULL,
    usage_date            DATE            NOT NULL,
    session_instance_id   CHAR(36)        NOT NULL,
    connection_log_id     BIGINT UNSIGNED NULL,
    contract_id           BIGINT UNSIGNED NULL,
    client_id             BIGINT UNSIGNED NULL,
    nas_id                BIGINT UNSIGNED NULL,
    username              VARCHAR(64)     NOT NULL,
    bytes_in_delta        BIGINT UNSIGNED NOT NULL DEFAULT 0,
    bytes_out_delta       BIGINT UNSIGNED NOT NULL DEFAULT 0,
    packets_in_delta      BIGINT UNSIGNED NOT NULL DEFAULT 0,
    packets_out_delta     BIGINT UNSIGNED NOT NULL DEFAULT 0,
    duration_delta        INT UNSIGNED    NOT NULL DEFAULT 0,
    is_complete           TINYINT(1)      NOT NULL DEFAULT 1,
    anomaly_count         INT UNSIGNED    NOT NULL DEFAULT 0,
    anomaly_reason        VARCHAR(64)     NULL,
    first_event_at        TIMESTAMP(3)    NOT NULL,
    last_event_at         TIMESTAMP(3)    NOT NULL,
    created_at            TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at            TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_radius_usage_org_day_instance (organization_id, usage_date, session_instance_id),
    KEY idx_radius_usage_org_day (organization_id, usage_date),
    KEY idx_radius_usage_date (usage_date),
    KEY idx_radius_usage_client_day (organization_id, client_id, usage_date),
    KEY idx_radius_usage_contract_day (organization_id, contract_id, usage_date),
    KEY idx_radius_usage_username_day (organization_id, username, usage_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='UTC daily monotonic RADIUS usage deltas from supported application ingest';

-- Tenant-local transactional provenance. These receipts deliberately avoid
-- foreign keys to primary/control-plane token rows so isolated databases can
-- commit data plus its collector identity in the same transaction.
CREATE TABLE IF NOT EXISTS collector_ingest_receipts (
    id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id      BIGINT UNSIGNED NOT NULL,
    source               VARCHAR(32)     NOT NULL,
    api_token_id         BIGINT UNSIGNED NOT NULL DEFAULT 0,
    nas_id               BIGINT UNSIGNED NOT NULL DEFAULT 0,
    event_type           VARCHAR(32)     NULL,
    action               VARCHAR(32)     NOT NULL,
    bucket_at            TIMESTAMP       NOT NULL,
    records_received     INT UNSIGNED    NOT NULL DEFAULT 1,
    records_inserted     INT UNSIGNED    NOT NULL DEFAULT 0,
    records_replayed     INT UNSIGNED    NOT NULL DEFAULT 0,
    request_id           VARCHAR(64)     NULL,
    source_ip            VARCHAR(45)     NULL,
    user_agent           VARCHAR(255)    NULL,
    payload_chain_hash   CHAR(64)        NOT NULL,
    first_received_at    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_received_at     TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_collector_receipt_bucket
      (organization_id, source, api_token_id, nas_id, event_type, action, bucket_at),
    KEY idx_collector_receipts_org_time (organization_id, last_received_at),
    KEY idx_collector_receipts_time (last_received_at),
    KEY idx_collector_receipts_token_time (api_token_id, last_received_at),
    KEY idx_collector_receipts_nas_time (organization_id, nas_id, last_received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Short-retention per-minute transactional collector provenance rollups; no request secrets or bodies';

-- connection_logs is partitioned by session start, while retention for the
-- mutable projection is based on the latest received/final activity. Retire
-- the legacy fixed-two-year DROP PARTITION path: it could delete a still-live
-- session that began more than two years ago and bypass configured retention.
-- The application retention service owns deletion; this procedure only keeps
-- current/+3 month insert capacity materialized.
DROP EVENT IF EXISTS evt_connection_logs_partition_maintenance;
DROP PROCEDURE IF EXISTS connection_logs_maintain_partitions;
DELIMITER //
CREATE PROCEDURE connection_logs_maintain_partitions()
BEGIN
  DECLARE v_month DATE;
  DECLARE v_pname VARCHAR(32);
  DECLARE v_next_ts BIGINT;
  DECLARE v_exists INT DEFAULT 0;
  SET v_month = DATE_FORMAT(CURDATE(), '%Y-%m-01');
  WHILE v_month <= DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 3 MONTH), '%Y-%m-01') DO
    SET v_pname = CONCAT('p', DATE_FORMAT(v_month, '%Y_%m'));
    SET v_next_ts = UNIX_TIMESTAMP(DATE_ADD(v_month, INTERVAL 1 MONTH));
    SELECT COUNT(*) INTO v_exists FROM information_schema.PARTITIONS
     WHERE table_schema = DATABASE() AND table_name = 'connection_logs'
       AND partition_name = v_pname;
    IF v_exists = 0 THEN
      SET @sql = CONCAT(
        'ALTER TABLE connection_logs REORGANIZE PARTITION p_future INTO (',
        'PARTITION ', v_pname, ' VALUES LESS THAN (', v_next_ts, '), ',
        'PARTITION p_future VALUES LESS THAN MAXVALUE)');
      PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
    END IF;
    SET v_month = DATE_ADD(v_month, INTERVAL 1 MONTH);
  END WHILE;
END //
DELIMITER ;

CALL connection_logs_maintain_partitions();
CREATE EVENT evt_connection_logs_partition_maintenance
  ON SCHEDULE EVERY 1 DAY
  STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 3 HOUR + INTERVAL 30 MINUTE)
  ON COMPLETION PRESERVE
  COMMENT 'Materialize current/+3 connection_logs partitions; application retention owns deletion'
  DO CALL connection_logs_maintain_partitions();

-- Keep current/+3 monthly partitions materialized.  Purging is owned by the
-- isolated-aware application retention service; closed attribution evidence
-- and session evidence have independent legal-hold-aware policies.
DROP PROCEDURE IF EXISTS subscriber_logging_maintain_partitions;
DELIMITER //
CREATE PROCEDURE subscriber_logging_maintain_partitions()
BEGIN
  DECLARE v_month DATE;
  DECLARE v_pname VARCHAR(32);
  DECLARE v_next_ts BIGINT;
  DECLARE v_exists INT DEFAULT 0;

  SET v_month = DATE_FORMAT(CURDATE(), '%Y-%m-01');
  WHILE v_month <= DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 3 MONTH), '%Y-%m-01') DO
    SET v_pname = CONCAT('p', DATE_FORMAT(v_month, '%Y_%m'));
    SET v_next_ts = UNIX_TIMESTAMP(DATE_ADD(v_month, INTERVAL 1 MONTH));

    SELECT COUNT(*) INTO v_exists FROM information_schema.PARTITIONS
     WHERE table_schema = DATABASE() AND table_name = 'radius_accounting_events'
       AND partition_name = v_pname;
    IF v_exists = 0 THEN
      SET @sql = CONCAT(
        'ALTER TABLE radius_accounting_events REORGANIZE PARTITION p_future INTO (',
        'PARTITION ', v_pname, ' VALUES LESS THAN (', v_next_ts, '), ',
        'PARTITION p_future VALUES LESS THAN MAXVALUE)');
      PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
    END IF;

    SET v_month = DATE_ADD(v_month, INTERVAL 1 MONTH);
  END WHILE;

END //
DELIMITER ;

CALL subscriber_logging_maintain_partitions();

CREATE EVENT IF NOT EXISTS evt_subscriber_logging_partition_maintenance
  ON SCHEDULE EVERY 1 DAY
  STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 3 HOUR)
  ON COMPLETION PRESERVE
  DO CALL subscriber_logging_maintain_partitions();

-- Sensitive permissions are intentionally not granted to support, technician,
-- NOC, billing or generic readonly roles.
INSERT INTO permissions (name, description, module)
SELECT 'connection_logs.export', 'Export tenant subscriber session records', 'connection_logs'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'connection_logs.export');

INSERT INTO permissions (name, description, module)
SELECT 'connection_logs.ingest', 'Ingest tenant-scoped RADIUS accounting records', 'connection_logs'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'connection_logs.ingest');

INSERT INTO permissions (name, description, module)
SELECT 'cgnat_attribution.manage', 'Approve and manage tenant CGNAT exporter inventory', 'cgnat_attribution'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'cgnat_attribution.manage');

INSERT INTO permissions (name, description, module)
SELECT 'cgnat_attribution.ingest', 'Ingest privacy-minimal tenant CGNAT allocation/release events', 'cgnat_attribution'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'cgnat_attribution.ingest');

INSERT INTO permissions (name, description, module)
SELECT 'ip_attribution.view', 'Run approved-case direct-public or CGNAT IP attribution lookups', 'ip_attribution'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ip_attribution.view');

INSERT INTO permissions (name, description, module)
SELECT 'ip_attribution.export', 'Export one approved-case IP attribution result', 'ip_attribution'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ip_attribution.export');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.name IN (
    'connection_logs.export', 'connection_logs.ingest',
    'cgnat_attribution.manage', 'cgnat_attribution.ingest',
    'ip_attribution.view', 'ip_attribution.export'
  )
 WHERE r.name IN ('admin', 'super_admin')
   AND r.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM role_permissions rp
      WHERE rp.role_id = r.id AND rp.permission_id = p.id
   );

-- super_admin was introduced after the original government-request grants.
-- Backfill the complete case workflow required by IP-attribution permissions.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.name IN (
    'gov_data_requests.view', 'gov_data_requests.create', 'gov_data_requests.manage'
  )
 WHERE r.name = 'super_admin'
   AND r.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM role_permissions rp
      WHERE rp.role_id = r.id AND rp.permission_id = p.id
   );

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.name IN (
    'connection_logs.export'
  )
 WHERE r.name = 'auditor'
   AND r.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM role_permissions rp
      WHERE rp.role_id = r.id AND rp.permission_id = p.id
   );
