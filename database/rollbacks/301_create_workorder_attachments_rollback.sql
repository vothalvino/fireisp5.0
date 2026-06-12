-- Rollback 301 — Work Order Attachments (§12)
DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN ('work_order_attachments.view','work_order_attachments.create','work_order_attachments.delete');

DELETE FROM permissions WHERE name IN ('work_order_attachments.view','work_order_attachments.create','work_order_attachments.delete');

DROP TABLE IF EXISTS work_order_attachments;
