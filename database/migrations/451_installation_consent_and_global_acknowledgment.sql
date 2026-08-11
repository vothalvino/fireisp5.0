-- =============================================================================
-- Migration 451 — installation consent provenance + global acknowledgment
-- =============================================================================
-- Communication preferences captured during installation must be an explicit,
-- auditable choice.  subscriber_consents.channel continues to record the
-- capture medium (web, app, paper, ...); communication_channel records the
-- delivery channel the subscriber actually accepted.  The remaining columns
-- bind that choice to the installation flow and the staff member who captured
-- it.
--
-- Global organizations use a jurisdiction-neutral service acknowledgment
-- instead of an MX-specific adhesion contract.  service_acknowledgment is a
-- distinct document type so the generic record can never be mistaken for a
-- jurisdiction-specific legal template.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_451_installation_consent;
DELIMITER //
CREATE PROCEDURE migration_451_installation_consent()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND COLUMN_NAME = 'communication_channel'
  ) THEN
    ALTER TABLE subscriber_consents
      ADD COLUMN communication_channel ENUM('email','sms','whatsapp') NULL
        COMMENT 'Optional delivery channel covered by this consent; channel records the capture medium'
        AFTER channel;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND COLUMN_NAME = 'source_context'
  ) THEN
    ALTER TABLE subscriber_consents
      ADD COLUMN source_context VARCHAR(40) NULL
        COMMENT 'Workflow that captured the choice, for example installation or portal'
        AFTER communication_channel;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND COLUMN_NAME = 'service_order_id'
  ) THEN
    ALTER TABLE subscriber_consents
      ADD COLUMN service_order_id BIGINT UNSIGNED NULL
        COMMENT 'Service order during which the consent choice was captured'
        AFTER source_context;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND COLUMN_NAME = 'work_order_id'
  ) THEN
    ALTER TABLE subscriber_consents
      ADD COLUMN work_order_id BIGINT UNSIGNED NULL
        COMMENT 'Field work order during which the consent choice was captured'
        AFTER service_order_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND COLUMN_NAME = 'signed_document_id'
  ) THEN
    ALTER TABLE subscriber_consents
      ADD COLUMN signed_document_id BIGINT UNSIGNED NULL
        COMMENT 'Signed acknowledgment that presented this communication choice'
        AFTER work_order_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND COLUMN_NAME = 'captured_by'
  ) THEN
    ALTER TABLE subscriber_consents
      ADD COLUMN captured_by BIGINT UNSIGNED NULL
        COMMENT 'Staff user who recorded the subscriber choice; NULL for self-service/system capture'
        AFTER signed_document_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND INDEX_NAME = 'idx_subscriber_consents_active_channel'
  ) THEN
    ALTER TABLE subscriber_consents
      ADD KEY idx_subscriber_consents_active_channel
        (client_id, purpose, communication_channel, withdrawn_at);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND INDEX_NAME = 'idx_subscriber_consents_service_order'
  ) THEN
    ALTER TABLE subscriber_consents
      ADD KEY idx_subscriber_consents_service_order (service_order_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND INDEX_NAME = 'idx_subscriber_consents_work_order'
  ) THEN
    ALTER TABLE subscriber_consents
      ADD KEY idx_subscriber_consents_work_order (work_order_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND INDEX_NAME = 'idx_subscriber_consents_signed_document'
  ) THEN
    ALTER TABLE subscriber_consents
      ADD KEY idx_subscriber_consents_signed_document (signed_document_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND INDEX_NAME = 'idx_subscriber_consents_captured_by'
  ) THEN
    ALTER TABLE subscriber_consents
      ADD KEY idx_subscriber_consents_captured_by (captured_by);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND CONSTRAINT_NAME = 'fk_sub_consents_service_order'
  ) THEN
    ALTER TABLE subscriber_consents
      ADD CONSTRAINT fk_sub_consents_service_order FOREIGN KEY (service_order_id)
        REFERENCES service_orders (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND CONSTRAINT_NAME = 'fk_sub_consents_work_order'
  ) THEN
    ALTER TABLE subscriber_consents
      ADD CONSTRAINT fk_sub_consents_work_order FOREIGN KEY (work_order_id)
        REFERENCES work_orders (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND CONSTRAINT_NAME = 'fk_sub_consents_signed_document'
  ) THEN
    ALTER TABLE subscriber_consents
      ADD CONSTRAINT fk_sub_consents_signed_document FOREIGN KEY (signed_document_id)
        REFERENCES signed_documents (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriber_consents'
       AND CONSTRAINT_NAME = 'fk_sub_consents_captured_by'
  ) THEN
    ALTER TABLE subscriber_consents
      ADD CONSTRAINT fk_sub_consents_captured_by FOREIGN KEY (captured_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'document_templates'
       AND COLUMN_NAME = 'contract_template_mx_id'
  ) THEN
    ALTER TABLE document_templates
      ADD COLUMN contract_template_mx_id BIGINT UNSIGNED NULL
        COMMENT 'Exact organization-owned registered MX source; required before an activation_contract can be active'
        AFTER body_md;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'document_templates'
       AND INDEX_NAME = 'idx_document_templates_contract_template_mx'
  ) THEN
    ALTER TABLE document_templates
      ADD KEY idx_document_templates_contract_template_mx (contract_template_mx_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'document_templates'
       AND CONSTRAINT_NAME = 'fk_document_templates_contract_template_mx'
  ) THEN
    ALTER TABLE document_templates
      ADD CONSTRAINT fk_document_templates_contract_template_mx
        FOREIGN KEY (contract_template_mx_id) REFERENCES contract_templates_mx (id)
        ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'document_templates'
       AND CONSTRAINT_NAME = 'chk_document_templates_mx_link_type'
  ) THEN
    ALTER TABLE document_templates
      ADD CONSTRAINT chk_document_templates_mx_link_type
        CHECK (contract_template_mx_id IS NULL OR template_type = 'activation_contract');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'captured_by'
  ) THEN
    ALTER TABLE signed_documents
      ADD COLUMN captured_by BIGINT UNSIGNED NULL
        COMMENT 'Staff user who captured the client signature; NULL for self-service/system capture'
        AFTER signed_ip;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND INDEX_NAME = 'idx_signed_documents_captured_by'
  ) THEN
    ALTER TABLE signed_documents
      ADD KEY idx_signed_documents_captured_by (captured_by);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'communication_choices'
  ) THEN
    ALTER TABLE signed_documents
      ADD COLUMN communication_choices JSON NULL
        COMMENT 'Exact optional email/SMS/WhatsApp choices captured with this customer signature'
        AFTER captured_by;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'evidence_sha256'
  ) THEN
    ALTER TABLE signed_documents
      ADD COLUMN evidence_sha256 CHAR(64) NULL
        COMMENT 'SHA-256 of the canonical signature, identity, document, and communication-choice evidence envelope'
        AFTER communication_choices;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'contract_template_mx_id'
  ) THEN
    ALTER TABLE signed_documents
      ADD COLUMN contract_template_mx_id BIGINT UNSIGNED NULL
        COMMENT 'Registered MX source snapshotted when this document was generated'
        AFTER evidence_sha256;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'mx_registration_number'
  ) THEN
    ALTER TABLE signed_documents
      ADD COLUMN mx_registration_number VARCHAR(100) NULL
        COMMENT 'Official registration number frozen at generation'
        AFTER contract_template_mx_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'mx_registered_at'
  ) THEN
    ALTER TABLE signed_documents
      ADD COLUMN mx_registered_at DATE NULL
        COMMENT 'Official registration date frozen at generation'
        AFTER mx_registration_number;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'mx_template_version'
  ) THEN
    ALTER TABLE signed_documents
      ADD COLUMN mx_template_version VARCHAR(20) NULL
        COMMENT 'Registered source version frozen at generation'
        AFTER mx_registered_at;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'mx_source_sha256'
  ) THEN
    ALTER TABLE signed_documents
      ADD COLUMN mx_source_sha256 CHAR(64) NULL
        COMMENT 'SHA-256 of the exact registered, pre-render source text'
        AFTER mx_template_version;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND INDEX_NAME = 'idx_signed_documents_contract_template_mx'
  ) THEN
    ALTER TABLE signed_documents
      ADD KEY idx_signed_documents_contract_template_mx (contract_template_mx_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND CONSTRAINT_NAME = 'fk_signed_documents_contract_template_mx'
  ) THEN
    ALTER TABLE signed_documents
      ADD CONSTRAINT fk_signed_documents_contract_template_mx
        FOREIGN KEY (contract_template_mx_id) REFERENCES contract_templates_mx (id)
        ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND CONSTRAINT_NAME = 'chk_signed_documents_mx_link_type'
  ) THEN
    ALTER TABLE signed_documents
      ADD CONSTRAINT chk_signed_documents_mx_link_type
        CHECK (contract_template_mx_id IS NULL OR template_type = 'activation_contract');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND CONSTRAINT_NAME = 'fk_signed_documents_captured_by'
  ) THEN
    ALTER TABLE signed_documents
      ADD CONSTRAINT fk_signed_documents_captured_by FOREIGN KEY (captured_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'document_templates'
       AND COLUMN_NAME = 'template_type'
       AND COLUMN_TYPE NOT LIKE '%service_acknowledgment%'
  ) THEN
    ALTER TABLE document_templates
      MODIFY COLUMN template_type
        ENUM('installation_authorization','activation_contract','service_acknowledgment','equipment_comodato','custom')
        NOT NULL DEFAULT 'custom'
        COMMENT 'Flow hook: installation_authorization gates WO start; activation_contract and service_acknowledgment are signed at handoff';
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
       AND COLUMN_NAME = 'template_type'
       AND COLUMN_TYPE NOT LIKE '%service_acknowledgment%'
  ) THEN
    ALTER TABLE signed_documents
      MODIFY COLUMN template_type
        ENUM('installation_authorization','activation_contract','service_acknowledgment','equipment_comodato','custom')
        NOT NULL DEFAULT 'custom';
  END IF;
END //
DELIMITER ;

CALL migration_451_installation_consent();
DROP PROCEDURE IF EXISTS migration_451_installation_consent;

-- Starting a new installation is a composite command: it may convert a lead,
-- create a pending contract, provision RADIUS, and dispatch field work. Do not
-- let the narrower service_orders.update permission imply all those writes.
INSERT IGNORE INTO permissions (name, description, module) VALUES
  ('installations.start', 'Convert a lead and create/provision a new installation contract', 'lifecycle');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.name = 'installations.start'
 WHERE r.name IN ('admin', 'super_admin', 'support');
