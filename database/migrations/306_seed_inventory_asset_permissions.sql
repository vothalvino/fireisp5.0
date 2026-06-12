-- =============================================================================
-- Migration 306: Inventory & Asset Management permissions seed — §14
-- =============================================================================

-- vendors module
INSERT INTO permissions (name, description, module)
SELECT 'vendors.view', 'View vendors and suppliers', 'vendors'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'vendors.view');

INSERT INTO permissions (name, description, module)
SELECT 'vendors.create', 'Create vendors and suppliers', 'vendors'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'vendors.create');

INSERT INTO permissions (name, description, module)
SELECT 'vendors.update', 'Update vendors and suppliers', 'vendors'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'vendors.update');

INSERT INTO permissions (name, description, module)
SELECT 'vendors.delete', 'Delete vendors and suppliers', 'vendors'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'vendors.delete');

-- purchase_orders module
INSERT INTO permissions (name, description, module)
SELECT 'purchase_orders.view', 'View purchase orders', 'purchase_orders'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'purchase_orders.view');

INSERT INTO permissions (name, description, module)
SELECT 'purchase_orders.create', 'Create purchase orders', 'purchase_orders'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'purchase_orders.create');

INSERT INTO permissions (name, description, module)
SELECT 'purchase_orders.update', 'Update purchase orders', 'purchase_orders'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'purchase_orders.update');

INSERT INTO permissions (name, description, module)
SELECT 'purchase_orders.delete', 'Delete purchase orders', 'purchase_orders'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'purchase_orders.delete');

INSERT INTO permissions (name, description, module)
SELECT 'purchase_orders.receive', 'Mark purchase orders as received and update stock', 'purchase_orders'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'purchase_orders.receive');

-- assets module
INSERT INTO permissions (name, description, module)
SELECT 'assets.view', 'View assets and their details', 'assets'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'assets.view');

INSERT INTO permissions (name, description, module)
SELECT 'assets.create', 'Create new asset records', 'assets'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'assets.create');

INSERT INTO permissions (name, description, module)
SELECT 'assets.update', 'Update asset details', 'assets'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'assets.update');

INSERT INTO permissions (name, description, module)
SELECT 'assets.delete', 'Delete asset records', 'assets'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'assets.delete');

INSERT INTO permissions (name, description, module)
SELECT 'assets.assign', 'Assign and unassign assets to customers or devices', 'assets'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'assets.assign');

INSERT INTO permissions (name, description, module)
SELECT 'assets.dispose', 'Mark assets as disposed or written off', 'assets'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'assets.dispose');

INSERT INTO permissions (name, description, module)
SELECT 'assets.scan', 'Scan asset barcodes/QR codes for lookup', 'assets'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'assets.scan');

-- rma module
INSERT INTO permissions (name, description, module)
SELECT 'rma.view', 'View RMA requests', 'rma'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'rma.view');

INSERT INTO permissions (name, description, module)
SELECT 'rma.create', 'Create RMA requests', 'rma'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'rma.create');

INSERT INTO permissions (name, description, module)
SELECT 'rma.update', 'Update RMA requests and ship/receive actions', 'rma'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'rma.update');

INSERT INTO permissions (name, description, module)
SELECT 'rma.close', 'Close or deny RMA requests', 'rma'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'rma.close');

-- ---------------------------------------------------------------------------
-- Role assignments
-- ---------------------------------------------------------------------------

-- admin: all new permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'vendors.view','vendors.create','vendors.update','vendors.delete',
  'purchase_orders.view','purchase_orders.create','purchase_orders.update','purchase_orders.delete','purchase_orders.receive',
  'assets.view','assets.create','assets.update','assets.delete','assets.assign','assets.dispose','assets.scan',
  'rma.view','rma.create','rma.update','rma.close'
)
WHERE r.name = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- technician: all *.view + assets.assign + assets.scan + assets.create + purchase_orders.receive
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'vendors.view',
  'purchase_orders.view','purchase_orders.receive',
  'assets.view','assets.create','assets.assign','assets.scan',
  'rma.view'
)
WHERE r.name = 'technician'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- readonly: all *.view
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'vendors.view',
  'purchase_orders.view',
  'assets.view',
  'rma.view'
)
WHERE r.name = 'readonly'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );
