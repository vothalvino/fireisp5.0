-- Rollback for migration 451 — installation consent provenance + acknowledgment
-- service_acknowledgment rows retain their frozen content but are classified as
-- custom before the ENUM is narrowed, avoiding data truncation in strict mode.

DROP PROCEDURE IF EXISTS rollback_451_installation_consent;
DELIMITER //
CREATE PROCEDURE rollback_451_installation_consent()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'template_type'
       AND COLUMN_TYPE LIKE '%service_acknowledgment%'
  ) THEN
    UPDATE signed_documents
       SET template_type = 'custom'
     WHERE template_type = 'service_acknowledgment';

    ALTER TABLE signed_documents
      MODIFY COLUMN template_type
        ENUM('installation_authorization','activation_contract','equipment_comodato','custom')
        NOT NULL DEFAULT 'custom';
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'document_templates'
       AND COLUMN_NAME = 'template_type'
       AND COLUMN_TYPE LIKE '%service_acknowledgment%'
  ) THEN
    UPDATE document_templates
       SET template_type = 'custom'
     WHERE template_type = 'service_acknowledgment';

    ALTER TABLE document_templates
      MODIFY COLUMN template_type
        ENUM('installation_authorization','activation_contract','equipment_comodato','custom')
        NOT NULL DEFAULT 'custom'
        COMMENT 'Flow hook: installation_authorization gates WO start, activation_contract gates WO completion';
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND CONSTRAINT_NAME = 'chk_signed_documents_mx_link_type'
  ) THEN
    ALTER TABLE signed_documents DROP CONSTRAINT chk_signed_documents_mx_link_type;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND CONSTRAINT_NAME = 'fk_signed_documents_contract_template_mx'
  ) THEN
    ALTER TABLE signed_documents DROP FOREIGN KEY fk_signed_documents_contract_template_mx;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND INDEX_NAME = 'idx_signed_documents_contract_template_mx'
  ) THEN
    ALTER TABLE signed_documents DROP INDEX idx_signed_documents_contract_template_mx;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'mx_source_sha256'
  ) THEN
    ALTER TABLE signed_documents DROP COLUMN mx_source_sha256;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'mx_template_version'
  ) THEN
    ALTER TABLE signed_documents DROP COLUMN mx_template_version;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'mx_registered_at'
  ) THEN
    ALTER TABLE signed_documents DROP COLUMN mx_registered_at;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'mx_registration_number'
  ) THEN
    ALTER TABLE signed_documents DROP COLUMN mx_registration_number;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'contract_template_mx_id'
  ) THEN
    ALTER TABLE signed_documents DROP COLUMN contract_template_mx_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'document_templates'
       AND CONSTRAINT_NAME = 'chk_document_templates_mx_link_type'
  ) THEN
    ALTER TABLE document_templates DROP CONSTRAINT chk_document_templates_mx_link_type;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'document_templates'
       AND CONSTRAINT_NAME = 'fk_document_templates_contract_template_mx'
  ) THEN
    ALTER TABLE document_templates DROP FOREIGN KEY fk_document_templates_contract_template_mx;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'document_templates'
       AND INDEX_NAME = 'idx_document_templates_contract_template_mx'
  ) THEN
    ALTER TABLE document_templates DROP INDEX idx_document_templates_contract_template_mx;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'document_templates'
       AND COLUMN_NAME = 'contract_template_mx_id'
  ) THEN
    ALTER TABLE document_templates DROP COLUMN contract_template_mx_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND CONSTRAINT_NAME = 'fk_sub_consents_service_order'
  ) THEN
    ALTER TABLE subscriber_consents
      DROP FOREIGN KEY fk_sub_consents_service_order;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND CONSTRAINT_NAME = 'fk_sub_consents_work_order'
  ) THEN
    ALTER TABLE subscriber_consents
      DROP FOREIGN KEY fk_sub_consents_work_order;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND CONSTRAINT_NAME = 'fk_sub_consents_signed_document'
  ) THEN
    ALTER TABLE subscriber_consents
      DROP FOREIGN KEY fk_sub_consents_signed_document;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND CONSTRAINT_NAME = 'fk_sub_consents_captured_by'
  ) THEN
    ALTER TABLE subscriber_consents
      DROP FOREIGN KEY fk_sub_consents_captured_by;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND INDEX_NAME = 'idx_subscriber_consents_active_channel'
  ) THEN
    ALTER TABLE subscriber_consents
      DROP INDEX idx_subscriber_consents_active_channel;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND INDEX_NAME = 'idx_subscriber_consents_service_order'
  ) THEN
    ALTER TABLE subscriber_consents
      DROP INDEX idx_subscriber_consents_service_order;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND INDEX_NAME = 'idx_subscriber_consents_work_order'
  ) THEN
    ALTER TABLE subscriber_consents
      DROP INDEX idx_subscriber_consents_work_order;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND INDEX_NAME = 'idx_subscriber_consents_signed_document'
  ) THEN
    ALTER TABLE subscriber_consents
      DROP INDEX idx_subscriber_consents_signed_document;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND INDEX_NAME = 'idx_subscriber_consents_captured_by'
  ) THEN
    ALTER TABLE subscriber_consents
      DROP INDEX idx_subscriber_consents_captured_by;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND COLUMN_NAME = 'captured_by'
  ) THEN
    ALTER TABLE subscriber_consents DROP COLUMN captured_by;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND COLUMN_NAME = 'signed_document_id'
  ) THEN
    ALTER TABLE subscriber_consents DROP COLUMN signed_document_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND COLUMN_NAME = 'work_order_id'
  ) THEN
    ALTER TABLE subscriber_consents DROP COLUMN work_order_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND COLUMN_NAME = 'service_order_id'
  ) THEN
    ALTER TABLE subscriber_consents DROP COLUMN service_order_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND COLUMN_NAME = 'source_context'
  ) THEN
    ALTER TABLE subscriber_consents DROP COLUMN source_context;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND COLUMN_NAME = 'communication_channel'
  ) THEN
    ALTER TABLE subscriber_consents DROP COLUMN communication_channel;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND CONSTRAINT_NAME = 'fk_signed_documents_captured_by'
  ) THEN
    ALTER TABLE signed_documents
      DROP FOREIGN KEY fk_signed_documents_captured_by;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND INDEX_NAME = 'idx_signed_documents_captured_by'
  ) THEN
    ALTER TABLE signed_documents
      DROP INDEX idx_signed_documents_captured_by;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'evidence_sha256'
  ) THEN
    ALTER TABLE signed_documents DROP COLUMN evidence_sha256;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'communication_choices'
  ) THEN
    ALTER TABLE signed_documents DROP COLUMN communication_choices;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'captured_by'
  ) THEN
    ALTER TABLE signed_documents DROP COLUMN captured_by;
  END IF;
END //
DELIMITER ;

CALL rollback_451_installation_consent();
DROP PROCEDURE IF EXISTS rollback_451_installation_consent;

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name = 'installations.start';
DELETE FROM permissions WHERE name = 'installations.start';
