DROP TABLE IF EXISTS work_order_attachments;
DELETE FROM permissions WHERE name IN ('work_order_attachments.view','work_order_attachments.create','work_order_attachments.delete');
