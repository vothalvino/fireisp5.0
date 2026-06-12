DROP TABLE IF EXISTS ticket_attachments;
DELETE FROM permissions WHERE name IN ('ticket_attachments.view','ticket_attachments.create','ticket_attachments.delete');
