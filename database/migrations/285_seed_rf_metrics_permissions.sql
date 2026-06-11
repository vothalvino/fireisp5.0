-- =============================================================================
-- Migration 285: Seed RBAC Permissions for §9.3 RF Metrics + Spectrum Scans
-- =============================================================================
-- Seeds 4 permissions for the wireless module:
--   spectrum_scans.*  (3): view, create, delete
--   rf_metrics.view   (1): view noise floor, air util, GPS sync dashboards
--
-- Role matrix:
--   admin       — all 4 permissions
--   technician  — spectrum_scans.view/create + rf_metrics.view
--   readonly    — spectrum_scans.view + rf_metrics.view
--
-- All INSERTs use INSERT IGNORE — idempotent/safe to re-run.
-- Role assignment uses INSERT IGNORE on (role_id, permission_id).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Part 1: Seed permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('spectrum_scans.view',   'View spectrum scan results',                  'wireless'),
    ('spectrum_scans.create', 'Initiate spectrum scans on AP devices',       'wireless'),
    ('spectrum_scans.delete', 'Delete spectrum scan records',                'wireless'),
    ('rf_metrics.view',       'View RF metrics dashboards (noise floor, air utilization, GPS sync)', 'wireless');

-- ---------------------------------------------------------------------------
-- Part 2: Assign to admin role (all 4)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
    'spectrum_scans.view', 'spectrum_scans.create', 'spectrum_scans.delete',
    'rf_metrics.view'
)
WHERE r.name = 'admin';

-- ---------------------------------------------------------------------------
-- Part 3: Assign to technician role
-- (spectrum_scans.view/create + rf_metrics.view)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
    'spectrum_scans.view', 'spectrum_scans.create',
    'rf_metrics.view'
)
WHERE r.name = 'technician';

-- ---------------------------------------------------------------------------
-- Part 4: Assign to readonly role (view permissions only)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
    'spectrum_scans.view',
    'rf_metrics.view'
)
WHERE r.name = 'readonly';
