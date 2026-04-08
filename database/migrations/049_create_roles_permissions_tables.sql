-- Migration: 049_create_roles_permissions_tables
-- Description: RBAC roles and permissions — three tables in one migration.
--              Replaces the rigid role ENUM on the users table with a flexible
--              roles + permissions + role_permissions structure that supports
--              custom roles per deployment.
--
--              Note: A role_id column on users is intentionally NOT added here.
--              That ALTER will be a separate migration when the app layer is ready.

CREATE TABLE IF NOT EXISTS roles (
    id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    name        VARCHAR(50)      NOT NULL,
    description VARCHAR(255)     NULL,
    is_system   BOOLEAN          NOT NULL DEFAULT FALSE COMMENT 'System roles cannot be deleted',
    created_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_roles_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
    id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    name        VARCHAR(100)     NOT NULL COMMENT 'Permission slug, e.g. clients.view, invoices.create',
    description VARCHAR(255)     NULL,
    module      VARCHAR(50)      NULL     COMMENT 'Functional module, e.g. clients, billing, network',
    created_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_permissions_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
    id            BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    role_id       BIGINT UNSIGNED  NOT NULL,
    permission_id BIGINT UNSIGNED  NOT NULL,
    created_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_role_permissions (role_id, permission_id),
    KEY idx_role_permissions_permission_id (permission_id),
    CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id)
        REFERENCES roles (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id)
        REFERENCES permissions (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
