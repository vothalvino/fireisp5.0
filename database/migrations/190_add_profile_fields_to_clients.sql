-- =============================================================================
-- Migration 190: Subscriber profile enrichment on clients
-- =============================================================================
-- Implements isp-platform-features.md §1.1 "Subscriber Profile Management":
--   • GPS coordinates (latitude / longitude) for the service address map pin
--     + geocoding (populated by the Google Maps geocoding service).
--   • Customer credit score / risk rating.
--   • Adds the 'corporate' value to the client_type classification enum so the
--     documented Residential / Business / Corporate / Government taxonomy is
--     fully representable at the database level.
-- =============================================================================

ALTER TABLE clients
    MODIFY COLUMN client_type ENUM(
        'personal',
        'company',
        'residential',
        'business',
        'corporate',
        'government',
        'wholesale'
    ) NOT NULL DEFAULT 'personal';

-- Column and index additions are guarded with INFORMATION_SCHEMA checks so
-- the migration is safely re-runnable after a partial failure.
DROP PROCEDURE IF EXISTS migration_190_add_client_profile_fields;
DELIMITER //
CREATE PROCEDURE migration_190_add_client_profile_fields()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'latitude'
  ) THEN
    ALTER TABLE clients
        ADD COLUMN latitude DECIMAL(10, 8) NULL
            COMMENT 'Service-address latitude (WGS-84) for the map pin / geocoding'
            AFTER zip_code;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'longitude'
  ) THEN
    ALTER TABLE clients
        ADD COLUMN longitude DECIMAL(11, 8) NULL
            COMMENT 'Service-address longitude (WGS-84) for the map pin / geocoding'
            AFTER latitude;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'geocoded_at'
  ) THEN
    ALTER TABLE clients
        ADD COLUMN geocoded_at TIMESTAMP NULL
            COMMENT 'When latitude/longitude were last resolved by the geocoding provider'
            AFTER longitude;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'credit_score'
  ) THEN
    ALTER TABLE clients
        ADD COLUMN credit_score SMALLINT UNSIGNED NULL
            COMMENT 'Customer credit score (0-1000 scale; NULL = unscored)'
            AFTER geocoded_at;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'risk_rating'
  ) THEN
    ALTER TABLE clients
        ADD COLUMN risk_rating ENUM('low', 'medium', 'high', 'unrated') NOT NULL DEFAULT 'unrated'
            COMMENT 'Customer risk rating derived from credit/payment history'
            AFTER credit_score;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND INDEX_NAME   = 'idx_clients_risk_rating'
  ) THEN
    ALTER TABLE clients
        ADD KEY idx_clients_risk_rating (risk_rating);
  END IF;
END //
DELIMITER ;
CALL migration_190_add_client_profile_fields();
DROP PROCEDURE IF EXISTS migration_190_add_client_profile_fields;
