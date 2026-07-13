-- Rollback 383: Seed radius.credentials.view permission
-- role_permissions rows cascade via fk_role_permissions_permission ON DELETE CASCADE
DELETE FROM permissions WHERE name = 'radius.credentials.view';
