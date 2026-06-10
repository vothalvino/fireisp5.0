-- Migration: 197_seed_interaction_permissions
-- Description: Seeds the RBAC permissions for the Interaction Tracking module
--              (isp-platform-features.md §1.3) and assigns them to the default
--              system roles.
--
--              Permission slugs (module = 'interactions'):
--                interactions.view/create/update/delete
--                follow_ups.view/create/update/delete
--                surveys.view/create/update/delete
--                escalations.view/create/update
--
--              Uses INSERT IGNORE throughout so re-running on an existing
--              installation is safe.

-- -------------------------------------------------------------------------
-- 1. New permissions
-- -------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('interactions.view',   'View client interaction history and activity timelines', 'interactions'),
    ('interactions.create', 'Log client interactions (calls, visits, chats)',         'interactions'),
    ('interactions.update', 'Edit logged client interactions',                        'interactions'),
    ('interactions.delete', 'Delete logged client interactions',                      'interactions'),
    ('follow_ups.view',     'View follow-up reminders',                               'interactions'),
    ('follow_ups.create',   'Create follow-up reminders',                             'interactions'),
    ('follow_ups.update',   'Complete, reschedule, and edit follow-up reminders',     'interactions'),
    ('follow_ups.delete',   'Delete follow-up reminders',                             'interactions'),
    ('surveys.view',        'View satisfaction surveys and NPS/CSAT metrics',         'interactions'),
    ('surveys.create',      'Create and send satisfaction surveys',                   'interactions'),
    ('surveys.update',      'Record survey responses and edit surveys',               'interactions'),
    ('surveys.delete',      'Delete satisfaction surveys',                            'interactions'),
    ('escalations.view',    'View ticket escalations and escalation candidates',      'interactions'),
    ('escalations.create',  'Escalate tickets',                                       'interactions'),
    ('escalations.update',  'Acknowledge and resolve ticket escalations',             'interactions');

-- -------------------------------------------------------------------------
-- 2. Assign permissions to roles
-- -------------------------------------------------------------------------

-- admin: every interaction-tracking permission
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.module = 'interactions'
WHERE  r.name = 'admin';

-- support: full day-to-day interaction management (no hard deletes of surveys)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'interactions.view','interactions.create','interactions.update','interactions.delete',
           'follow_ups.view','follow_ups.create','follow_ups.update','follow_ups.delete',
           'surveys.view','surveys.create','surveys.update',
           'escalations.view','escalations.create','escalations.update'
       )
WHERE  r.name = 'support';

-- billing: view interaction history and survey metrics
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'interactions.view','follow_ups.view','surveys.view'
       )
WHERE  r.name = 'billing';

-- technician: view + work their own follow-ups, view escalations
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'interactions.view','follow_ups.view','follow_ups.update','escalations.view'
       )
WHERE  r.name = 'technician';

-- readonly: view-only across the module
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
JOIN   permissions p ON p.name IN (
           'interactions.view','follow_ups.view','surveys.view','escalations.view'
       )
WHERE  r.name = 'readonly';
