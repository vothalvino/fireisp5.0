-- Rollback 459: remove durable SNMP trap forwarding delivery support.
-- Intentionally does NOT re-enable rules paused during the upgrade: their
-- destinations were never security-reviewed and restoring active state would
-- recreate the unsafe surprise-delivery behavior this migration prevents.
-- Historical audit destination fields and SNMP communities scrubbed by the
-- migration are privacy deletions and are intentionally not restored.

-- Version 459 stores webhook signing secrets as AES-GCM envelopes. Older
-- application versions treated this column as plaintext and would sign with
-- the ciphertext after a downgrade. Pause every configured webhook and clear
-- the incompatible value; an operator must rotate/re-enter the secret before
-- deliberately re-enabling it on the older release.
UPDATE webhooks
SET is_active = FALSE, secret_encrypted = NULL
WHERE secret_encrypted IS NOT NULL;

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name = 'snmp_traps.payload.view';

DELETE FROM permissions WHERE name = 'snmp_traps.payload.view';

DROP TRIGGER IF EXISTS trg_webhooks_cancel_trap_unclaimed_bu;
DROP TRIGGER IF EXISTS trg_stfr_cancel_unclaimed_bu;
DROP TRIGGER IF EXISTS trg_organizations_cancel_outbound_au;
DROP TRIGGER IF EXISTS trg_organizations_outbound_epoch_bu;
DROP TRIGGER IF EXISTS trg_stfr_active_limit_bu;
DROP TRIGGER IF EXISTS trg_stfr_active_limit_bi;

DROP TRIGGER IF EXISTS trg_webhooks_active_limit_bu;
DROP TRIGGER IF EXISTS trg_webhooks_active_limit_bi;

DROP TABLE IF EXISTS snmp_trap_forwarding_deliveries;
DROP TABLE IF EXISTS snmp_trap_ingest_daily_usage;

DROP TRIGGER IF EXISTS trg_stfr_clear_review_bu;

DELIMITER $$

DROP PROCEDURE IF EXISTS fireisp_459_rollback_if_present$$
CREATE PROCEDURE fireisp_459_rollback_if_present(IN object_count BIGINT, IN ddl_sql TEXT)
BEGIN
    IF object_count > 0 THEN
        SET @fireisp_459_rollback_ddl = ddl_sql;
        PREPARE fireisp_459_rollback_stmt FROM @fireisp_459_rollback_ddl;
        EXECUTE fireisp_459_rollback_stmt;
        DEALLOCATE PREPARE fireisp_459_rollback_stmt;
        SET @fireisp_459_rollback_ddl = NULL;
    END IF;
END$$

DELIMITER ;

CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries'
        AND column_name = 'status' AND column_type LIKE '%processing%'),
    'UPDATE webhook_deliveries SET status = ''retrying'', next_retry_at = COALESCE(next_retry_at, NOW()) WHERE status = ''processing'''
);
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries'
        AND index_name = 'idx_webhook_deliveries_processing'),
    'ALTER TABLE webhook_deliveries DROP INDEX idx_webhook_deliveries_processing'
);
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries'
        AND column_name = 'revoked_at'),
    'ALTER TABLE webhook_deliveries DROP COLUMN revoked_at'
);
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries'
        AND column_name = 'claim_token'),
    'ALTER TABLE webhook_deliveries DROP COLUMN claim_token'
);
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries'
        AND column_name = 'locked_at'),
    'ALTER TABLE webhook_deliveries DROP COLUMN locked_at'
);
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries'
        AND column_name = 'recovery_count'),
    'ALTER TABLE webhook_deliveries DROP COLUMN recovery_count'
);
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries'
        AND column_name = 'target_url'),
    'ALTER TABLE webhook_deliveries DROP COLUMN target_url'
);
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries'
        AND column_name = 'organization_epoch'),
    'ALTER TABLE webhook_deliveries DROP COLUMN organization_epoch'
);
ALTER TABLE webhook_deliveries
  MODIFY COLUMN status ENUM('pending','success','failed','retrying','dead_letter')
  NOT NULL DEFAULT 'pending' COMMENT 'Delivery outcome status';
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'snmp_traps'
        AND column_name = 'varbinds_truncation_reason'),
    'ALTER TABLE snmp_traps DROP COLUMN varbinds_truncation_reason'
);
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'snmp_traps'
        AND column_name = 'varbinds_original_count'),
    'ALTER TABLE snmp_traps DROP COLUMN varbinds_original_count'
);
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'snmp_traps'
        AND column_name = 'varbinds_truncated'),
    'ALTER TABLE snmp_traps DROP COLUMN varbinds_truncated'
);

CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'devices'
        AND index_name = 'idx_devices_ipv6_address_bin'),
    'ALTER TABLE devices DROP INDEX idx_devices_ipv6_address_bin'
);
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'devices'
        AND index_name = 'idx_devices_ip_address_bin'),
    'ALTER TABLE devices DROP INDEX idx_devices_ip_address_bin'
);
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'devices'
        AND column_name = 'ipv6_address_bin'),
    'ALTER TABLE devices DROP COLUMN ipv6_address_bin'
);
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'devices'
        AND column_name = 'ip_address_bin'),
    'ALTER TABLE devices DROP COLUMN ip_address_bin'
);
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'organizations'
        AND column_name = 'outbound_delivery_epoch'),
    'ALTER TABLE organizations DROP COLUMN outbound_delivery_epoch'
);

UPDATE scheduled_tasks
SET description = 'Process due webhook retry deliveries — picks up retrying rows whose next_retry_at <= NOW(), makes one HTTP attempt per row, reschedules or dead-letters based on attempt count.'
WHERE task_name = 'webhook_retry';

CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'snmp_trap_forwarding_rules'
        AND index_name = 'idx_stfr_match_ready'),
    'ALTER TABLE snmp_trap_forwarding_rules DROP INDEX idx_stfr_match_ready'
);
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'snmp_trap_forwarding_rules'
        AND index_name = 'idx_stfr_org_active_deleted'),
    'ALTER TABLE snmp_trap_forwarding_rules DROP INDEX idx_stfr_org_active_deleted'
);
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'snmp_trap_forwarding_rules'
        AND column_name = 'last_delivery_is_test'),
    'ALTER TABLE snmp_trap_forwarding_rules DROP COLUMN last_delivery_is_test'
);
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'snmp_trap_forwarding_rules'
        AND column_name = 'last_error'),
    'ALTER TABLE snmp_trap_forwarding_rules DROP COLUMN last_error'
);
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'snmp_trap_forwarding_rules'
        AND column_name = 'last_delivery_at'),
    'ALTER TABLE snmp_trap_forwarding_rules DROP COLUMN last_delivery_at'
);
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'snmp_trap_forwarding_rules'
        AND column_name = 'last_delivery_status'),
    'ALTER TABLE snmp_trap_forwarding_rules DROP COLUMN last_delivery_status'
);
CALL fireisp_459_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'snmp_trap_forwarding_rules'
        AND column_name = 'configuration_reviewed_at'),
    'ALTER TABLE snmp_trap_forwarding_rules DROP COLUMN configuration_reviewed_at'
);

DROP PROCEDURE IF EXISTS fireisp_459_rollback_if_present;
