-- =============================================================================
-- Migration 345 — Add reseller_id to clients (§19.1 scoping)
-- =============================================================================
-- Adds nullable reseller_id FK to clients table so each client can optionally
-- belong to a reseller. Uses INFORMATION_SCHEMA stored-proc guard (idempotent).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_345_add_reseller_id_to_clients;
DELIMITER //
CREATE PROCEDURE migration_345_add_reseller_id_to_clients()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'reseller_id'
  ) THEN
    ALTER TABLE clients
      ADD COLUMN reseller_id BIGINT UNSIGNED NULL
          COMMENT 'Reseller this client belongs to; NULL = direct ISP customer'
          AFTER suspension_exempt_reason,
      ADD KEY idx_clients_reseller_id (reseller_id),
      ADD CONSTRAINT fk_clients_reseller FOREIGN KEY (reseller_id)
          REFERENCES resellers (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_345_add_reseller_id_to_clients();
DROP PROCEDURE IF EXISTS migration_345_add_reseller_id_to_clients;
