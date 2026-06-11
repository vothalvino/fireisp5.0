-- =============================================================================
-- Migration 276: Add cpe_profile FK to cpe_devices, seed permissions and
--               vendor templates, seed scheduled tasks (§8.1/§8.2)
-- =============================================================================

-- 1. Add cpe_profile_id FK to cpe_devices (guarded by INFORMATION_SCHEMA check)

DROP PROCEDURE IF EXISTS _mig276_add_cpe_profile_fk;

DELIMITER //
CREATE PROCEDURE _mig276_add_cpe_profile_fk()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cpe_devices'
      AND CONSTRAINT_NAME = 'fk_cpe_devices_cpe_profile'
  ) THEN
    ALTER TABLE cpe_devices
      ADD CONSTRAINT fk_cpe_devices_cpe_profile
        FOREIGN KEY (cpe_profile_id) REFERENCES cpe_profiles(id)
        ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
//
DELIMITER ;

CALL _mig276_add_cpe_profile_fk();
DROP PROCEDURE IF EXISTS _mig276_add_cpe_profile_fk;

-- 2. Seed permissions

INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('cpe_devices.view',                    'View CPE Devices',                 'network'),
    ('cpe_devices.create',                  'Create CPE Devices',               'network'),
    ('cpe_devices.update',                  'Update CPE Devices',               'network'),
    ('cpe_devices.delete',                  'Delete CPE Devices',               'network'),
    ('cpe_tasks.view',                      'View CPE Tasks',                   'network'),
    ('cpe_tasks.create',                    'Create CPE Tasks',                 'network'),
    ('cpe_tasks.delete',                    'Delete CPE Tasks',                 'network'),
    ('cpe_parameters.view',                 'View CPE Parameters',              'network'),
    ('cpe_parameters.update',               'Update CPE Parameters',            'network'),
    ('cpe_profiles.view',                   'View CPE Profiles',                'network'),
    ('cpe_profiles.create',                 'Create CPE Profiles',              'network'),
    ('cpe_profiles.update',                 'Update CPE Profiles',              'network'),
    ('cpe_profiles.delete',                 'Delete CPE Profiles',              'network'),
    ('cpe_mappings.view',                   'View CPE Mappings',                'network'),
    ('cpe_mappings.create',                 'Create CPE Mappings',              'network'),
    ('cpe_mappings.update',                 'Update CPE Mappings',              'network'),
    ('cpe_mappings.delete',                 'Delete CPE Mappings',              'network'),
    ('cpe_firmware_versions.view',          'View CPE Firmware Versions',       'network'),
    ('cpe_firmware_versions.create',        'Create CPE Firmware Versions',     'network'),
    ('cpe_firmware_versions.update',        'Update CPE Firmware Versions',     'network'),
    ('cpe_firmware_versions.delete',        'Delete CPE Firmware Versions',     'network'),
    ('cpe_firmware_campaigns.view',         'View CPE Firmware Campaigns',      'network'),
    ('cpe_firmware_campaigns.create',       'Create CPE Firmware Campaigns',    'network'),
    ('cpe_firmware_campaigns.update',       'Update CPE Firmware Campaigns',    'network'),
    ('cpe_firmware_campaigns.delete',       'Delete CPE Firmware Campaigns',    'network'),
    ('cpe_firmware_campaigns.execute',      'Execute CPE Firmware Campaigns',   'network');

-- 3. Grant all new CPE permissions to admin role

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
    'cpe_devices.view', 'cpe_devices.create', 'cpe_devices.update', 'cpe_devices.delete',
    'cpe_tasks.view', 'cpe_tasks.create', 'cpe_tasks.delete',
    'cpe_parameters.view', 'cpe_parameters.update',
    'cpe_profiles.view', 'cpe_profiles.create', 'cpe_profiles.update', 'cpe_profiles.delete',
    'cpe_mappings.view', 'cpe_mappings.create', 'cpe_mappings.update', 'cpe_mappings.delete',
    'cpe_firmware_versions.view', 'cpe_firmware_versions.create', 'cpe_firmware_versions.update', 'cpe_firmware_versions.delete',
    'cpe_firmware_campaigns.view', 'cpe_firmware_campaigns.create', 'cpe_firmware_campaigns.update', 'cpe_firmware_campaigns.delete', 'cpe_firmware_campaigns.execute'
)
WHERE r.name = 'admin';

