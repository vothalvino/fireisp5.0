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

INSERT INTO permissions (name, description, module)
SELECT 'ticket_attachments.view', 'View ticket attachments', 'tickets'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ticket_attachments.view');

INSERT INTO permissions (name, description, module)
SELECT 'ticket_attachments.create', 'Upload ticket attachments', 'tickets'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ticket_attachments.create');

INSERT INTO permissions (name, description, module)
SELECT 'ticket_attachments.delete', 'Delete ticket attachments', 'tickets'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ticket_attachments.delete');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN ('ticket_attachments.view','ticket_attachments.create','ticket_attachments.delete')
WHERE r.name = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN ('ticket_attachments.view','ticket_attachments.create')
WHERE r.name IN ('support','technician')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name = 'ticket_attachments.view'
WHERE r.name = 'readonly'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );
