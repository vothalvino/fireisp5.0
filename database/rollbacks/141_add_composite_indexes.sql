-- =============================================================================
-- FireISP 5.0 — Rollback 141: Drop composite indexes for query performance
-- =============================================================================
-- Reverses migration 141.  Uses DROP INDEX IF EXISTS (MariaDB) / ignores
-- errors on MySQL 8 if the index was already removed.
-- =============================================================================

-- Invoices
DROP INDEX idx_invoices_client_created ON invoices;
DROP INDEX idx_invoices_status_due ON invoices;

-- Payments
DROP INDEX idx_payments_contract_date ON payments;
DROP INDEX idx_payments_client_created ON payments;

-- Connection logs
DROP INDEX idx_connection_logs_contract_start ON connection_logs;

-- Tickets
DROP INDEX idx_tickets_client_status ON tickets;
DROP INDEX idx_tickets_assigned_status ON tickets;

-- Webhook deliveries
DROP INDEX idx_webhook_deliveries_status_created ON webhook_deliveries;

-- Audit logs
DROP INDEX idx_audit_logs_entity_type_id ON audit_logs;

-- Contracts
DROP INDEX idx_contracts_client_status ON contracts;
