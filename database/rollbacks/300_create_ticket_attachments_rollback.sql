-- Rollback 300 — Ticket Attachments (§12)
DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN ('ticket_attachments.view','ticket_attachments.create','ticket_attachments.delete');

DELETE FROM permissions WHERE name IN ('ticket_attachments.view','ticket_attachments.create','ticket_attachments.delete');

DROP TABLE IF EXISTS ticket_attachments;
