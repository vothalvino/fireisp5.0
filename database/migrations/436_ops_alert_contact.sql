-- =============================================================================
-- 436 — a dedicated contact for INFRASTRUCTURE alerts
-- =============================================================================
-- Infrastructure alerts (TLS expiry today; anything host-level in future) fanned
-- out to the admins and managers of EVERY active organization, because the
-- certificate serves the whole install. In a multi-tenant deployment that means
-- every tenant admin receives host-level instructions — "run `docker compose
-- logs certbot`" — for a machine they have no shell on. It is noise they cannot
-- act on, and a small disclosure: it tells a tenant how the platform is hosted.
--
-- The person who fixes host infrastructure is a property of the INSTALL, not
-- something derivable from any organization's membership. That is why this is a
-- setting rather than a role rule:
--
--   * org 1 is not reliably the operator — true on a single-tenant install,
--     false wherever org 1 is simply the first customer;
--   * legacy `users.role = 'admin'` would work, but the codebase is
--     deliberately moving AWAY from that column as an authority (see the bypass
--     called out in CLAUDE.md), and building new behaviour on it entrenches it.
--
-- `settings` is install-level (no organization_id), which is exactly the scope
-- this needs.
--
-- BLANK BY DEFAULT, and blank means "fall back to the old fan-out". An upgrade
-- must not silently stop delivering alerts to the only people currently
-- receiving them — an operator who never reads this migration keeps getting
-- exactly what they got before, and opts in by filling the field.
-- =============================================================================

INSERT INTO settings (setting_key, setting_value, description) VALUES
    ('ops_alert_email',
     '',
     'Where INFRASTRUCTURE alerts go (TLS expiry, host-level failures). One address, or several separated by commas. Blank = fall back to notifying every organization admin/manager, which is noisy on a multi-tenant install.')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

-- ── De-duplication for alerts sent to the ops contact ────────────────────────
-- The per-organization path dedupes on a notifications row per recipient per
-- title. An ops contact has no user row to hang that on — and inventing one
-- would drop a tenant-visible notification into somebody's bell list.
--
-- Deliberately generic rather than TLS-specific: j31's whole point was to
-- decide this ONCE, so the next infrastructure alert has an obvious home
-- instead of inventing its own recipient and dedupe rules.
--
-- alert_key IS the dedupe key (the alert title), so it must carry whatever
-- makes this alert distinct from the last one — a certificate's expiry date,
-- a failure reason. UNIQUE + INSERT IGNORE makes the check atomic: no
-- read-then-write race between two runs.
CREATE TABLE IF NOT EXISTS ops_alert_deliveries (
    id         BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    alert_key  VARCHAR(255)     NOT NULL COMMENT 'Alert title — carries what makes it distinct',
    channel    VARCHAR(32)      NOT NULL DEFAULT 'email',
    sent_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_ops_alert_key (alert_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
