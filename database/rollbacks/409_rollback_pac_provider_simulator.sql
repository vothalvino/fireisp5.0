-- Rollback for migration 409 — remove 'simulator' from provider_name.
-- Any simulator rows must be deleted first or the MODIFY fails.
DELETE FROM pac_providers WHERE provider_name = 'simulator';
ALTER TABLE pac_providers
  MODIFY COLUMN provider_name ENUM('finkok','sw_sapien','digicel','comercio_digital','facturapi','other')
    NOT NULL COMMENT 'PAC vendor identifier';
