DELIMITER $$

DROP PROCEDURE IF EXISTS fireisp_460_exec_if_missing$$
CREATE PROCEDURE fireisp_460_exec_if_missing(IN object_count BIGINT, IN ddl_sql TEXT)
BEGIN
    IF object_count = 0 THEN
        SET @fireisp_460_ddl = ddl_sql;
        PREPARE fireisp_460_stmt FROM @fireisp_460_ddl;
        EXECUTE fireisp_460_stmt;
        DEALLOCATE PREPARE fireisp_460_stmt;
        SET @fireisp_460_ddl = NULL;
    END IF;
END$$

DELIMITER ;

-- Migration 460: fail-closed outbound communication hardening.
-- A non-NULL SMTP password must have the AES-256-GCM envelope emitted by the
-- strict application writer: 12-byte IV, 16-byte authentication tag, and at
-- least one whole ciphertext byte, all hex encoded. Legacy plaintext and
-- malformed values are irreversibly discarded and the identity is disabled;
-- the stable error reveals no credential material or parser detail. A
-- structurally valid envelope with the wrong key is rejected by decryptStrict
-- at runtime because authenticity cannot be established in SQL.
-- Older test paths also stored raw Nodemailer/socket diagnostics. Retain only
-- the fact that a test failed; hostnames, banners and network details are not
-- a client-facing settings field.
UPDATE organization_email_settings
SET last_test_error = 'Email delivery failed.'
WHERE last_test_error IS NOT NULL
  AND last_test_error <> 'The saved SMTP credential is unavailable.';

UPDATE organization_email_settings
SET enabled = 0,
    smtp_password_encrypted = NULL,
    last_test_status = 'failed',
    last_test_error = 'The saved SMTP credential is unavailable.'
WHERE smtp_password_encrypted IS NOT NULL
  AND smtp_password_encrypted NOT REGEXP
      '^[0-9A-Fa-f]{24}:[0-9A-Fa-f]{32}:([0-9A-Fa-f]{2})+$';

-- Bind marketing consent to the client's current destination.
-- DDL is guarded because MySQL commits ALTER TABLE independently. A process
-- can therefore resume this migration after any completed statement without a
-- duplicate-column failure.
CALL fireisp_460_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'clients'
        AND column_name = 'email_contact_epoch'),
    'ALTER TABLE clients ADD COLUMN email_contact_epoch BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT ''Monotonic email identity used to fence email consent'' AFTER email'
);
CALL fireisp_460_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'clients'
        AND column_name = 'phone_contact_epoch'),
    'ALTER TABLE clients ADD COLUMN phone_contact_epoch BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT ''Monotonic phone identity used to fence SMS and WhatsApp consent'' AFTER phone'
);

-- Consent rows written by older application versions receive epoch 0. Client
-- epochs start at 1, so those rows fail closed to upgraded workers. Migration
-- 460 is nevertheless a stop/drain deployment because an old worker does not
-- know about this epoch or the new message-class contract.
CALL fireisp_460_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'subscriber_consents'
        AND column_name = 'communication_contact_epoch'),
    'ALTER TABLE subscriber_consents ADD COLUMN communication_contact_epoch BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT ''Client communication-contact epoch captured when consent was granted'' AFTER communication_channel'
);

-- Queue workers must use the consent class captured when work was enqueued,
-- not infer it later from a mutable template or campaign relationship.
CALL fireisp_460_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'email_logs'
        AND column_name = 'message_class'),
    'ALTER TABLE email_logs ADD COLUMN message_class ENUM(''marketing'',''transactional'',''security'',''support_reply'') NULL COMMENT ''Server-owned delivery class; NULL legacy client work fails closed at dispatch'' AFTER campaign_message_id'
);
CALL fireisp_460_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'sms_logs'
        AND column_name = 'message_class'),
    'ALTER TABLE sms_logs ADD COLUMN message_class ENUM(''marketing'',''transactional'',''security'',''support_reply'') NULL COMMENT ''Server-owned delivery class; NULL legacy client work fails closed at dispatch'' AFTER campaign_message_id'
);

