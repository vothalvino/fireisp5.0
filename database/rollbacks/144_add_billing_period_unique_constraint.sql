-- =============================================================================
-- FireISP 5.0 — Rollback 144: Remove billing period unique constraint
-- =============================================================================
-- Reverses migration 144.
-- =============================================================================

ALTER TABLE billing_periods
  DROP INDEX uq_billing_period_contract_dates;
