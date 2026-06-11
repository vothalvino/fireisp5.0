-- Migration 214: Seed RBAC permissions for cash reconciliation sessions

INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('cash_reconciliation.view',    'View cash reconciliation sessions and summaries',       'billing'),
    ('cash_reconciliation.create',  'Open new cash reconciliation sessions',                 'billing'),
    ('cash_reconciliation.update',  'Update and close cash reconciliation sessions',         'billing'),
    ('cash_reconciliation.approve', 'Approve or dispute closed cash reconciliation sessions','billing');

-- admin: all permissions
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'cash_reconciliation.view',
           'cash_reconciliation.create',
           'cash_reconciliation.update',
           'cash_reconciliation.approve'
       )
WHERE  r.name = 'admin';

-- billing: view + create + update (no approve)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'cash_reconciliation.view',
           'cash_reconciliation.create',
           'cash_reconciliation.update'
       )
WHERE  r.name = 'billing';

-- technician: view + create + update (field agents open/close their own sessions)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'cash_reconciliation.view',
           'cash_reconciliation.create',
           'cash_reconciliation.update'
       )
WHERE  r.name = 'technician';

-- support: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('cash_reconciliation.view')
WHERE  r.name = 'support';

-- readonly: view only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('cash_reconciliation.view')
WHERE  r.name = 'readonly';