-- Durable client work snapshots the authoritative organization lifecycle
-- epoch. Suspension/deletion increments that epoch in primary (migration
-- 459), so work queued before an offboarding interval cannot surprise-send
-- after a later reactivation, including rows stored in an isolated tenant DB.
CALL fireisp_460_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'email_logs'
        AND column_name = 'organization_epoch'),
    'ALTER TABLE email_logs ADD COLUMN organization_epoch BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT ''Authoritative organization outbound epoch captured at enqueue/send'' AFTER organization_id'
);
CALL fireisp_460_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'sms_logs'
        AND column_name = 'organization_epoch'),
    'ALTER TABLE sms_logs ADD COLUMN organization_epoch BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT ''Authoritative organization outbound epoch captured at enqueue/send'' AFTER organization_id'
);
CALL fireisp_460_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'campaign_messages'
        AND column_name = 'organization_epoch'),
    'ALTER TABLE campaign_messages ADD COLUMN organization_epoch BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT ''Authoritative organization outbound epoch captured at campaign dispatch'' AFTER organization_id'
);
CALL fireisp_460_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'email_logs'
        AND column_name = 'client_contact_epoch'),
    'ALTER TABLE email_logs ADD COLUMN client_contact_epoch BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT ''Client channel-contact epoch captured for this delivery'' AFTER client_id'
);
CALL fireisp_460_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'sms_logs'
        AND column_name = 'client_contact_epoch'),
    'ALTER TABLE sms_logs ADD COLUMN client_contact_epoch BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT ''Client channel-contact epoch captured for this delivery'' AFTER client_id'
);
CALL fireisp_460_exec_if_missing(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'campaign_messages'
        AND column_name = 'client_contact_epoch'),
    'ALTER TABLE campaign_messages ADD COLUMN client_contact_epoch BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT ''Client channel-contact epoch captured at campaign dispatch'' AFTER client_id'
);

-- Stable preference/lifecycle codes are intentionally descriptive and exceed
-- the legacy 20-character provider-code allowance. Widen before any upgraded
-- worker records a refusal so strict SQL mode cannot turn a safe skip into an
-- insert/update failure.
ALTER TABLE sms_logs
  MODIFY COLUMN error_code VARCHAR(64) NULL
    COMMENT 'Provider or stable application refusal code';

-- Pre-460 workers did not persist a distinct provider-invocation boundary.
-- A failed outbound SMS or campaign row may therefore represent either a
-- known pre-I/O refusal or a provider-accepted message whose outcome write was
-- lost. Conservatively fence every such legacy row as outcome-unknown. New
-- workers never auto-retry these markers, and campaign redispatch refuses an
-- unresolved row, preventing an upgrade from duplicating client messages.
UPDATE sms_logs
SET error_code = 'DELIVERY_OUTCOME_UNKNOWN',
    error_message = 'Legacy provider outcome is unknown; manual reconciliation is required.'
WHERE status = 'failed'
  AND direction = 'outbound'
  AND message_class IS NULL
  AND NOT (
    error_code <=> 'CLIENT_NOT_FOUND'
    AND error_message <=> 'Legacy queued client authorization unavailable; message skipped.'
  );

UPDATE campaign_messages
SET error_message = 'Provider invocation started; delivery outcome is unknown'
WHERE status = 'failed'
  AND client_contact_epoch = 0;

-- A legacy queued row with no durable client/class provenance cannot safely be
-- reclassified after upgrade. Terminalize it instead of allowing a NULL
-- client_id (including ON DELETE SET NULL) to turn client mail into an
-- unrestricted internal-recipient send. New writers always persist both the
-- client id and the server-owned message class before queueing.
UPDATE email_logs
SET status = 'failed',
    error_message = 'Legacy queued client authorization unavailable; message skipped.'