-- 4. Seed vendor template profiles (global, organization_id = NULL)

INSERT IGNORE INTO cpe_profiles (organization_id, name, description, manufacturer, wan_mode, wifi_band, status)
SELECT NULL, 'TP-Link Default', 'Default profile for TP-Link CPE devices', 'TP-Link', 'pppoe', 'dual', 'active'
WHERE NOT EXISTS (SELECT 1 FROM cpe_profiles WHERE name = 'TP-Link Default' AND organization_id IS NULL);

INSERT IGNORE INTO cpe_profiles (organization_id, name, description, manufacturer, wan_mode, wifi_band, status)
SELECT NULL, 'ZTE Default', 'Default profile for ZTE CPE devices', 'ZTE', 'pppoe', 'dual', 'active'
WHERE NOT EXISTS (SELECT 1 FROM cpe_profiles WHERE name = 'ZTE Default' AND organization_id IS NULL);

INSERT IGNORE INTO cpe_profiles (organization_id, name, description, manufacturer, wan_mode, wifi_band, status)
SELECT NULL, 'Huawei Default', 'Default profile for Huawei CPE devices', 'Huawei', 'pppoe', 'dual', 'active'
WHERE NOT EXISTS (SELECT 1 FROM cpe_profiles WHERE name = 'Huawei Default' AND organization_id IS NULL);

INSERT IGNORE INTO cpe_profiles (organization_id, name, description, manufacturer, wan_mode, wifi_band, status)
SELECT NULL, 'Fiberhome Default', 'Default profile for Fiberhome CPE devices', 'Fiberhome', 'pppoe', 'dual', 'active'
WHERE NOT EXISTS (SELECT 1 FROM cpe_profiles WHERE name = 'Fiberhome Default' AND organization_id IS NULL);

INSERT IGNORE INTO cpe_profiles (organization_id, name, description, manufacturer, wan_mode, wifi_band, status)
SELECT NULL, 'VSOL Default', 'Default profile for VSOL CPE devices', 'VSOL', 'pppoe', '2.4GHz', 'active'
WHERE NOT EXISTS (SELECT 1 FROM cpe_profiles WHERE name = 'VSOL Default' AND organization_id IS NULL);

INSERT IGNORE INTO cpe_profiles (organization_id, name, description, manufacturer, wan_mode, wifi_band, status)
SELECT NULL, 'D-Link Default', 'Default profile for D-Link CPE devices', 'D-Link', 'pppoe', 'dual', 'active'
WHERE NOT EXISTS (SELECT 1 FROM cpe_profiles WHERE name = 'D-Link Default' AND organization_id IS NULL);

INSERT IGNORE INTO cpe_profiles (organization_id, name, description, manufacturer, wan_mode, wifi_band, status)
SELECT NULL, 'Netis Default', 'Default profile for Netis CPE devices', 'Netis', 'pppoe', '2.4GHz', 'active'
WHERE NOT EXISTS (SELECT 1 FROM cpe_profiles WHERE name = 'Netis Default' AND organization_id IS NULL);

INSERT IGNORE INTO cpe_profiles (organization_id, name, description, manufacturer, wan_mode, wifi_band, status)
SELECT NULL, 'Tenda Default', 'Default profile for Tenda CPE devices', 'Tenda', 'pppoe', 'dual', 'active'
WHERE NOT EXISTS (SELECT 1 FROM cpe_profiles WHERE name = 'Tenda Default' AND organization_id IS NULL);

-- 5. Seed CWMP scheduled tasks

INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
SELECT
    NULL,
    'cpe_cwmp_task_processor',
    'other',
    'services/acs/cwmpTaskProcessor',
    'Process queued CWMP tasks for CPE devices — dequeues pending cpe_tasks and dispatches via ACS session',
    '* * * * *',
    'high',
    1,
    60,
    TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'cpe_cwmp_task_processor'
      AND organization_id IS NULL
);

INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
SELECT
    NULL,
    'cpe_firmware_campaign_processor',
    'other',
    'services/acs/firmwareCampaignProcessor',
    'Process scheduled CPE firmware upgrade campaigns — enqueues download tasks for target devices',
    '*/5 * * * *',
    'normal',
    2,
    300,
    TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'cpe_firmware_campaign_processor'
      AND organization_id IS NULL
);
