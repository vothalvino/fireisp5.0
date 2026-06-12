-- Migration 301 — Work Order Attachments (§12)
CREATE TABLE IF NOT EXISTS work_order_attachments (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  work_order_id    BIGINT UNSIGNED NOT NULL,
  filename         VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  mime_type        VARCHAR(100) NOT NULL,
  file_size        INT UNSIGNED NOT NULL,
  storage_path     VARCHAR(500) NOT NULL,
  uploaded_by      BIGINT UNSIGNED NOT NULL,
  organization_id  BIGINT UNSIGNED NOT NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_wo_attachments_work_order (work_order_id),
  KEY idx_wo_attachments_org (organization_id),
  CONSTRAINT fk_wo_attachments_work_order FOREIGN KEY (work_order_id)   REFERENCES work_orders(id)   ON DELETE CASCADE,
  CONSTRAINT fk_wo_attachments_uploader   FOREIGN KEY (uploaded_by)     REFERENCES users(id),
  CONSTRAINT fk_wo_attachments_org        FOREIGN KEY (organization_id)  REFERENCES organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO permissions (name, description, module)
SELECT 'work_order_attachments.view', 'View work order attachments', 'work_orders'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'work_order_attachments.view');

INSERT INTO permissions (name, description, module)
SELECT 'work_order_attachments.create', 'Upload work order attachments', 'work_orders'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'work_order_attachments.create');

INSERT INTO permissions (name, description, module)
SELECT 'work_order_attachments.delete', 'Delete work order attachments', 'work_orders'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'work_order_attachments.delete');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN ('work_order_attachments.view','work_order_attachments.create','work_order_attachments.delete')
WHERE r.name = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN ('work_order_attachments.view','work_order_attachments.create')
WHERE r.name IN ('support','technician')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name = 'work_order_attachments.view'
WHERE r.name = 'readonly'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );
