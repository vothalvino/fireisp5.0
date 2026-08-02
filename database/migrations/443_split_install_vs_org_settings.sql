-- =============================================================================
-- Migration 443 — split install-level vs per-organization settings (j56)
-- =============================================================================
-- The `settings` table is INSTALL-level: setting_key / setting_value, no
-- organization_id. But it was exposed through per-org routes as if each org
-- had its own copy, so any organization's admin could rewrite values every
-- other tenant then read — proven live with map_tile_attribution, and
-- ops_alert_email is the dangerous one (a tenant can redirect the install's
-- infrastructure alerts to an address they control).
--
-- The split, per the approved classification:
--
--   INSTALL-LEVEL (stay in `settings`; writes become install-operator-only in
--   the route layer): ops_alert_email, map_tile_url, map_tile_attribution.
--   These three are the ONLY keys any code reads from this table.
--
--   PER-ORG (move to the new `organization_settings` table): mab_password_mode
--   and pppoe_auth_failure_threshold. Both readers already guard on an org id
--   (`if (organizationId)`) and were per-org in intent — the comment on the
--   threshold reader literally says "Org threshold setting key" — but hit the
--   global table, so one tenant changing either changed it for everybody.
--
--   DEAD — the 23 keys below were seeded by migration 120 and NOTHING reads
--   them (grep-verified); each concern has a real home elsewhere (SMTP →
--   organization_email_settings, company_* → organizations columns, numbering
--   → per-org sequences, automation → scheduled_tasks, …). A settings row
--   nothing reads is worse than absent: it renders as a working control and
--   silently does nothing. Deleted, precedent migrations 405 (default_currency)
--   and 431 (default_tax_rate).
--
-- Keys an operator upserted by hand that are NOT in the classification are
-- deliberately left in `settings` untouched — the new route layer simply no
-- longer serves or edits them (allowlist), so they are preserved, not lost.
-- =============================================================================

CREATE TABLE IF NOT EXISTS organization_settings (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NOT NULL,
    setting_key     VARCHAR(100)    NOT NULL,
    setting_value   TEXT            NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_org_settings_key (organization_id, setting_key),
    CONSTRAINT fk_org_settings_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Behaviour-preserving copy: if a per-org-intended key had been set in the
-- global table, every org was effectively using that value — so every org
-- starts with it. INSERT IGNORE + the unique key make this idempotent, and a
-- re-run never overwrites a value an org has since customised.
INSERT IGNORE INTO organization_settings (organization_id, setting_key, setting_value)
SELECT o.id, s.setting_key, s.setting_value
FROM organizations o
JOIN settings s ON s.setting_key IN ('mab_password_mode', 'pppoe_auth_failure_threshold');

DELETE FROM settings WHERE setting_key IN ('mab_password_mode', 'pppoe_auth_failure_threshold');

-- The dead migration-120 seeds (23 keys, zero readers).
DELETE FROM settings WHERE setting_key IN (
    'invoice_prefix', 'quote_prefix', 'credit_note_prefix',
    'smtp_host', 'smtp_port', 'smtp_encryption', 'smtp_username', 'smtp_password',
    'snmp_default_poll_interval', 'snmp_default_community',
    'company_name', 'company_email', 'company_phone',
    'timezone', 'date_format', 'pagination_per_page',
    'session_timeout_minutes', 'max_login_attempts', 'password_min_length',
    'auto_suspend_enabled', 'auto_suspend_days_overdue',
    'auto_invoice_enabled', 'auto_invoice_days_before_due'
);
