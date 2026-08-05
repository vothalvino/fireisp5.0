-- Rollback for migration 447 — legal document templates + on-site signing
DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN (
  'document_templates.view', 'document_templates.create', 'document_templates.update', 'document_templates.delete',
  'signed_documents.view', 'signed_documents.create', 'signed_documents.sign'
);
DELETE FROM permissions WHERE name IN (
  'document_templates.view', 'document_templates.create', 'document_templates.update', 'document_templates.delete',
  'signed_documents.view', 'signed_documents.create', 'signed_documents.sign'
);
DROP TABLE IF EXISTS signed_documents;
DROP TABLE IF EXISTS document_templates;
