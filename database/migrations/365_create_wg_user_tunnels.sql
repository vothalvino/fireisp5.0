-- =============================================================================
-- Migration 365 — WireGuard user access tunnels: wg_user_peers + user_network_assignments
--                 + wireguard.* permission seed (Part 2)
-- =============================================================================
-- Two tables in one migration (single logical unit):
--   wg_user_peers             — one row per user device (laptop, phone). Server-generated
--                               keypair, encrypted at rest. User peers connect to wg-clients
--                               (port WG_CLIENT_LISTEN_PORT 51821).
--   user_network_assignments  — admin-granted scope: which sites/NASes a tech/support user
--                               can reach through the VPN. Durable (not work-order-derived)
--                               to prevent privilege escalation via self-assigned tickets.
-- Plus 5 wireguard.* permission rows and role grants.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: wg_user_peers
-- Purpose: One row per enrolled user VPN device; server holds the encrypted
--          private key for profile re-download (self-service from user profile).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wg_user_peers (
    id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id          BIGINT UNSIGNED NULL
                                 COMMENT 'Tenant org; NULL = single-tenant deployment',
    user_id                  BIGINT UNSIGNED NOT NULL
                                 COMMENT 'Owning user (FK -> users.id)',
    name                     VARCHAR(100) NOT NULL
                                 COMMENT 'Human label for the device, e.g. "Laptop" or "Phone"',
    public_key               VARCHAR(64) NOT NULL
                                 COMMENT 'Client WireGuard public key (base64 x25519)',
    private_key_encrypted    TEXT NULL
                                 COMMENT 'Client WireGuard private key, AES-256-GCM via src/utils/encryption.js; returned only to owner on create + /config download',
    preshared_key_encrypted  TEXT NULL
                                 COMMENT 'Optional WireGuard PSK, AES-256-GCM; passed via temp keyfile never argv',
    tunnel_address           VARCHAR(45) NOT NULL
                                 COMMENT 'Allocated /32 host IP within WG_CLIENT_SUBNET (e.g. 10.99.0.5)',
    allowed_ips_snapshot     JSON NULL
                                 COMMENT 'Last computed scoped CIDR list — audit trail and list display; authoritative ACL is nftables FORWARD chain',
    endpoint_host            VARCHAR(255) NULL
                                 COMMENT 'Snapshot of WG_ENDPOINT_HOST at time of issue',
    server_peer_synced       TINYINT(1) NOT NULL DEFAULT 0
                                 COMMENT '1 when wg set wg-clients peer has been called for this user device',
    last_handshake_at        DATETIME NULL
                                 COMMENT 'Last WireGuard handshake timestamp (live-read for MVP; poller persists in FOLLOW-UP)',
    rx_bytes                 BIGINT UNSIGNED NULL
                                 COMMENT 'Bytes received from this peer (from wg show dump; FOLLOW-UP poller)',
    tx_bytes                 BIGINT UNSIGNED NULL
                                 COMMENT 'Bytes sent to this peer (from wg show dump; FOLLOW-UP poller)',
    revoked_at               DATETIME NULL
                                 COMMENT 'When the peer was revoked (soft-delete sets deleted_at; revoked_at is the revocation business timestamp)',
    revoked_by               BIGINT UNSIGNED NULL
                                 COMMENT 'User id that performed the revocation (NULL = self-revoke)',
    last_error               TEXT NULL
                                 COMMENT 'Last sync or firewall error',
    created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at               DATETIME NULL,
    active_flag              TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED
                                 COMMENT 'NULL when soft-deleted; used in business unique keys',

    PRIMARY KEY (id),
    UNIQUE KEY uq_wg_user_ip (tunnel_address, active_flag)
                                 COMMENT 'No two active peers share the same tunnel IP',
    UNIQUE KEY uq_wg_user_pubkey (public_key, active_flag)
                                 COMMENT 'No two active peers share the same public key',
    KEY idx_wg_user (user_id, active_flag),
    KEY idx_wg_user_org (organization_id),
    CONSTRAINT fk_wgu_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_wgu_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='User WireGuard peer devices — one row per enrolled device per user (migration 365)';

-- ---------------------------------------------------------------------------
-- Table: user_network_assignments
-- Purpose: Admin-granted, durable scope: which sites or NASes a technician/support
--          user can reach through the user VPN. NOT derived from work orders
--          (work-order-derived scope would allow self-escalation via self-assignment).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_network_assignments (
    id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id          BIGINT UNSIGNED NULL
                                 COMMENT 'Tenant org; NULL = single-tenant deployment',
    user_id                  BIGINT UNSIGNED NOT NULL
                                 COMMENT 'User whose VPN scope this row grants',
    scope_type               ENUM('site','nas') NOT NULL
                                 COMMENT 'Grain of the scope grant: site=all NASes at a site, nas=single NAS',
    scope_id                 BIGINT UNSIGNED NOT NULL
                                 COMMENT 'sites.id (scope_type=site) or nas.id (scope_type=nas)',
    created_by               BIGINT UNSIGNED NULL
                                 COMMENT 'Admin user who granted this scope',
    created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at               DATETIME NULL
                                 COMMENT 'Soft-delete: scope revoked but row retained for audit',
    active_flag              TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED
                                 COMMENT 'NULL when soft-deleted; used in business unique key',

    PRIMARY KEY (id),
    UNIQUE KEY uq_una (user_id, scope_type, scope_id, active_flag)
                                 COMMENT 'One active grant per user/scope combination',
    KEY idx_una_user (user_id, active_flag),
    KEY idx_una_org (organization_id),
    CONSTRAINT fk_una_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_una_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Admin-granted VPN network scope per user (site or NAS grain); durable not work-order-derived (migration 365)';

-- ---------------------------------------------------------------------------
-- Permission seed — wireguard module (idempotent INSERT ... SELECT ... WHERE NOT EXISTS)
-- ---------------------------------------------------------------------------

-- Self-service permissions (technician + support — own peer create/view/revoke)
INSERT INTO permissions (name, description, module)
SELECT 'wireguard.peers.view', 'View own WireGuard VPN peers and tunnel status', 'wireguard'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'wireguard.peers.view');

INSERT INTO permissions (name, description, module)
SELECT 'wireguard.peers.create', 'Create a WireGuard VPN peer for own account', 'wireguard'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'wireguard.peers.create');

INSERT INTO permissions (name, description, module)
SELECT 'wireguard.peers.delete', 'Revoke own WireGuard VPN peer', 'wireguard'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'wireguard.peers.delete');

-- Admin-only permissions
INSERT INTO permissions (name, description, module)
SELECT 'wireguard.peers.admin', 'List, revoke, or rotate any user WireGuard peer (admin oversight)', 'wireguard'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'wireguard.peers.admin');

INSERT INTO permissions (name, description, module)
SELECT 'wireguard.assignments.manage', 'Manage user network scope assignments for WireGuard VPN access', 'wireguard'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'wireguard.assignments.manage');

-- ---------------------------------------------------------------------------
-- Role grants — role_permissions (INSERT IGNORE is idempotent)
-- ---------------------------------------------------------------------------

-- admin + super_admin: all wireguard permissions
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
    'wireguard.peers.view',
    'wireguard.peers.create',
    'wireguard.peers.delete',
    'wireguard.peers.admin',
    'wireguard.assignments.manage'
)
WHERE r.name IN ('admin', 'super_admin');

-- technician + support: self-service only (view/create/delete own peers)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
    'wireguard.peers.view',
    'wireguard.peers.create',
    'wireguard.peers.delete'
)
WHERE r.name IN ('technician', 'support');
