-- =============================================================================
-- Migration 387 — Per-contract AI-diagnostic auto-escalation toggles
-- =============================================================================
-- diagnosticEngineService.js's auto-escalation rule (fix/escalate-quality-only,
-- same PR) fires ONLY on measured RF/optical signal-quality faults
-- (onu_signal 'error' / cpe_signal 'warning'|'error') and never on
-- offline/disconnect states — most service areas here have frequent grid
-- power outages and customers rarely run a UPS, so an offline ONU/CPE or a
-- dropped session is normal, not a fault worth a truck roll.
--
-- That base rule is a good ORG-WIDE default but not universal: some clients
-- explicitly do not want any automatic ticket/dispatch (e.g. they manage
-- their own on-site technician), and some clients DO have a UPS, so for them
-- an offline/disconnect state genuinely IS abnormal and worth escalating on.
-- Both are now per-contract toggles rather than a single hardcoded rule:
--
--   escalation_enabled      — master switch, default ON (1). When 0, this
--                              contract NEVER auto-escalates, regardless of
--                              which check faulted.
--   escalate_on_disconnect  — default OFF (0). When 1 (client has a UPS),
--                              ALSO escalate on offline/disconnect checks
--                              (onu_status, cpe_status, pppoe_session,
--                              radius_session) on top of the always-on
--                              signal-quality rule. account_suspension is
--                              deliberately never included — a billing hold
--                              is not a disconnect fault.
--
-- Placed after `status` (both are contract-level operational flags, read
-- alongside status by the diagnostic engine's contract lookup) and before
-- `version`.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8),
-- following the 386/385/382/380/374 stored-procedure pattern.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_387_add_contract_escalation_toggles;
DELIMITER //
CREATE PROCEDURE migration_387_add_contract_escalation_toggles()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'contracts'
      AND COLUMN_NAME  = 'escalation_enabled'
  ) THEN
    ALTER TABLE contracts
      ADD COLUMN escalation_enabled TINYINT(1) NOT NULL DEFAULT 1
          COMMENT 'Master switch for AI-diagnostic auto-escalation (creates a real technician ticket) on this contract; 0 = never auto-escalate regardless of fault (migration 387)'
          AFTER status;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'contracts'
      AND COLUMN_NAME  = 'escalate_on_disconnect'
  ) THEN
    ALTER TABLE contracts
      ADD COLUMN escalate_on_disconnect TINYINT(1) NOT NULL DEFAULT 0
          COMMENT 'When 1, ALSO auto-escalate on offline/disconnect faults (onu_status/cpe_status offline, dropped pppoe/radius session) on top of the always-on signal-quality rule; for clients with a UPS where offline is abnormal (migration 387)'
          AFTER escalation_enabled;
  END IF;
END //
DELIMITER ;
CALL migration_387_add_contract_escalation_toggles();
DROP PROCEDURE IF EXISTS migration_387_add_contract_escalation_toggles;
