-- =============================================================================
-- Migration 291: FUP / Data Pack RBAC permissions seed — §10.3
-- =============================================================================
-- Permissions seeded (module='fup'):
--   data_packs.view / create / update / delete          (4)
--   data_pack_purchases.view / create                   (2)
--   data_rollover.view / manage                         (2)
-- Total: 8 permissions
--
-- Role matrix:
--   admin       → all 8
--   technician  → data_packs.view/create/update, data_pack_purchases.view/create,
--                 data_rollover.view
--   readonly    → data_packs.view, data_pack_purchases.view, data_rollover.view
-- =============================================================================

INSERT INTO permissions (name, description, module)
SELECT 'data_packs.view',   'View data pack catalog',   'fup'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'data_packs.view');

INSERT INTO permissions (name, description, module)
SELECT 'data_packs.create', 'Create data packs',        'fup'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'data_packs.create');

INSERT INTO permissions (name, description, module)
SELECT 'data_packs.update', 'Update data packs',        'fup'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'data_packs.update');

INSERT INTO permissions (name, description, module)
SELECT 'data_packs.delete', 'Delete data packs',        'fup'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'data_packs.delete');

INSERT INTO permissions (name, description, module)
SELECT 'data_pack_purchases.view',   'View data pack purchases',   'fup'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'data_pack_purchases.view');

INSERT INTO permissions (name, description, module)
SELECT 'data_pack_purchases.create', 'Purchase data packs for subscribers', 'fup'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'data_pack_purchases.create');

INSERT INTO permissions (name, description, module)
SELECT 'data_rollover.view',   'View data rollover balances',   'fup'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'data_rollover.view');

INSERT INTO permissions (name, description, module)
SELECT 'data_rollover.manage', 'Trigger rollover accrual and manage balances', 'fup'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'data_rollover.manage');

-- admin: all 8
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'data_packs.view','data_packs.create','data_packs.update','data_packs.delete',
  'data_pack_purchases.view','data_pack_purchases.create',
  'data_rollover.view','data_rollover.manage'
)
WHERE r.name = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- technician: view/create/update for packs, view/create for purchases, view for rollover
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'data_packs.view','data_packs.create','data_packs.update',
  'data_pack_purchases.view','data_pack_purchases.create',
  'data_rollover.view'
)
WHERE r.name = 'technician'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- readonly: views only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'data_packs.view',
  'data_pack_purchases.view',
  'data_rollover.view'
)
WHERE r.name = 'readonly'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );
