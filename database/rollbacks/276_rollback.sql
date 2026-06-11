-- =============================================================================
-- Rollback 276: Remove CPE FK, permissions, vendor seeds, scheduled tasks (§8.1/§8.2)
-- =============================================================================

-- Remove scheduled tasks
DELETE FROM scheduled_tasks
WHERE task_name IN ('cpe_cwmp_task_processor', 'cpe_firmware_campaign_processor')
  AND organization_id IS NULL;

-- Remove vendor seed profiles
DELETE FROM cpe_profiles
WHERE name IN (
    'TP-Link Default', 'ZTE Default', 'Huawei Default', 'Fiberhome Default',
    'VSOL Default', 'D-Link Default', 'Netis Default', 'Tenda Default'
) AND organization_id IS NULL;

-- Remove role_permissions for CPE permissions
DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN (
    'cpe_devices.view', 'cpe_devices.create', 'cpe_devices.update', 'cpe_devices.delete',
    'cpe_tasks.view', 'cpe_tasks.create', 'cpe_tasks.delete',
    'cpe_parameters.view', 'cpe_parameters.update',
    'cpe_profiles.view', 'cpe_profiles.create', 'cpe_profiles.update', 'cpe_profiles.delete',
    'cpe_mappings.view', 'cpe_mappings.create', 'cpe_mappings.update', 'cpe_mappings.delete',
    'cpe_firmware_versions.view', 'cpe_firmware_versions.create', 'cpe_firmware_versions.update', 'cpe_firmware_versions.delete',
    'cpe_firmware_campaigns.view', 'cpe_firmware_campaigns.create', 'cpe_firmware_campaigns.update', 'cpe_firmware_campaigns.delete', 'cpe_firmware_campaigns.execute'
);

DELETE FROM permissions WHERE name IN (
    'cpe_devices.view', 'cpe_devices.create', 'cpe_devices.update', 'cpe_devices.delete',
    'cpe_tasks.view', 'cpe_tasks.create', 'cpe_tasks.delete',
    'cpe_parameters.view', 'cpe_parameters.update',
    'cpe_profiles.view', 'cpe_profiles.create', 'cpe_profiles.update', 'cpe_profiles.delete',
    'cpe_mappings.view', 'cpe_mappings.create', 'cpe_mappings.update', 'cpe_mappings.delete',
    'cpe_firmware_versions.view', 'cpe_firmware_versions.create', 'cpe_firmware_versions.update', 'cpe_firmware_versions.delete',
    'cpe_firmware_campaigns.view', 'cpe_firmware_campaigns.create', 'cpe_firmware_campaigns.update', 'cpe_firmware_campaigns.delete', 'cpe_firmware_campaigns.execute'
);

-- Drop FK constraint from cpe_devices
DROP PROCEDURE IF EXISTS _rb276_drop_cpe_profile_fk;

DELIMITER //
CREATE PROCEDURE _rb276_drop_cpe_profile_fk()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cpe_devices'
      AND CONSTRAINT_NAME = 'fk_cpe_devices_cpe_profile'
  ) THEN
    ALTER TABLE cpe_devices DROP FOREIGN KEY fk_cpe_devices_cpe_profile;
  END IF;
END
//
DELIMITER ;

CALL _rb276_drop_cpe_profile_fk();
DROP PROCEDURE IF EXISTS _rb276_drop_cpe_profile_fk;
