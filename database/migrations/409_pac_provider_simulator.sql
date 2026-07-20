-- =============================================================================
-- Migration 409 — Add 'simulator' to pac_providers.provider_name
-- =============================================================================
-- The simulator PAC (cfdiService callPac*) is a first-class demo/dev provider:
-- allowed in any NODE_ENV but only with environment='sandbox', mints
-- unmistakably fake 'SIM-…' UUIDs, and auto-accepts cancellations — so a demo
-- install can walk the whole stamp → vigente → SAT-cancel flow without a PAC
-- contract. Without this ENUM member the branch was unreachable: no
-- pac_providers row could ever carry provider_name='simulator'.
--
-- Guarded via INFORMATION_SCHEMA COLUMN_TYPE (idempotent).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_409_pac_simulator;
DELIMITER //
CREATE PROCEDURE migration_409_pac_simulator()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'pac_providers'
      AND COLUMN_NAME  = 'provider_name'
      AND COLUMN_TYPE LIKE '%simulator%'
  ) THEN
    ALTER TABLE pac_providers
      MODIFY COLUMN provider_name ENUM('finkok','sw_sapien','digicel','comercio_digital','facturapi','other','simulator')
        NOT NULL COMMENT 'PAC vendor identifier; simulator = demo/dev stamping (sandbox only, SIM- UUIDs)';
  END IF;
END //
DELIMITER ;
CALL migration_409_pac_simulator();
DROP PROCEDURE IF EXISTS migration_409_pac_simulator;
