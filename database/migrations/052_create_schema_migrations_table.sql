-- Migration: 052_create_schema_migrations_table
-- Description: Migration state tracking. Records which migration files have
--              been applied so that the deploy script can skip already-run files
--              and safely re-run the migration loop without re-applying changes.

CREATE TABLE IF NOT EXISTS schema_migrations (
    id         BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    filename   VARCHAR(255)     NOT NULL COMMENT 'Migration filename, e.g. 001_create_users_table.sql',
    applied_at TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_schema_migrations_filename (filename)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
