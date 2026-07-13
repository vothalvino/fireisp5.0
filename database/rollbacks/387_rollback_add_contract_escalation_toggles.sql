-- =============================================================================
-- Rollback 387 — Per-contract AI-diagnostic auto-escalation toggles
-- =============================================================================
-- Drops the two columns added by migration 387. INFORMATION_SCHEMA-guarded so
-- a re-run, or a rollback of a partially applied 387, completes instead of
-- aborting on the first already-reverted column.
-- No data restoration is attempted: dropping these columns just returns every
-- contract to the org-wide hardcoded default behavior (quality-only escalation,
-- always enabled) that diagnosticEngineService.js falls back to when no
-- contract resolves — lossless from the product's point of view.
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_387_add_contract_escalation_toggles;
DELIMITER //
CREATE PROCEDURE rollback_387_add_contract_escalation_toggles()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'contracts'
      AND COLUMN_NAME  = 'escalate_on_disconnect'
  ) THEN
    ALTER TABLE contracts DROP COLUMN escalate_on_disconnect;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'contracts'
      AND COLUMN_NAME  = 'escalation_enabled'
  ) THEN
    ALTER TABLE contracts DROP COLUMN escalation_enabled;
  END IF;
END //
DELIMITER ;
CALL rollback_387_add_contract_escalation_toggles();
DROP PROCEDURE IF EXISTS rollback_387_add_contract_escalation_toggles;
