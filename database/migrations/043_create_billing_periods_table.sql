-- Migration: 043_create_billing_periods_table
-- Description: Creates the billing_periods table to track each contract's
--              billing windows — which periods have been invoiced, which are
--              upcoming, and when the next invoice should be auto-generated.

CREATE TABLE IF NOT EXISTS billing_periods (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    contract_id     BIGINT UNSIGNED NOT NULL  COMMENT 'Contract this billing period belongs to',
    period_start    DATE            NOT NULL  COMMENT 'First day of the billing window (inclusive)',
    period_end      DATE            NOT NULL  COMMENT 'Last day of the billing window (inclusive)',
    invoice_id      BIGINT UNSIGNED NULL      COMMENT 'Invoice generated for this period; NULL = not yet invoiced',
    status          ENUM('pending', 'invoiced', 'skipped')
                        NOT NULL DEFAULT 'pending'
                        COMMENT 'pending = awaiting invoice generation; invoiced = invoice created; skipped = manually skipped',
    scheduled_at    DATE            NOT NULL  COMMENT 'Date when the invoice should be auto-generated for this period',
    invoiced_at     TIMESTAMP       NULL      COMMENT 'Timestamp when the invoice was actually generated',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_billing_periods_contract_period (contract_id, period_start),
    KEY idx_billing_periods_contract_id (contract_id),
    KEY idx_billing_periods_invoice_id (invoice_id),
    KEY idx_billing_periods_status (status),
    KEY idx_billing_periods_scheduled_at (scheduled_at),
    CONSTRAINT fk_billing_periods_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_billing_periods_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
