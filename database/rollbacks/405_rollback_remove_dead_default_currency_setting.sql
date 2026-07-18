-- =============================================================================
-- Rollback 405: restore the `default_currency` global setting seed
-- =============================================================================
-- Re-inserts the row migration 405 removed. INSERT IGNORE so it is a no-op if
-- the key still exists. Note: this restores the seed default (USD), not any
-- administrator-customised value that existed before migration 405 ran.

INSERT IGNORE INTO settings (setting_key, setting_value, description) VALUES
    ('default_currency', 'USD', 'ISO 4217 currency code used as system default for new documents');
