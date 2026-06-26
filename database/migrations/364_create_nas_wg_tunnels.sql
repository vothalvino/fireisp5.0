-- =============================================================================
-- Migration 364 — WireGuard per-NAS tunnels: nas_wg_tunnels table
-- =============================================================================
-- One row per NAS WireGuard tunnel (1:1 with nas). The FireISP host acts as the
-- WireGuard hub (wg-fireisp); each MikroTik NAS dials out as a peer. This table
-- stores the server-generated keypair (private key AES-256-GCM encrypted), the
-- allocated tunnel IP from WG_SERVER_SUBNET, the confirmed routed CIDRs, and the
-- provisioning state machine.
--
-- HARD CONSTRAINT: FireISP NEVER writes /ip/service or /ip/firewall on the router.
-- RouterOS writes are limited to: /interface/wireguard, /ip/address,
-- /interface/wireguard/peers, and routes only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS nas_wg_tunnels (
    id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id          BIGINT UNSIGNED NULL
                                 COMMENT 'Tenant org; NULL = single-tenant deployment',
    nas_id                   BIGINT UNSIGNED NOT NULL
                                 COMMENT 'FK to nas.id — one active tunnel per NAS',
    interface_name           VARCHAR(15) NOT NULL DEFAULT 'wg-fireisp'
                                 COMMENT 'Host WireGuard interface name (max 15 chars; Linux IFNAMSIZ)',
    tunnel_address           VARCHAR(45) NOT NULL
                                 COMMENT 'Allocated /32 host IP within WG_SERVER_SUBNET (e.g. 10.255.0.2)',
    nas_public_key           VARCHAR(64) NOT NULL
                                 COMMENT 'NAS WireGuard public key (base64 x25519, 44 chars)',
    nas_private_key_encrypted TEXT NULL
                                 COMMENT 'NAS WireGuard private key, AES-256-GCM via src/utils/encryption.js; NULL until provisioned',
    nas_config_method        ENUM('api','snippet','manual') NOT NULL DEFAULT 'manual'
                                 COMMENT 'How the NAS was/will be configured: api=RouterOS API push, snippet=paste-once CLI, manual=operator-managed',
    routed_subnets           JSON NULL
                                 COMMENT 'JSON array of confirmed CIDR strings this NAS owns (e.g. ["192.168.100.0/24"]); NULL until confirmRoutes',
    state                    ENUM('pending','active','manual','degraded','error','disabled') NOT NULL DEFAULT 'pending'
                                 COMMENT 'Provisioning state: pending=DB only, active=API-pushed, manual=snippet-only, degraded=handshake stale, error=last op failed, disabled=admin off',
    server_peer_synced       TINYINT(1) NOT NULL DEFAULT 0
                                 COMMENT '1 when wg set wg-fireisp peer has been called for this NAS',
    last_handshake_at        DATETIME NULL
                                 COMMENT 'Last WireGuard handshake timestamp (updated by poller; FOLLOW-UP)',
    last_error               TEXT NULL
                                 COMMENT 'Last provisioning or bootstrap error message',
    provisioned_at           DATETIME NULL
                                 COMMENT 'Timestamp when state first became active or manual',
    created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at               DATETIME NULL,
    active_flag              TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED
                                 COMMENT 'NULL when soft-deleted; used in business unique keys to ignore soft-deleted rows',

    PRIMARY KEY (id),
    UNIQUE KEY uq_wg_nas (nas_id, active_flag)
                                 COMMENT 'One active tunnel per NAS; allows a new row after soft-delete',
    UNIQUE KEY uq_wg_tunnel_ip (tunnel_address, active_flag)
                                 COMMENT 'No two active tunnels share the same host IP in the WG subnet',
    KEY idx_wg_state (state),
    KEY idx_wg_nas_org (organization_id),
    CONSTRAINT fk_nwgt_nas FOREIGN KEY (nas_id)
        REFERENCES nas (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_nwgt_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-NAS WireGuard tunnel configuration and state (Part 1 hub; migration 364)';
