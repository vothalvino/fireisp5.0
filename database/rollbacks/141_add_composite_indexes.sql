-- =============================================================================
-- FireISP 5.0 — Rollback 141: Drop composite indexes for query performance
-- =============================================================================
-- Reverses migration 141.  The forward migration creates each index only when
-- the involved columns exist, so any individual index may be absent.  Each
-- drop is therefore guarded by an INFORMATION_SCHEMA.STATISTICS check inside
-- a stored procedure (MySQL 8 has no DROP INDEX IF EXISTS).
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_141_drop_composite_indexes;
DELIMITER //
CREATE PROCEDURE rollback_141_drop_composite_indexes()
BEGIN
  -- Invoices
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices'
      AND INDEX_NAME = 'idx_invoices_client_created'
  ) THEN
    ALTER TABLE invoices DROP INDEX idx_invoices_client_created;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices'
      AND INDEX_NAME = 'idx_invoices_status_due'
  ) THEN
    ALTER TABLE invoices DROP INDEX idx_invoices_status_due;
  END IF;

  -- Payments
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments'
      AND INDEX_NAME = 'idx_payments_contract_date'
  ) THEN
    ALTER TABLE payments DROP INDEX idx_payments_contract_date;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments'
      AND INDEX_NAME = 'idx_payments_client_created'
  ) THEN
    ALTER TABLE payments DROP INDEX idx_payments_client_created;
  END IF;

  -- Connection logs
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'connection_logs'
      AND INDEX_NAME = 'idx_connection_logs_contract_start'
  ) THEN
    ALTER TABLE connection_logs DROP INDEX idx_connection_logs_contract_start;
  END IF;

  -- Tickets
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tickets'
      AND INDEX_NAME = 'idx_tickets_client_status'
  ) THEN
    ALTER TABLE tickets DROP INDEX idx_tickets_client_status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tickets'
      AND INDEX_NAME = 'idx_tickets_assigned_status'
  ) THEN
    ALTER TABLE tickets DROP INDEX idx_tickets_assigned_status;
  END IF;

  -- Webhook deliveries
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'webhook_deliveries'
      AND INDEX_NAME = 'idx_webhook_deliveries_status_created'
  ) THEN
    ALTER TABLE webhook_deliveries DROP INDEX idx_webhook_deliveries_status_created;
  END IF;

  -- Audit logs
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs'
      AND INDEX_NAME = 'idx_audit_logs_entity_type_id'
  ) THEN
    ALTER TABLE audit_logs DROP INDEX idx_audit_logs_entity_type_id;
  END IF;

  -- Contracts
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'contracts'
      AND INDEX_NAME = 'idx_contracts_client_status'
  ) THEN
    ALTER TABLE contracts DROP INDEX idx_contracts_client_status;
  END IF;
END //
DELIMITER ;
CALL rollback_141_drop_composite_indexes();
DROP PROCEDURE IF EXISTS rollback_141_drop_composite_indexes;
