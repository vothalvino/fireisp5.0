DELIMITER $$

DROP PROCEDURE IF EXISTS fireisp_460_rollback_if_present$$
CREATE PROCEDURE fireisp_460_rollback_if_present(IN object_count BIGINT, IN ddl_sql TEXT)
BEGIN
    IF object_count > 0 THEN
        SET @fireisp_460_rollback_ddl = ddl_sql;
        PREPARE fireisp_460_rollback_stmt FROM @fireisp_460_rollback_ddl;
        EXECUTE fireisp_460_rollback_stmt;
        DEALLOCATE PREPARE fireisp_460_rollback_stmt;
        SET @fireisp_460_rollback_ddl = NULL;
    END IF;
END$$

DELIMITER ;

-- Rollback 460 removes the destination-epoch schema. Marketing-consent
-- withdrawals are privacy-preserving history and are intentionally not
-- reversed; operators must collect a new affirmative choice if appropriate.
-- Invalid/plaintext SMTP credentials scrubbed by the migration are likewise
-- not restored, and affected identities remain disabled with their generic
-- failure status until an operator saves a new encrypted credential.
-- Client/DND/consent/WhatsApp tenant-ownership repairs, legacy queue
-- terminalization, and outcome-unknown delivery fences are also retained.
-- sms_logs.error_code remains widened to VARCHAR(64): shrinking it could
-- truncate stable refusal codes written while migration 460 was active.
DROP TRIGGER IF EXISTS trg_clients_communication_contact_epoch_bu;

ALTER TABLE client_dnd_preferences
  MODIFY COLUMN opt_out TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = opted out from marketing/bulk sends';

CALL fireisp_460_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'campaign_messages'
        AND column_name = 'client_contact_epoch'),
    'ALTER TABLE campaign_messages DROP COLUMN client_contact_epoch'
);

CALL fireisp_460_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'sms_logs'
        AND column_name = 'client_contact_epoch'),
    'ALTER TABLE sms_logs DROP COLUMN client_contact_epoch'
);

CALL fireisp_460_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'email_logs'
        AND column_name = 'client_contact_epoch'),
    'ALTER TABLE email_logs DROP COLUMN client_contact_epoch'
);

CALL fireisp_460_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'campaign_messages'
        AND column_name = 'organization_epoch'),
    'ALTER TABLE campaign_messages DROP COLUMN organization_epoch'
);

CALL fireisp_460_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'sms_logs'
        AND column_name = 'organization_epoch'),
    'ALTER TABLE sms_logs DROP COLUMN organization_epoch'
);

CALL fireisp_460_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'email_logs'
        AND column_name = 'organization_epoch'),
    'ALTER TABLE email_logs DROP COLUMN organization_epoch'
);

CALL fireisp_460_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'sms_logs'
        AND column_name = 'message_class'),
    'ALTER TABLE sms_logs DROP COLUMN message_class'
);

CALL fireisp_460_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'email_logs'
        AND column_name = 'message_class'),
    'ALTER TABLE email_logs DROP COLUMN message_class'
);

CALL fireisp_460_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'subscriber_consents'
        AND column_name = 'communication_contact_epoch'),
    'ALTER TABLE subscriber_consents DROP COLUMN communication_contact_epoch'
);

CALL fireisp_460_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'clients'
        AND column_name = 'phone_contact_epoch'),
    'ALTER TABLE clients DROP COLUMN phone_contact_epoch'
);

CALL fireisp_460_rollback_if_present(
    (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'clients'
        AND column_name = 'email_contact_epoch'),
    'ALTER TABLE clients DROP COLUMN email_contact_epoch'
);

DROP PROCEDURE IF EXISTS fireisp_460_rollback_if_present;
