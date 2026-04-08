-- Migration: 047_add_unique_serial_number_to_devices
-- Description: Adds a UNIQUE constraint on devices.serial_number to prevent
--              duplicate serial numbers from being inserted silently.
--              MySQL allows multiple NULLs in a UNIQUE index, so nullable
--              serial_number rows are unaffected.

ALTER TABLE devices
    ADD UNIQUE KEY uq_devices_serial_number (serial_number);
