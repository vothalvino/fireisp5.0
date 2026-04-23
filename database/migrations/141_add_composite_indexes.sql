-- =============================================================================
-- Migration 141: Add composite indexes for high-traffic query patterns
-- =============================================================================
-- Idempotent and schema-tolerant: each index is created only when:
--   1) all required columns exist on the table, and
--   2) the index name is not already present.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_141_add_composite_indexes;
DELIMITER //
CREATE PROCEDURE migration_141_add_composite_indexes()
BEGIN
  -- Invoices: frequently queried by client_id + created_at (billing history)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'invoices' AND column_name = 'client_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'invoices' AND column_name = 'created_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'invoices' AND index_name = 'idx_invoices_client_created'
  ) THEN
    CREATE INDEX idx_invoices_client_created
      ON invoices (client_id, created_at DESC);
  END IF;

  -- Invoices: filter by status + due date (overdue invoice detection)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'invoices' AND column_name = 'status'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'invoices' AND column_name = 'due_date'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'invoices' AND index_name = 'idx_invoices_status_due'
  ) THEN
    CREATE INDEX idx_invoices_status_due
      ON invoices (status, due_date);
  END IF;

  -- Payments: contract-based payment history (only if contract_id exists)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'payments' AND column_name = 'contract_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'payments' AND column_name = 'payment_date'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'payments' AND index_name = 'idx_payments_contract_date'
  ) THEN
    CREATE INDEX idx_payments_contract_date
      ON payments (contract_id, payment_date DESC);
  END IF;

  -- Payments: client-based payment lookup
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'payments' AND column_name = 'client_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'payments' AND column_name = 'created_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'payments' AND index_name = 'idx_payments_client_created'
  ) THEN
    CREATE INDEX idx_payments_client_created
      ON payments (client_id, created_at DESC);
  END IF;

  -- Connection logs: per-contract usage queries with time range
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'connection_logs' AND column_name = 'contract_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'connection_logs' AND column_name = 'start_time'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'connection_logs' AND index_name = 'idx_connection_logs_contract_start'
  ) THEN
    CREATE INDEX idx_connection_logs_contract_start
      ON connection_logs (contract_id, start_time DESC);
  END IF;

  -- Tickets: client ticket history with status filtering
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'tickets' AND column_name = 'client_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'tickets' AND column_name = 'status'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'tickets' AND column_name = 'created_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'tickets' AND index_name = 'idx_tickets_client_status'
  ) THEN
    CREATE INDEX idx_tickets_client_status
      ON tickets (client_id, status, created_at DESC);
  END IF;

  -- Tickets: assignment queue (open tickets by assigned user)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'tickets' AND column_name = 'assigned_to'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'tickets' AND column_name = 'status'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'tickets' AND index_name = 'idx_tickets_assigned_status'
  ) THEN
    CREATE INDEX idx_tickets_assigned_status
      ON tickets (assigned_to, status);
  END IF;

  -- Webhook deliveries: status-based retry queries
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries' AND column_name = 'status'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries' AND column_name = 'created_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'webhook_deliveries' AND index_name = 'idx_webhook_deliveries_status_created'
  ) THEN
    CREATE INDEX idx_webhook_deliveries_status_created
      ON webhook_deliveries (status, created_at ASC);
  END IF;

  -- Audit logs: per-entity lookup for audit trail
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND column_name = 'entity_type'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND column_name = 'entity_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND column_name = 'created_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'audit_logs' AND index_name = 'idx_audit_logs_entity_type_id'
  ) THEN
    CREATE INDEX idx_audit_logs_entity_type_id
      ON audit_logs (entity_type, entity_id, created_at DESC);
  END IF;

  -- Contracts: client + status for active contract lookups
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'contracts' AND column_name = 'client_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'contracts' AND column_name = 'status'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'contracts' AND index_name = 'idx_contracts_client_status'
  ) THEN
    CREATE INDEX idx_contracts_client_status
      ON contracts (client_id, status);
  END IF;
END //
DELIMITER ;

CALL migration_141_add_composite_indexes();
DROP PROCEDURE IF EXISTS migration_141_add_composite_indexes;
