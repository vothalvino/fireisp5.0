-- =============================================================================
-- FireISP 5.0 — Rollback 169: Remove AI Reply Assistant data layer
-- =============================================================================
-- Reverses migration 169.  Drops, in order:
--   1. The columns the migration added to existing tables (guarded —
--      MySQL 8 has no DROP COLUMN IF EXISTS):
--        organization_quotas.max_ai_tokens_month
--        devices.role
--        network_links.role
--        network_links.medium
--   2. The six tables the migration created, in FK-safe order
--      (ai_policies and ai_reply_logs reference ai_providers, so
--      ai_providers is dropped last).
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_169_drop_ai_columns;
DELIMITER //
CREATE PROCEDURE rollback_169_drop_ai_columns()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'organization_quotas'
      AND COLUMN_NAME  = 'max_ai_tokens_month'
  ) THEN
    ALTER TABLE organization_quotas DROP COLUMN max_ai_tokens_month;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'devices'
      AND COLUMN_NAME  = 'role'
  ) THEN
    ALTER TABLE devices DROP COLUMN role;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'network_links'
      AND COLUMN_NAME  = 'role'
  ) THEN
    ALTER TABLE network_links DROP COLUMN role;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'network_links'
      AND COLUMN_NAME  = 'medium'
  ) THEN
    ALTER TABLE network_links DROP COLUMN medium;
  END IF;
END //
DELIMITER ;
CALL rollback_169_drop_ai_columns();
DROP PROCEDURE IF EXISTS rollback_169_drop_ai_columns;

-- Drop the six AI tables in FK-safe order
DROP TABLE IF EXISTS contract_topology_paths;
DROP TABLE IF EXISTS ai_reply_logs;
DROP TABLE IF EXISTS ai_forbidden_terms;
DROP TABLE IF EXISTS ai_phrase_library;
DROP TABLE IF EXISTS ai_policies;
DROP TABLE IF EXISTS ai_providers;
