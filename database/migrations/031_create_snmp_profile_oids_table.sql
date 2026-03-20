-- Migration: 031_create_snmp_profile_oids_table
-- Description: Creates the snmp_profile_oids table — maps vendor-specific OIDs
--              to the normalized snmp_metrics wide-table columns for each
--              snmp_profiles entry.
--
-- Requires:    030_create_snmp_profiles_table

-- ---------------------------------------------------------------------------
-- Table: snmp_profile_oids
-- Purpose: Maps vendor-specific SNMP OIDs to the normalized metric columns in
--          snmp_metrics (if_in_octets, cpu_usage, signal_strength, etc.).
--          Each row tells the poller: "for this profile, poll this OID and
--          store the result in this snmp_metrics column".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snmp_profile_oids (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    profile_id      BIGINT UNSIGNED NOT NULL,
    oid             VARCHAR(255)    NOT NULL COMMENT 'SNMP OID to poll e.g. 1.3.6.1.2.1.2.2.1.10',
    metric_column   VARCHAR(64)     NOT NULL COMMENT 'Target column in snmp_metrics: if_in_octets, cpu_usage, signal_strength, etc.',
    label           VARCHAR(100)    NULL     COMMENT 'Human-readable label for display',
    oid_type        ENUM('gauge','counter','counter64','string','timeticks') NOT NULL DEFAULT 'gauge'
                                             COMMENT 'SNMP value type for proper delta/rate calculation',
    is_per_interface BOOLEAN        NOT NULL DEFAULT FALSE COMMENT 'TRUE = walk ifTable with ifIndex, FALSE = scalar',
    transform       VARCHAR(255)    NULL     COMMENT 'Optional transform expression e.g. "value / 10", "value * -1"',
    sort_order      INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'Display ordering within the profile',
    status          ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_profile_oid (profile_id, oid),
    KEY idx_snmp_profile_oids_metric (metric_column),
    KEY idx_snmp_profile_oids_status (status),
    CONSTRAINT fk_snmp_profile_oids_profile FOREIGN KEY (profile_id)
        REFERENCES snmp_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
