-- =============================================================================
-- FireISP 5.0 — Rollback 190: Remove subscriber profile enrichment from clients
-- =============================================================================
-- Reverses migration 190. Drops the GPS/credit/risk columns and reverts the
-- client_type enum to its prior value set (without 'corporate'). Any rows still
-- using client_type = 'corporate' must be re-mapped before rolling back.
-- =============================================================================

ALTER TABLE clients
    DROP KEY idx_clients_risk_rating;

ALTER TABLE clients
    DROP COLUMN risk_rating,
    DROP COLUMN credit_score,
    DROP COLUMN geocoded_at,
    DROP COLUMN longitude,
    DROP COLUMN latitude;

ALTER TABLE clients
    MODIFY COLUMN client_type ENUM(
        'personal',
        'company',
        'residential',
        'business',
        'government',
        'wholesale'
    ) NOT NULL DEFAULT 'personal';
