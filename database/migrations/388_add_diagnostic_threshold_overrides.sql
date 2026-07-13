-- =============================================================================
-- Migration 388 — Configurable diagnostic thresholds (fiber optical, wireless
-- signal, wireless link-capacity) via per-sector defaults + per-contract
-- overrides
-- =============================================================================
-- diagnosticEngineService.js compares telemetry against three hardcoded
-- global constants today: fiber ONU RX power (-27 dBm, onu_signal /
-- onu_signal_stability), wireless CPE signal (-75 dBm, cpe_signal), and no
-- wireless link-capacity check at all (there was nothing to compare — see
-- below). Some sites/sectors and some individual clients legitimately run
-- outside those defaults (longer fiber runs, noisier RF environments, a
-- known-marginal-but-kept client) — this migration adds the columns needed
-- to make all three configurable via a three-tier resolution the engine
-- applies in plain JS `??` chains (most specific wins):
--
--   fiber optical min (dBm):        contract.optical_min_dbm ?? -27 (code constant)
--   wireless signal min (dBm):      contract.wireless_signal_min_dbm
--                                     ?? sector.signal_min_dbm ?? -75 (code constant)
--   wireless link-capacity min (Mbps): contract.wireless_link_capacity_min_mbps
--                                     ?? sector.link_capacity_min_mbps ?? NULL
--                                        (no global default — unset means the
--                                        new cpe_link_capacity check honestly
--                                        reports 'unknown', never a fabricated
--                                        ok/warning)
--
-- Link-capacity is the negotiated RF link rate in Mbps (Ubiquiti "link
-- capacity"), read from wireless_client_sessions.tx_rate_mbps/rx_rate_mbps —
-- NOT a client-count/AP-load percentage (that's the separate, still-stubbed
-- `ap_load` check, left untouched by this migration).
--
-- All 5 columns are nullable with no DEFAULT other than NULL, so applying
-- this migration changes zero runtime behavior until an admin/support agent
-- explicitly sets a value — every existing contract/sector falls through to
-- the same hardcoded constants (or 'unknown' for capacity) as today.
--
-- contracts: placed AFTER escalate_on_disconnect (migration 387 — the other
-- per-contract diagnostic-engine override), BEFORE `version`.
-- ap_sector_configs: placed AFTER max_clients, BEFORE `notes`.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8),
-- following the 387/386/385/382/380/374 stored-procedure pattern.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_388_add_diagnostic_threshold_overrides;
DELIMITER //
CREATE PROCEDURE migration_388_add_diagnostic_threshold_overrides()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'contracts'
      AND COLUMN_NAME  = 'optical_min_dbm'
  ) THEN
    ALTER TABLE contracts
      ADD COLUMN optical_min_dbm SMALLINT NULL
          COMMENT 'Per-contract override of the fiber ONU RX power threshold (dBm) above which onu_signal/onu_signal_stability are healthy; NULL = use the org-wide -27 dBm default (diagnosticEngineService.js) (migration 388)'
          AFTER escalate_on_disconnect;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'contracts'
      AND COLUMN_NAME  = 'wireless_signal_min_dbm'
  ) THEN
    ALTER TABLE contracts
      ADD COLUMN wireless_signal_min_dbm SMALLINT NULL
          COMMENT 'Per-contract override of the wireless CPE signal threshold (dBm) above which cpe_signal is healthy; NULL = use the serving sector default (ap_sector_configs.signal_min_dbm), else the org-wide -75 dBm default (migration 388)'
          AFTER optical_min_dbm;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'contracts'
      AND COLUMN_NAME  = 'wireless_link_capacity_min_mbps'
  ) THEN
    ALTER TABLE contracts
      ADD COLUMN wireless_link_capacity_min_mbps DECIMAL(8,2) NULL
          COMMENT 'Per-contract override of the minimum acceptable negotiated RF link rate (Mbps, from wireless_client_sessions.tx_rate_mbps/rx_rate_mbps) for the new cpe_link_capacity check; NULL = use the serving sector default (ap_sector_configs.link_capacity_min_mbps); no org-wide default exists — if neither resolves, cpe_link_capacity reports status unknown rather than fabricating ok/warning (migration 388)'
          AFTER wireless_signal_min_dbm;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ap_sector_configs'
      AND COLUMN_NAME  = 'signal_min_dbm'
  ) THEN
    ALTER TABLE ap_sector_configs
      ADD COLUMN signal_min_dbm SMALLINT NULL
          COMMENT 'Default minimum healthy CPE signal (dBm) for clients served by this sector; NULL = use the org-wide -75 dBm default. Overridden per-client by contracts.wireless_signal_min_dbm (migration 388)'
          AFTER max_clients;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ap_sector_configs'
      AND COLUMN_NAME  = 'link_capacity_min_mbps'
  ) THEN
    ALTER TABLE ap_sector_configs
      ADD COLUMN link_capacity_min_mbps DECIMAL(8,2) NULL
          COMMENT 'Default minimum acceptable negotiated RF link rate (Mbps) for clients served by this sector, used by the cpe_link_capacity check; NULL = no default (capacity check reports unknown unless the client contract sets an override). Overridden per-client by contracts.wireless_link_capacity_min_mbps (migration 388)'
          AFTER signal_min_dbm;
  END IF;
END //
DELIMITER ;
CALL migration_388_add_diagnostic_threshold_overrides();
DROP PROCEDURE IF EXISTS migration_388_add_diagnostic_threshold_overrides;
