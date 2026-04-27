-- =============================================================================
-- Migration 167 — Per-tenant database isolation configuration
-- =============================================================================
-- Control-plane table that lets high-value tenants opt into a physically
-- isolated MySQL/MariaDB database while the default remains the shared schema.
-- Database passwords are stored encrypted by the application layer.
-- =============================================================================

CREATE TABLE IF NOT EXISTS organization_database_configs (
    id                    BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id       BIGINT UNSIGNED  NOT NULL,
    isolation_mode        ENUM('shared', 'isolated') NOT NULL DEFAULT 'shared',
    db_host               VARCHAR(255)     NULL,
    db_port               INT UNSIGNED     NOT NULL DEFAULT 3306,
    db_name               VARCHAR(100)     NULL,
    db_user               VARCHAR(255)     NULL,
    db_password_encrypted TEXT             NULL,
    ssl_enabled           TINYINT(1)       NOT NULL DEFAULT 0,
    last_verified_at      TIMESTAMP        NULL,
    created_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_organization_database_configs_org (organization_id),
    KEY idx_organization_database_configs_mode (isolation_mode),
    CONSTRAINT fk_organization_database_configs_org
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE CASCADE
);
