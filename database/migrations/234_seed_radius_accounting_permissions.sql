-- =============================================================================
-- Migration 234: RBAC permissions for RADIUS Accounting Phase C
-- =============================================================================
-- Implements isp-platform-features.md §3.3 "RADIUS Accounting Phase C":
--   Seeds permissions for accounting ingest, CDR export, CoA/Disconnect,
--   MAC move event visibility, and NAS health status visibility.
--
-- Permissions seeded:
--   radius.accounting_ingest    — server-to-server accounting ingest endpoint
--   radius.cdr_export           — export CDR session records
--   radius.coa                  — send dynamic CoA/Disconnect to NAS
--   radius.mac_move_events.view — view MAC move events
--   nas.health                  — view NAS health status
--
-- Role matrix:
--   admin       — all 5 permissions
--   technician  — radius.cdr_export, radius.mac_move_events.view, nas.health
--   support     — radius.mac_move_events.view
--   readonly    — radius.cdr_export, radius.mac_move_events.view, nas.health
--   billing     — none
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Seed permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('radius.accounting_ingest',    'Ingest RADIUS accounting records (server-to-server endpoint)',  'radius'),
    ('radius.cdr_export',           'Export CDR session records',                                    'radius'),
    ('radius.coa',                  'Send dynamic CoA/Disconnect to NAS',                            'radius'),
    ('radius.mac_move_events.view', 'View MAC move events',                                          'radius'),
    ('nas.health',                  'View NAS health status',                                        'nas');

-- ---------------------------------------------------------------------------
-- admin: all 5 permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'radius.accounting_ingest',
           'radius.cdr_export',
           'radius.coa',
           'radius.mac_move_events.view',
           'nas.health'
       )
WHERE  r.name = 'admin';

-- ---------------------------------------------------------------------------
-- technician: cdr_export, mac_move_events.view, nas.health
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'radius.cdr_export',
           'radius.mac_move_events.view',
           'nas.health'
       )
WHERE  r.name = 'technician';

-- ---------------------------------------------------------------------------
-- support: mac_move_events.view only
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'radius.mac_move_events.view'
       )
WHERE  r.name = 'support';

-- ---------------------------------------------------------------------------
-- readonly: cdr_export, mac_move_events.view, nas.health
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'radius.cdr_export',
           'radius.mac_move_events.view',
           'nas.health'
       )
WHERE  r.name = 'readonly';
