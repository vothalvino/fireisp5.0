-- =============================================================================
-- Migration 173: Expand clients.client_type ENUM
-- =============================================================================
-- The original table defined client_type as ENUM('personal', 'company').
-- The API validation schema was later updated to allow the values
-- 'residential', 'business', 'government', and 'wholesale', but the underlying
-- column was never altered to match.  This migration aligns the DB with the
-- validation layer by adding the new values while keeping the legacy ones so
-- that existing rows and seed data remain valid.
-- =============================================================================

ALTER TABLE clients
    MODIFY COLUMN client_type ENUM(
        'personal',
        'company',
        'residential',
        'business',
        'government',
        'wholesale'
    ) NOT NULL DEFAULT 'personal';
