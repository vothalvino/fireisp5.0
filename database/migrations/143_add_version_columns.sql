-- =============================================================================
-- Migration 143: Add version columns for optimistic locking
-- =============================================================================
-- Adds a `version` column to critical tables to enable optimistic concurrency
-- control. Updates must include `WHERE version = ?` and increment the version.
-- =============================================================================

ALTER TABLE invoices ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE contracts ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE payments ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE clients ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1;
