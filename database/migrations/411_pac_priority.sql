-- =============================================================================
-- Migration 411 — pac_providers.priority: PAC failover order
-- =============================================================================
-- When an org configures more than one active PAC, stamping tries them in
-- ascending priority (lower = tried first). Failover is CONSERVATIVE — the
-- next provider is tried only when the primary is provably UNREACHABLE
-- (connection refused / DNS failure / its circuit breaker is open), never on
-- a timeout or a PAC response, so a document is never double-stamped.
--
-- Default 100 keeps every existing single-PAC org unchanged.
-- Guarded via INFORMATION_SCHEMA (idempotent), mirrors migrations 409/410.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_411_pac_priority;
DELIMITER //
CREATE PROCEDURE migration_411_pac_priority()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'pac_providers'
      AND COLUMN_NAME = 'priority'
  ) THEN
    ALTER TABLE pac_providers
      ADD COLUMN priority INT NOT NULL DEFAULT 100
        COMMENT 'Failover order — lower is tried first (migration 411)'
        AFTER is_default;
  END IF;
END //
DELIMITER ;
CALL migration_411_pac_priority();
DROP PROCEDURE IF EXISTS migration_411_pac_priority;
