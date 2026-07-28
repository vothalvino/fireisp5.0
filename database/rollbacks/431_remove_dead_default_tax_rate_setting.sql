-- =============================================================================
-- Rollback 431: restore the `default_tax_rate` global setting seed
-- =============================================================================
-- Re-inserts the row migration 431 removed. INSERT IGNORE so it is a no-op if
-- the key still exists. Note: this restores the seed default (0.00), not any
-- administrator-customised value that existed before migration 431 ran — and
-- since nothing ever READ the setting, no behaviour depended on that value
-- either way.

INSERT IGNORE INTO settings (setting_key, setting_value, description) VALUES
    ('default_tax_rate', '0.00', 'Default tax rate percentage applied to new invoices when no tax_rate_id is selected');
