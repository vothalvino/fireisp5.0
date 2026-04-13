-- =============================================================================
-- Migration 141: Add composite indexes for high-traffic query patterns
-- =============================================================================
-- These composite indexes optimize the most common query patterns identified
-- in production usage:
--   - Invoice lookups by client + date range
--   - Payment lookups by contract + date
--   - Connection log queries by contract + timestamp
--   - Ticket querying by client + status
--   - SNMP metrics queries by device + timestamp
-- =============================================================================

-- Invoices: frequently queried by client_id + created_at (billing history)
CREATE INDEX idx_invoices_client_created
  ON invoices (client_id, created_at DESC);

-- Invoices: filter by status + due date (overdue invoice detection)
CREATE INDEX idx_invoices_status_due
  ON invoices (status, due_date);

-- Payments: contract-based payment history
CREATE INDEX idx_payments_contract_date
  ON payments (contract_id, payment_date DESC);

-- Payments: client-based payment lookup
CREATE INDEX idx_payments_client_created
  ON payments (client_id, created_at DESC);

-- Connection logs: per-contract usage queries with time range
CREATE INDEX idx_connection_logs_contract_start
  ON connection_logs (contract_id, start_time DESC);

-- Tickets: client ticket history with status filtering
CREATE INDEX idx_tickets_client_status
  ON tickets (client_id, status, created_at DESC);

-- Tickets: assignment queue (open tickets by assigned user)
CREATE INDEX idx_tickets_assigned_status
  ON tickets (assigned_to, status);

-- Webhook deliveries: status-based retry queries
CREATE INDEX idx_webhook_deliveries_status_created
  ON webhook_deliveries (status, created_at ASC);

-- Audit logs: per-entity lookup for audit trail
CREATE INDEX idx_audit_logs_entity_type_id
  ON audit_logs (entity_type, entity_id, created_at DESC);

-- Contracts: client + status for active contract lookups
CREATE INDEX idx_contracts_client_status
  ON contracts (client_id, status);
