-- Migration: 032_add_snmp_profile_to_devices
-- Description: Adds snmp_profile_id FK column to the devices table so that a
--              specific SNMP profile can be explicitly assigned to a device.
--              When NULL the poller auto-matches a profile by manufacturer,
--              model_pattern, and device_type, then falls back to is_default.
--
-- Requires:    030_create_snmp_profiles_table

ALTER TABLE devices
    ADD COLUMN snmp_profile_id BIGINT UNSIGNED NULL
        COMMENT 'Explicit SNMP profile override; NULL = auto-match by manufacturer/model/type'
        AFTER snmp_port,
    ADD KEY idx_devices_snmp_profile_id (snmp_profile_id),
    ADD CONSTRAINT fk_devices_snmp_profile FOREIGN KEY (snmp_profile_id)
        REFERENCES snmp_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE;
