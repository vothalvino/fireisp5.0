-- =============================================================================
-- Migration 447 — legal document templates + on-site signing
-- =============================================================================
-- MX onboarding requires signed paper the flow never produced: the
-- installation authorization the client signs when the technician ARRIVES
-- (permission to enter, drill, mount) and the activation contract — the
-- PROFECO-registered contrato de adhesión (LFTR art. 191) — signed when the
-- install is DONE. A comodato annex covers rented equipment.
--
--   * document_templates — per-org, admin-managed Markdown bodies with
--     {{placeholders}}; the ISP pastes its real registered legal text and
--     flips is_active. Nothing is seeded: shipping filler legal text that an
--     ISP might present to real customers as-is would be worse than shipping
--     none.
--   * signed_documents — one row per generated instance: the rendered body is
--     FROZEN at generation and SHA-256 hashed, the client signs on the
--     technician's device (canvas image), and the row records signer name,
--     timestamp and IP — the Código de Comercio data-message audit trail for
--     a simple electronic signature.
--
-- Generation is a flow hook (startOrder mints one pending instance per active
-- template), and the work-order routes gate transitions on them: an
-- installation WO cannot move to in_progress while an arrival authorization
-- is pending, nor complete while an activation contract is pending. Both
-- gates only exist when the org actually activated such a template.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_447_legal_documents;
DELIMITER //
CREATE PROCEDURE migration_447_legal_documents()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'document_templates'
  ) THEN
    CREATE TABLE document_templates (
      id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      organization_id BIGINT UNSIGNED NULL
                          COMMENT 'Tenant organization; NULL = single-tenant deployment',
      template_type   ENUM('installation_authorization','activation_contract','equipment_comodato','custom')
                          NOT NULL DEFAULT 'custom'
                          COMMENT 'Flow hook: installation_authorization gates WO start, activation_contract gates WO completion',
      name            VARCHAR(200)    NOT NULL,
      body_md         MEDIUMTEXT      NOT NULL
                          COMMENT 'Markdown with {{placeholders}} (client.*, contract.*, plan.*, order.*, org.*, date)',
      is_active       TINYINT(1)      NOT NULL DEFAULT 0
                          COMMENT 'Only active templates generate instances; ship OFF so the ISP must review its legal text first',
      created_by      BIGINT UNSIGNED NULL,
      created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at      DATETIME        NULL,
      PRIMARY KEY (id),
      KEY idx_document_templates_org (organization_id),
      KEY idx_document_templates_type (template_type),
      KEY idx_document_templates_deleted (deleted_at),
      CONSTRAINT fk_document_templates_org FOREIGN KEY (organization_id)
          REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_document_templates_creator FOREIGN KEY (created_by)
          REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'signed_documents'
  ) THEN
    CREATE TABLE signed_documents (
      id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      organization_id  BIGINT UNSIGNED NULL,
      client_id        BIGINT UNSIGNED NOT NULL,
      contract_id      BIGINT UNSIGNED NULL,
      service_order_id BIGINT UNSIGNED NULL,
      work_order_id    BIGINT UNSIGNED NULL,
      template_id      BIGINT UNSIGNED NULL
                           COMMENT 'Source template; SET NULL if the template is later deleted — the frozen body below is authoritative',
      template_type    ENUM('installation_authorization','activation_contract','equipment_comodato','custom')
                           NOT NULL DEFAULT 'custom',
      title            VARCHAR(200)    NOT NULL,
      rendered_body    MEDIUMTEXT      NOT NULL
                           COMMENT 'Placeholder-substituted Markdown FROZEN at generation — what the client actually saw and signed',
      content_sha256   CHAR(64)        NOT NULL
                           COMMENT 'SHA-256 of rendered_body, stamped at generation and re-verified at signing',
      status           ENUM('pending','signed','declined','cancelled') NOT NULL DEFAULT 'pending',
      signer_name      VARCHAR(200)    NULL,
      signature_image  MEDIUMTEXT      NULL
                           COMMENT 'PNG data-URL of the on-screen signature stroke',
      signed_at        DATETIME        NULL,
      signed_ip        VARCHAR(45)     NULL,
      created_by       BIGINT UNSIGNED NULL,
      created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at       DATETIME        NULL,
      PRIMARY KEY (id),
      KEY idx_signed_documents_org (organization_id),
      KEY idx_signed_documents_client (client_id),
      KEY idx_signed_documents_contract (contract_id),
      KEY idx_signed_documents_so (service_order_id),
      KEY idx_signed_documents_wo (work_order_id),
      KEY idx_signed_documents_status (status),
      KEY idx_signed_documents_deleted (deleted_at),
      CONSTRAINT fk_signed_documents_org FOREIGN KEY (organization_id)
          REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_signed_documents_client FOREIGN KEY (client_id)
          REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT fk_signed_documents_contract FOREIGN KEY (contract_id)
          REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_signed_documents_so FOREIGN KEY (service_order_id)
          REFERENCES service_orders (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_signed_documents_wo FOREIGN KEY (work_order_id)
          REFERENCES work_orders (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_signed_documents_template FOREIGN KEY (template_id)
          REFERENCES document_templates (id) ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT fk_signed_documents_creator FOREIGN KEY (created_by)
          REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  END IF;
END //
DELIMITER ;

CALL migration_447_legal_documents();
DROP PROCEDURE IF EXISTS migration_447_legal_documents;

-- ---- permissions (idempotent) -----------------------------------------------
-- An unseeded slug = silent 403 for everyone except legacy admins.
INSERT INTO permissions (name, description, module)
SELECT 'document_templates.view', 'View legal document templates', 'documents'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'document_templates.view');
INSERT INTO permissions (name, description, module)
SELECT 'document_templates.create', 'Create legal document templates', 'documents'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'document_templates.create');
INSERT INTO permissions (name, description, module)
SELECT 'document_templates.update', 'Update legal document templates', 'documents'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'document_templates.update');
INSERT INTO permissions (name, description, module)
SELECT 'document_templates.delete', 'Delete legal document templates', 'documents'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'document_templates.delete');
INSERT INTO permissions (name, description, module)
SELECT 'signed_documents.view', 'View generated/signed legal documents', 'documents'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'signed_documents.view');
INSERT INTO permissions (name, description, module)
SELECT 'signed_documents.create', 'Generate legal document instances', 'documents'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'signed_documents.create');
INSERT INTO permissions (name, description, module)
SELECT 'signed_documents.sign', 'Capture a client signature on a pending document', 'documents'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'signed_documents.sign');

-- Grants. admin + super_admin: everything. manager: view both. technician:
-- view + sign + create (the on-site actor). readonly: view signed documents.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN (
  'document_templates.view', 'document_templates.create', 'document_templates.update', 'document_templates.delete',
  'signed_documents.view', 'signed_documents.create', 'signed_documents.sign'
)
WHERE r.name IN ('admin', 'super_admin')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN (
  'document_templates.view', 'signed_documents.view'
)
WHERE r.name = 'manager'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name IN (
  'signed_documents.view', 'signed_documents.create', 'signed_documents.sign'
)
WHERE r.name = 'technician'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'signed_documents.view'
WHERE r.name = 'readonly'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );
