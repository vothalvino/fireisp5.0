-- Migration: 203_seed_plan_feature_permissions
-- Description: Seeds RBAC permissions for the new plan features in §2.1

INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('plans.radius_attributes', 'View RADIUS attribute preview for a plan',         'plans'),
    ('plans.speed_windows',     'Manage time-based speed windows for plans',         'plans'),
    ('plans.fup_throttle',      'Trigger FUP throttle and restore actions',          'plans');

-- admin: all plan permissions
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('plans.radius_attributes','plans.speed_windows','plans.fup_throttle')
WHERE  r.name = 'admin';

-- support: view RADIUS attributes and speed windows (no FUP control)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('plans.radius_attributes','plans.speed_windows')
WHERE  r.name = 'support';

-- technician: view RADIUS attributes only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('plans.radius_attributes')
WHERE  r.name = 'technician';

-- readonly: view RADIUS attributes only
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN ('plans.radius_attributes')
WHERE  r.name = 'readonly';
