-- =============================================================================
-- Migration 165 — Per-organization SSO configuration tables (P2.1)
-- =============================================================================
-- Adds three tables to support SAML 2.0 and OIDC single-sign-on per tenant:
--
--   organization_sso_configs       — one row per (org, provider_type)
--   organization_sso_group_mappings — maps IdP group names to FireISP roles
--   sso_auth_states                — short-lived OIDC state/nonce store
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: organization_sso_configs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_sso_configs (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id       BIGINT UNSIGNED NOT NULL                     COMMENT 'Owning tenant organization',
    provider_type         ENUM('saml', 'oidc') NOT NULL                COMMENT 'SSO protocol: saml = SAML 2.0, oidc = OpenID Connect',
    is_enabled            TINYINT(1) NOT NULL DEFAULT 0                COMMENT '1 = SSO is active for this org/provider combo',

    -- SAML 2.0 IdP settings
    saml_entity_id        VARCHAR(500) NULL                            COMMENT 'IdP Entity ID / Issuer',
    saml_sso_url          VARCHAR(500) NULL                            COMMENT 'IdP single sign-on (redirect-binding) URL',
    saml_slo_url          VARCHAR(500) NULL                            COMMENT 'IdP single logout URL (optional)',
    saml_x509_cert        TEXT         NULL                            COMMENT 'IdP signing certificate (PEM, without headers)',
    saml_sign_requests    TINYINT(1) NOT NULL DEFAULT 0                COMMENT '1 = sign outbound SAML AuthnRequests using SP private key',
    saml_sp_private_key   TEXT         NULL                            COMMENT 'SP private key for request signing (AES-256-GCM encrypted)',

    -- OIDC settings
    oidc_issuer           VARCHAR(500) NULL                            COMMENT 'OIDC Issuer URL (used for discovery)',
    oidc_client_id        VARCHAR(255) NULL                            COMMENT 'Client ID issued by IdP',
    oidc_client_secret    TEXT         NULL                            COMMENT 'Client secret (AES-256-GCM encrypted)',
    oidc_scopes           VARCHAR(500) NULL DEFAULT 'openid profile email' COMMENT 'Space-separated OIDC scopes to request',

    -- Common settings
    attribute_mapping     JSON         NULL                            COMMENT 'Maps IdP attributes to FireISP user fields, e.g. {"email":"http://schemas.../emailaddress","firstName":"givenname"}',
    idp_group_attribute   VARCHAR(255) NULL DEFAULT 'groups'           COMMENT 'IdP attribute name that carries group memberships',
    auto_provision        TINYINT(1) NOT NULL DEFAULT 1                COMMENT '1 = auto-create FireISP users on first SSO login',
    default_role          ENUM('admin','manager','technician','billing','readonly') NOT NULL DEFAULT 'readonly' COMMENT 'Role assigned to auto-provisioned users without a group mapping',

    created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_org_sso_config_org_type (organization_id, provider_type),
    KEY idx_sso_config_org_id (organization_id),
    CONSTRAINT fk_sso_config_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-organization SSO configuration for SAML 2.0 and OIDC';

-- ---------------------------------------------------------------------------
-- Table: organization_sso_group_mappings
-- Maps IdP group names to FireISP roles for automatic role assignment.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_sso_group_mappings (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    sso_config_id         BIGINT UNSIGNED NOT NULL                     COMMENT 'Parent SSO config record',
    idp_group             VARCHAR(255) NOT NULL                        COMMENT 'Exact group name as reported by the IdP',
    fireisp_role          ENUM('admin','manager','technician','billing','readonly') NOT NULL COMMENT 'FireISP role to assign when the user belongs to this group',
    created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_group_mapping_config_group (sso_config_id, idp_group),
    KEY idx_group_mapping_config_id (sso_config_id),
    CONSTRAINT fk_group_mapping_config FOREIGN KEY (sso_config_id)
        REFERENCES organization_sso_configs (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Maps IdP group names to FireISP roles for SSO-authenticated users';

-- ---------------------------------------------------------------------------
-- Table: sso_auth_states
-- Stores short-lived OIDC state/nonce pairs for the authorization code flow.
-- Rows expire after 10 minutes and should be purged by a cleanup task.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sso_auth_states (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    state                 VARCHAR(64) NOT NULL                         COMMENT 'Random OAuth 2.0 state parameter',
    nonce                 VARCHAR(64) NOT NULL                         COMMENT 'OIDC nonce for replay protection',
    organization_id       BIGINT UNSIGNED NOT NULL                     COMMENT 'Org this auth attempt belongs to',
    redirect_to           VARCHAR(2000) NULL                           COMMENT 'Optional post-auth redirect URL (for deep links)',
    expires_at            DATETIME NOT NULL                            COMMENT 'Expiry time — reject callbacks after this',
    created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_sso_state (state),
    KEY idx_sso_state_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Short-lived OIDC auth state/nonce store for authorization code flow';
