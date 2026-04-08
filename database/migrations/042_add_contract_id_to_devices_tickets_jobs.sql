-- Migration: 042_add_contract_id_to_devices_tickets_jobs
-- Description: Adds contract_id FK column to devices, tickets, and jobs tables so
--              that each record can be tied to the specific contract/service it
--              belongs to.  NULL default keeps existing rows valid.

-- ---------------------------------------------------------------------------
-- devices: link a CPE to the specific contract it serves
-- ---------------------------------------------------------------------------
ALTER TABLE devices
    ADD COLUMN contract_id BIGINT UNSIGNED NULL
        COMMENT 'Contract this device serves (e.g. which service a CPE belongs to)'
        AFTER client_id,
    ADD KEY idx_devices_contract_id (contract_id),
    ADD CONSTRAINT fk_devices_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- tickets: link a support ticket to the specific contract it concerns
-- ---------------------------------------------------------------------------
ALTER TABLE tickets
    ADD COLUMN contract_id BIGINT UNSIGNED NULL
        COMMENT 'Contract this ticket concerns (NULL = general client-level ticket)'
        AFTER client_id,
    ADD KEY idx_tickets_contract_id (contract_id),
    ADD CONSTRAINT fk_tickets_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- jobs: link a field work order to the specific contract being worked on
-- ---------------------------------------------------------------------------
ALTER TABLE jobs
    ADD COLUMN contract_id BIGINT UNSIGNED NULL
        COMMENT 'Contract this job is related to (installation, repair, maintenance)'
        AFTER site_id,
    ADD KEY idx_jobs_contract_id (contract_id),
    ADD CONSTRAINT fk_jobs_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE;
