-- =============================================================================
-- Migration 144: Add unique constraint for invoice generation idempotency
-- =============================================================================
-- Prevents duplicate invoices for the same contract and billing period.
-- =============================================================================

ALTER TABLE billing_periods
  ADD UNIQUE INDEX uq_billing_period_contract_dates (contract_id, period_start, period_end);
