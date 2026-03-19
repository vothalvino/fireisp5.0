-- Migration: 025_add_snmp_to_devices
-- Description: Adds SNMP configuration columns to the devices table so that
--              both client CPE and POP infrastructure devices can be polled
--              via SNMP.

ALTER TABLE devices
    ADD COLUMN snmp_enabled   BOOLEAN         NOT NULL DEFAULT FALSE
        COMMENT 'Enable SNMP polling for this device'
        AFTER firmware,
    ADD COLUMN snmp_community VARCHAR(255)    NULL
        COMMENT 'SNMP community string (v1/v2c) — store encrypted; decrypt at application layer'
        AFTER snmp_enabled,
    ADD COLUMN snmp_version   ENUM('v1','v2c','v3') NULL DEFAULT 'v2c'
        COMMENT 'SNMP protocol version'
        AFTER snmp_community,
    ADD COLUMN snmp_port      SMALLINT UNSIGNED NULL DEFAULT 161
        COMMENT 'SNMP UDP port'
        AFTER snmp_version,
    ADD KEY idx_devices_snmp_enabled (snmp_enabled);
