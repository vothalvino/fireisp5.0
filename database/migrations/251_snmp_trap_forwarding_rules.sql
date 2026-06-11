-- =============================================================================
-- Migration 251: SNMP Trap Forwarding Rules
-- =============================================================================
-- Implements isp-platform-features.md §6.2 "Device Monitoring":
--   Creates snmp_trap_forwarding_rules — configurable rules that match
--   incoming SNMP traps by type, source IP, or OID prefix and forward them
--   to an HTTP endpoint, email address, or registered webhook.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: snmp_trap_forwarding_rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snmp_trap_forwarding_rules (
    id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id      BIGINT UNSIGNED NULL,
    name                 VARCHAR(200)    NOT NULL,
    match_trap_type      VARCHAR(64)     NULL COMMENT 'NULL = match all trap types',
    match_source_ip      VARCHAR(45)     NULL COMMENT 'NULL = match any source IP',
    match_oid_prefix     VARCHAR(255)    NULL COMMENT 'NULL = match any OID',
    forward_to_url       VARCHAR(500)    NULL COMMENT 'HTTP/HTTPS endpoint for forwarding',
    forward_to_email     VARCHAR(255)    NULL COMMENT 'Email address for forwarding notification',
    forward_to_webhook_id BIGINT UNSIGNED NULL COMMENT 'Webhook ID for forwarding',
    transform_template   TEXT            NULL COMMENT 'Jinja-style template for body transformation (future use)',
    is_active            BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at           DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_stfr_org (organization_id),
    KEY idx_stfr_active (is_active),
    KEY idx_stfr_deleted_at (deleted_at),
    CONSTRAINT fk_stfr_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
