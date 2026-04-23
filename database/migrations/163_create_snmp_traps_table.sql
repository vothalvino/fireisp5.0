-- =============================================================================
-- Migration 163: Create snmp_traps table
-- =============================================================================
-- Stores unsolicited SNMP trap messages received from network devices.
-- The trap receiver listens on UDP (SNMP_TRAP_PORT, default 1620) and
-- inserts one row per inbound trap PDU.
--
-- Trap types derived from standard SNMP OIDs:
--   coldStart            1.3.6.1.6.3.1.1.5.1
--   warmStart            1.3.6.1.6.3.1.1.5.2
--   linkDown             1.3.6.1.6.3.1.1.5.3
--   linkUp               1.3.6.1.6.3.1.1.5.4
--   authenticationFailure 1.3.6.1.6.3.1.1.5.5
--   egpNeighborLoss      1.3.6.1.6.3.1.1.5.6
--   enterpriseSpecific   (vendor OID)
--   unknown              (unrecognised OID / v1 trap type)
-- =============================================================================

CREATE TABLE IF NOT EXISTS snmp_traps (
    id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id  BIGINT UNSIGNED,
    device_id        BIGINT UNSIGNED,
    source_ip        VARCHAR(45)  NOT NULL,
    trap_type        VARCHAR(64)  NOT NULL DEFAULT 'unknown',
    trap_oid         VARCHAR(255),
    varbinds         JSON,
    community        VARCHAR(128),
    snmp_version     TINYINT UNSIGNED NOT NULL DEFAULT 2,
    is_acknowledged  TINYINT(1)   NOT NULL DEFAULT 0,
    acknowledged_by  BIGINT UNSIGNED,
    acknowledged_at  DATETIME,
    received_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    CONSTRAINT fk_snmp_traps_org    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
    CONSTRAINT fk_snmp_traps_device FOREIGN KEY (device_id)       REFERENCES devices(id)       ON DELETE SET NULL,
    CONSTRAINT fk_snmp_traps_ack_by FOREIGN KEY (acknowledged_by) REFERENCES users(id)         ON DELETE SET NULL,

    INDEX idx_snmp_traps_org_received    (organization_id, received_at),
    INDEX idx_snmp_traps_device_received (device_id, received_at),
    INDEX idx_snmp_traps_type            (trap_type),
    INDEX idx_snmp_traps_received        (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
