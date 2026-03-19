-- ---------------------------------------------------------------------------
-- Migration 022: Add IPv6 and dual-stack support
-- Purpose: Extend network tables with IPv6 fields so every IP-aware table
--          supports IPv4, IPv6, and dual-stack (simultaneous v4 + v6).
--
-- Tables altered:
--   ip_pools       – add ip_version column to distinguish v4 / v6 pools
--   ip_assignments – add prefix_len for IPv6 prefix delegation
--   radius         – add ipv6_address, ipv6_delegated_prefix, ipv6_prefix_len
--   nas            – add ipv6_address for dual-stack NAS management
--   devices        – add ipv6_address for dual-stack device management
-- ---------------------------------------------------------------------------

-- ── ip_pools ────────────────────────────────────────────────────────────────
ALTER TABLE ip_pools
    ADD COLUMN ip_version ENUM('4', '6') NOT NULL DEFAULT '4'
        COMMENT 'Address family: 4 = IPv4, 6 = IPv6'
        AFTER name;

ALTER TABLE ip_pools
    DROP KEY uq_ip_pools_network_cidr;

ALTER TABLE ip_pools
    ADD UNIQUE KEY uq_ip_pools_network_cidr_ver (network, cidr, ip_version);

ALTER TABLE ip_pools
    ADD KEY idx_ip_pools_ip_version (ip_version);

-- ── ip_assignments ──────────────────────────────────────────────────────────
ALTER TABLE ip_assignments
    ADD COLUMN prefix_len TINYINT UNSIGNED NULL
        COMMENT 'For IPv6 prefix delegation: prefix length delegated to subscriber (e.g. 48, 56, 64); NULL for single-address assignments'
        AFTER ip_address;

-- ── radius ──────────────────────────────────────────────────────────────────
ALTER TABLE radius
    ADD COLUMN ipv6_address VARCHAR(45) NULL
        COMMENT 'Static IPv6 address if assigned (dual-stack)'
        AFTER ip_address,
    ADD COLUMN ipv6_delegated_prefix VARCHAR(45) NULL
        COMMENT 'Delegated IPv6 prefix e.g. 2001:db8:abcd:: (DHCPv6-PD)'
        AFTER ipv6_address,
    ADD COLUMN ipv6_prefix_len TINYINT UNSIGNED NULL
        COMMENT 'Delegated prefix length e.g. 48, 56, 64'
        AFTER ipv6_delegated_prefix;

-- ── nas ─────────────────────────────────────────────────────────────────────
ALTER TABLE nas
    ADD COLUMN ipv6_address VARCHAR(45) NULL
        COMMENT 'IPv6 management address (dual-stack)'
        AFTER ip_address;

-- ── devices ─────────────────────────────────────────────────────────────────
ALTER TABLE devices
    ADD COLUMN ipv6_address VARCHAR(45) NULL
        COMMENT 'Management IPv6 address (dual-stack)'
        AFTER ip_address;
