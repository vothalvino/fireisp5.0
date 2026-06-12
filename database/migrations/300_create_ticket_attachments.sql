-- Migration 300 — Ticket Attachments (§12)
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id        BIGINT UNSIGNED NOT NULL,
  filename         VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  mime_type        VARCHAR(100) NOT NULL,
  file_size        INT UNSIGNED NOT NULL,
  storage_path     VARCHAR(500) NOT NULL,
  uploaded_by      BIGINT UNSIGNED NOT NULL,
  organization_id  BIGINT UNSIGNED NOT NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ticket_attachments_ticket (ticket_id),
  KEY idx_ticket_attachments_org (organization_id),
  CONSTRAINT fk_ticket_attachments_ticket  FOREIGN KEY (ticket_id)        REFERENCES tickets(id)       ON DELETE CASCADE,
  CONSTRAINT fk_ticket_attachments_uploader FOREIGN KEY (uploaded_by)     REFERENCES users(id),
  CONSTRAINT fk_ticket_attachments_org     FOREIGN KEY (organization_id)  REFERENCES organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO permissions (name, module, action, description) VALUES
  ('ticket_attachments.view',   'tickets', 'view',   'View ticket attachments'),
  ('ticket_attachments.create', 'tickets', 'create', 'Upload ticket attachments'),
  ('ticket_attachments.delete', 'tickets', 'delete', 'Delete ticket attachments');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin'
  AND p.name IN ('ticket_attachments.view','ticket_attachments.create','ticket_attachments.delete');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('support','technician')
  AND p.name IN ('ticket_attachments.view','ticket_attachments.create');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'readonly'
  AND p.name = 'ticket_attachments.view';
