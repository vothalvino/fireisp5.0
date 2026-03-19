-- Migration: 018_update_devices_for_pop_and_client
-- Description: Update the devices table to support both client devices
--              (Outdoor/Indoor CPE) and POP devices (PTP, PTMP, OLT, Router, etc.)

-- Step 1: Map any legacy free-text type values to the closest new ENUM value.
--         Values not explicitly listed are normalised to 'other' so the
--         subsequent MODIFY COLUMN does not fail in strict mode.
UPDATE devices SET type = CASE
    WHEN type IN ('outdoor_cpe')          THEN 'outdoor_cpe'
    WHEN type IN ('indoor_cpe')           THEN 'indoor_cpe'
    WHEN type IN ('ptp')                  THEN 'ptp'
    WHEN type IN ('ptmp', 'ptmp_ap')      THEN 'ptmp_ap'
    WHEN type IN ('olt')                  THEN 'olt'
    WHEN type IN ('router')               THEN 'router'
    WHEN type IN ('switch')               THEN 'switch'
    WHEN type IN ('onu', 'ont')           THEN 'onu'
    ELSE                                       'other'
END;

-- Step 2: Add explicit category column and update type to a controlled ENUM.
ALTER TABLE devices

    -- Explicit category to distinguish client CPE from POP infrastructure
    ADD COLUMN category ENUM('client', 'pop') NOT NULL DEFAULT 'client'
        COMMENT 'client=Customer Premises Equipment (Outdoor/Indoor CPE), pop=POP Infrastructure (PTP, PTMP, OLT, Router, etc.)'
        AFTER client_id,

    -- Replace free-text type with a controlled enum covering both categories:
    --   Client types : outdoor_cpe, indoor_cpe
    --   POP types    : ptp, ptmp_ap, olt, router, switch, onu
    MODIFY COLUMN type ENUM(
        'outdoor_cpe',
        'indoor_cpe',
        'ptp',
        'ptmp_ap',
        'olt',
        'router',
        'switch',
        'onu',
        'other'
    ) NOT NULL DEFAULT 'other'
        COMMENT 'Device type — client: outdoor_cpe, indoor_cpe; pop: ptp, ptmp_ap, olt, router, switch, onu',

    -- Index for efficient queries filtering by category
    ADD INDEX idx_devices_category (category);
