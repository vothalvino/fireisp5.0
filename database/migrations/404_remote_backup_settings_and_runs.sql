-- =============================================================================
-- Migration 404 — Remote database-backup settings (UI-configured) + run history
-- =============================================================================
-- Until now the nightly `database_backup` task could only reach off-site
-- storage through BACKUP_S3_* environment variables — invisible and
-- unconfigurable from the product. This migration adds:
--
--   * `backup_settings` — a SINGLETON row (id = 1, database backups are
--     instance-wide, like the org-NULL `database_backup` scheduled task) an
--     admin edits from the new /backups page. Targets anything speaking the
--     S3 API: AWS S3, Google Cloud Storage (interoperability HMAC), Backblaze
--     B2, Cloudflare R2, or a self-hosted MinIO
--     server (`provider` is a UI preset only). The secret key is AES-256-GCM
--     encrypted via src/utils/encryption.js and NEVER returned by the API
--     (GET exposes `secret_configured: boolean` — the migration-386 mold).
--     When no row is enabled, the BACKUP_S3_* env vars remain the fallback.
--
--   * `backup_runs` — one row per backup execution (scheduled / manual /
--     DR-drill) recording outcome, size, and whether the remote upload
--     happened. The 2026-07 backup-integrity campaign (PRs #455-#458) showed
--     that silent backup failure is the worst kind; this makes every run —
--     and every remote-upload failure — visible in the UI.
--
-- New permission slugs `backup_settings.view` / `backup_settings.update` are
-- granted to admin + super_admin ONLY — a database-backup credential is
-- instance-wide infrastructure with no business-role owner, mirroring
-- migration 386's carve-out for email_settings (excluded from readonly/
-- auditor's blanket *.view wildcard).
-- =============================================================================

CREATE TABLE IF NOT EXISTS backup_settings (
    id                   TINYINT UNSIGNED NOT NULL COMMENT 'Singleton — always 1; database backups are instance-wide',
    remote_enabled       TINYINT(1)       NOT NULL DEFAULT 0 COMMENT 'When 0, BACKUP_S3_* env vars (if set) remain the remote target',
    provider             ENUM('aws', 'gcs', 'b2', 'r2', 'minio', 'custom')
                                          NOT NULL DEFAULT 'custom'
                                          COMMENT 'UI preset only — every provider speaks the S3 API',
    bucket               VARCHAR(255)     NULL,
    region               VARCHAR(64)      NULL,
    endpoint             VARCHAR(512)     NULL COMMENT 'Custom S3 endpoint (B2/R2/MinIO/self-hosted); NULL = AWS endpoint derived from region',
    prefix               VARCHAR(255)     NOT NULL DEFAULT 'db-backups/' COMMENT 'Object-key prefix ("folder") inside the bucket',
    access_key           VARCHAR(255)     NULL,
    secret_key_encrypted TEXT             NULL COMMENT 'AES-256-GCM via src/utils/encryption.js — never returned in any HTTP response',
    last_test_at         TIMESTAMP        NULL,
    last_test_status     ENUM('success', 'failed') NULL,
    last_test_error      TEXT             NULL,
    created_at           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT chk_backup_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Instance-wide remote backup destination (migration 404) — secret encrypted at rest, never returned in API responses';

CREATE TABLE IF NOT EXISTS backup_runs (
    id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    trigger_source ENUM('scheduled', 'manual', 'drill')
                                   NOT NULL DEFAULT 'scheduled'
                                   COMMENT 'scheduled = nightly task; manual = /backups Run-now; drill = quarterly DR drill Phase 1',
    status         ENUM('running', 'success', 'failed') NOT NULL DEFAULT 'running',
    filename       VARCHAR(255)    NULL,
    size_bytes     BIGINT UNSIGNED NULL,
    remote_status  ENUM('disabled', 'uploaded', 'failed')
                                   NULL
                                   COMMENT 'NULL while running or when the dump itself failed; disabled = no remote target configured',
    remote_url     VARCHAR(1024)   NULL,
    error_message  TEXT            NULL,
    started_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at    TIMESTAMP       NULL,

    PRIMARY KEY (id),
    KEY idx_backup_runs_started_at (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='One row per database-backup execution (migration 404) — makes silent backup/upload failure visible in the UI';

-- -----------------------------------------------------------------------------
-- Permissions — admin + super_admin only (migration 386 convention: an
-- infrastructure credential, not a business-role resource).
-- -----------------------------------------------------------------------------

INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('backup_settings.view',   'View database backup runs and remote backup destination (secret masked)', 'settings'),
    ('backup_settings.update', 'Configure the remote backup destination (incl. credentials), test it, and trigger manual backups', 'settings');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.name IN ('backup_settings.view', 'backup_settings.update')
WHERE r.name IN ('admin', 'super_admin');
