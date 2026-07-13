-- =============================================================================
-- Rollback 388 — Configurable diagnostic thresholds
-- =============================================================================
-- Drops the 5 columns added by migration 388 (3 on contracts, 2 on
-- ap_sector_configs). INFORMATION_SCHEMA-guarded so a re-run, or a rollback
-- of a partially applied 388, completes instead of aborting on the first
-- already-reverted column.
-- No data restoration is attempted: dropping these columns just returns
-- every contract/sector to the hardcoded-default behavior
-- (diagnosticEngineService.js's -27 dBm / -75 dBm code constants, and
-- cpe_link_capacity reporting 'unknown' with no configured threshold) that
-- was already in effect before this migration — lossless from the product's
-- point of view.
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_388_add_diagnostic_threshold_overrides;
DELIMITER //
CREATE PROCEDURE rollback_388_add_diagnostic_threshold_overrides()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ap_sector_configs'
      AND COLUMN_NAME  = 'link_capacity_min_mbps'
  ) THEN
    ALTER TABLE ap_sector_configs DROP COLUMN link_capacity_min_mbps;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ap_sector_configs'
      AND COLUMN_NAME  = 'signal_min_dbm'
  ) THEN
    ALTER TABLE ap_sector_configs DROP COLUMN signal_min_dbm;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'contracts'
      AND COLUMN_NAME  = 'wireless_link_capacity_min_mbps'
  ) THEN
    ALTER TABLE contracts DROP COLUMN wireless_link_capacity_min_mbps;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'contracts'
      AND COLUMN_NAME  = 'wireless_signal_min_dbm'
  ) THEN
    ALTER TABLE contracts DROP COLUMN wireless_signal_min_dbm;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'contracts'
      AND COLUMN_NAME  = 'optical_min_dbm'
  ) THEN
    ALTER TABLE contracts DROP COLUMN optical_min_dbm;
  END IF;
END //
DELIMITER ;
CALL rollback_388_add_diagnostic_threshold_overrides();
DROP PROCEDURE IF EXISTS rollback_388_add_diagnostic_threshold_overrides;
