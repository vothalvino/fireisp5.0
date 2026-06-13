-- =============================================================================
-- Rollback 341 — Drop router_driver_configs + device_command_executions
-- =============================================================================
DROP TABLE IF EXISTS device_command_executions;
DROP TABLE IF EXISTS router_driver_configs;
