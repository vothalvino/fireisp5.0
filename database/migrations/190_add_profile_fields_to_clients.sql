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

ALTER TABLE clients
    ADD COLUMN latitude DECIMAL(10, 8) NULL
        COMMENT 'Service-address latitude (WGS-84) for the map pin / geocoding'
        AFTER zip_code,
    ADD COLUMN longitude DECIMAL(11, 8) NULL
        COMMENT 'Service-address longitude (WGS-84) for the map pin / geocoding'
        AFTER latitude,
    ADD COLUMN geocoded_at TIMESTAMP NULL
        COMMENT 'When latitude/longitude were last resolved by the geocoding provider'
        AFTER longitude,
    ADD COLUMN credit_score SMALLINT UNSIGNED NULL
        COMMENT 'Customer credit score (0-1000 scale; NULL = unscored)'
        AFTER geocoded_at,
    ADD COLUMN risk_rating ENUM('low', 'medium', 'high', 'unrated') NOT NULL DEFAULT 'unrated'
        COMMENT 'Customer risk rating derived from credit/payment history'
        AFTER credit_score;

ALTER TABLE clients
    ADD KEY idx_clients_risk_rating (risk_rating);