WHERE status = 'queued'
  AND (client_id IS NULL OR message_class IS NULL);

UPDATE sms_logs
SET status = 'failed',
    error_code = 'CLIENT_NOT_FOUND',
    error_message = 'Legacy queued client authorization unavailable; message skipped.'
WHERE status = 'queued'
  AND direction = 'outbound'
  AND (client_id IS NULL OR message_class IS NULL);

-- DND is the client-controlled veto for every client-directed message, not
-- only promotions. Marketing additionally requires affirmative consent.
ALTER TABLE client_dnd_preferences
  MODIFY COLUMN opt_out TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = block all client-directed delivery on this channel';

-- Older client-DND routes did not prove that caller-supplied client_id belonged
-- to the current organization. Repair any inconsistent rows to the client's
-- authoritative tenant and preserve the privacy-safe outcome (blocked) until
-- staff or the client explicitly records a new choice.
UPDATE client_dnd_preferences dnd
JOIN clients c ON c.id = dnd.client_id
SET dnd.organization_id = c.organization_id,
    dnd.opt_out = 1,
    dnd.reason = 'Review required after tenant ownership repair'
WHERE NOT (dnd.organization_id <=> c.organization_id);

-- Repair ownership metadata used by the positive-consent and bound WhatsApp
-- paths only when the client still has authoritative tenant ownership. A NULL
-- client organization may be the irreversible result of an organization hard
-- delete and must remain fail-closed for explicit operator reconciliation.
UPDATE subscriber_consents consent
JOIN clients c ON c.id = consent.client_id
SET consent.organization_id = c.organization_id
WHERE c.organization_id IS NOT NULL
  AND NOT (consent.organization_id <=> c.organization_id);

UPDATE whatsapp_links link_row
JOIN clients c ON c.id = link_row.client_id
SET link_row.organization_id = c.organization_id
WHERE c.organization_id IS NOT NULL
  AND NOT (link_row.organization_id <=> c.organization_id);

-- The epoch is database-managed. BINARY plus <=> makes comparison byte-exact
-- and NULL-safe, including case-only address edits and NULL transitions. The
-- ELSE branch prevents callers from changing the epoch without changing a
-- destination.
DELIMITER $$

DROP TRIGGER IF EXISTS trg_clients_communication_contact_epoch_bu$$
CREATE TRIGGER trg_clients_communication_contact_epoch_bu
BEFORE UPDATE ON clients
FOR EACH ROW
BEGIN
    IF NOT (BINARY NEW.email <=> BINARY OLD.email)
       OR NOT (NEW.deleted_at <=> OLD.deleted_at)
       OR ((NEW.status = 'inactive') <> (OLD.status = 'inactive')) THEN
        SET NEW.email_contact_epoch = OLD.email_contact_epoch + 1;
    ELSE
        SET NEW.email_contact_epoch = OLD.email_contact_epoch;
    END IF;

    IF NOT (BINARY NEW.phone <=> BINARY OLD.phone)
       OR NOT (NEW.deleted_at <=> OLD.deleted_at)
       OR ((NEW.status = 'inactive') <> (OLD.status = 'inactive')) THEN
        SET NEW.phone_contact_epoch = OLD.phone_contact_epoch + 1;
    ELSE
        SET NEW.phone_contact_epoch = OLD.phone_contact_epoch;
    END IF;
END$$

DELIMITER ;

-- Existing active marketing choices predate destination-bound consent. They
-- are withdrawn instead of being relabelled as epoch 1; that prevents an old
-- choice from silently authorizing whichever address is currently stored.
-- Restricting the update to epoch 0 makes a partial-resume safe: valid consent
-- captured by the new application at a positive epoch is never withdrawn.
UPDATE subscriber_consents
SET withdrawn_at = CURRENT_TIMESTAMP
WHERE purpose = 'marketing'
  AND communication_contact_epoch = 0
  AND withdrawn_at IS NULL;

DROP PROCEDURE IF EXISTS fireisp_460_exec_if_missing;
