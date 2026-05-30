-- =============================================================================
-- FireISP 5.0 — Rollback 180: Revert payments.payment_method ENUM
-- =============================================================================
-- Reverses migration 180 by restoring the pre-180 payment_method ENUM (as set
-- by migration 074), removing the 'card', 'transfer', and 'online' values.
--
-- NOTE: this will fail if any payment still uses 'card', 'transfer', or
-- 'online'; update those rows before rolling back.
-- =============================================================================

ALTER TABLE payments
  MODIFY COLUMN payment_method
    ENUM(
      'cash', 'check', 'credit_card', 'debit_card', 'bank_transfer',
      'oxxo_pay', 'spei', 'codi', 'convenience_store',
      'digital_wallet', 'other'
    )
    NOT NULL DEFAULT 'cash'
    COMMENT 'Payment instrument; MX methods: oxxo_pay, spei, codi, convenience_store, digital_wallet';
