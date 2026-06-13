-- Migration 325 — password_policies table
-- Purpose: Per-organization password policy configuration (complexity, rotation, history).
-- Tables: password_policies

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS password_policies (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id         BIGINT UNSIGNED NOT NULL,
    min_length              TINYINT UNSIGNED NOT NULL DEFAULT 12,
    require_uppercase       TINYINT(1)      NOT NULL DEFAULT 1,
    require_lowercase       TINYINT(1)      NOT NULL DEFAULT 1,
    require_digits          TINYINT(1)      NOT NULL DEFAULT 1,
    require_special_chars   TINYINT(1)      NOT NULL DEFAULT 1,
    max_repeated_chars      TINYINT UNSIGNED NULL DEFAULT 3 COMMENT 'Max consecutive identical chars; NULL = no limit',
    rotation_days           SMALLINT UNSIGNED NULL DEFAULT 90 COMMENT 'Force password change after N days; NULL = never',
    history_count           TINYINT UNSIGNED NOT NULL DEFAULT 5 COMMENT 'Number of previous passwords to remember',
    lockout_attempts        TINYINT UNSIGNED NOT NULL DEFAULT 5 COMMENT 'Failed attempts before lockout',
    lockout_duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 15,
    is_active               TINYINT(1)      NOT NULL DEFAULT 1,
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_password_policies_org (organization_id),
    CONSTRAINT fk_password_policies_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-organization password policy configuration (§17)';
