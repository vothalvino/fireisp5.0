-- =============================================================================
-- Rollback 277: Remove CPE Diagnostics and Session Logs (§8.3)
-- =============================================================================

-- Remove cleanup scheduled task
DELETE FROM scheduled_tasks
WHERE task_name = 'cpe_session_log_cleanup'
  AND organization_id IS NULL;

-- Remove role_permissions for §8.3 permissions
DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN (
    'cpe_diagnostics.view', 'cpe_diagnostics.create', 'cpe_diagnostics.delete',
    'cpe_session_logs.view', 'cpe_session_logs.delete'
);

DELETE FROM permissions WHERE name IN (
    'cpe_diagnostics.view', 'cpe_diagnostics.create', 'cpe_diagnostics.delete',
    'cpe_session_logs.view', 'cpe_session_logs.delete'
);

-- Drop new tables
DROP TABLE IF EXISTS cpe_diagnostics;
DROP TABLE IF EXISTS cpe_session_logs;

-- Revert cpe_tasks.task_type ENUM to pre-277 definition (guarded)
DROP PROCEDURE IF EXISTS _rb277_revert_task_type_enum;

DELIMITER //
CREATE PROCEDURE _rb277_revert_task_type_enum()
BEGIN
  DECLARE col_type TEXT;
  SELECT COLUMN_TYPE INTO col_type
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'cpe_tasks'
    AND COLUMN_NAME = 'task_type';

  IF col_type LIKE '%ping_diagnostic%' THEN
    ALTER TABLE cpe_tasks
      MODIFY COLUMN task_type ENUM(
        'get_parameter_values',
        'set_parameter_values',
        'get_parameter_names',
        'download',
        'reboot',
        'factory_reset',
        'add_object',
        'delete_object'
      ) NOT NULL;
  END IF;
END
//
DELIMITER ;

CALL _rb277_revert_task_type_enum();
DROP PROCEDURE IF EXISTS _rb277_revert_task_type_enum;
