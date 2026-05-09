-- =============================================================================
-- Migration 180 — Fix payments.payment_method ENUM to match API validation schema
-- =============================================================================
-- The API validation schema (src/middleware/schemas/payments.js) and the
-- frontend PAYMENT_METHODS list accept the simplified values 'card',
-- 'transfer', and 'online', but the DB ENUM never included them.  Any payment
-- submitted with payment_method='card', 'transfer', or 'online' would be
-- rejected by MySQL's strict ENUM check.  This migration adds those values
-- to the ENUM while keeping all existing MX-specific values intact.
-- =============================================================================

ALTER TABLE payments
    MODIFY COLUMN payment_method
        ENUM(
            'cash', 'check', 'card', 'transfer', 'online',
            'credit_card', 'debit_card', 'bank_transfer',
            'oxxo_pay', 'spei', 'codi', 'convenience_store',
            'digital_wallet', 'other'
        )
        NOT NULL DEFAULT 'cash'
        COMMENT 'Payment instrument; simplified: cash/check/card/transfer/online/other; MX methods: oxxo_pay, spei, codi';
