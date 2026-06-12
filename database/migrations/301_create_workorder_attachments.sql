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

INSERT IGNORE INTO permissions (name, module, action, description) VALUES
  ('work_order_attachments.view',   'work_orders', 'view',   'View work order attachments'),
  ('work_order_attachments.create', 'work_orders', 'create', 'Upload work order attachments'),
  ('work_order_attachments.delete', 'work_orders', 'delete', 'Delete work order attachments');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin'
  AND p.name IN ('work_order_attachments.view','work_order_attachments.create','work_order_attachments.delete');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('support','technician')
  AND p.name IN ('work_order_attachments.view','work_order_attachments.create');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'readonly'
  AND p.name = 'work_order_attachments.view';
