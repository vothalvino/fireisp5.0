-- Migration: 038_create_credit_notes_table
-- Description: Creates the credit_notes table for issuing credits to clients.
--              Credit notes reduce the amount a client owes and are linked to the
--              original invoice when applicable.

CREATE TABLE IF NOT EXISTS credit_notes (
    id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id          BIGINT UNSIGNED NOT NULL,
    contract_id        BIGINT UNSIGNED NULL,
    invoice_id         BIGINT UNSIGNED NULL      COMMENT 'Original invoice being credited, if any',
    payment_id         BIGINT UNSIGNED NULL      COMMENT 'Payment that triggered this credit note (e.g. duplicate payment refund)',
    credit_note_number VARCHAR(50)     NOT NULL,
    issue_date         DATE            NOT NULL,
    reason             ENUM(
                           'return',
                           'courtesy',
                           'service_outage',
                           'billing_error',
                           'duplicate_payment',
                           'downgrade',
                           'cancellation',
                           'other'
                       ) NOT NULL
                           COMMENT 'return=client returned equipment; courtesy=goodwill/customer satisfaction; service_outage=compensation for downtime; billing_error=incorrect charge on invoice; duplicate_payment=client paid twice; downgrade=refund of unused service after plan change; cancellation=prorated refund for early termination; other=see notes',
    subtotal           DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    tax_rate           DECIMAL(5, 4)   NOT NULL DEFAULT 0.0000 COMMENT 'e.g. 0.0800 for 8%',
    tax_amount         DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    total              DECIMAL(10, 2)  NOT NULL DEFAULT 0.00,
    notes              TEXT            NULL,
    status             ENUM('draft', 'issued', 'applied', 'cancelled') NOT NULL DEFAULT 'draft'
                           COMMENT 'draft=being prepared; issued=sent to client; applied=credit applied to account; cancelled=voided',
    applied_at         TIMESTAMP       NULL      COMMENT 'When the credit was applied to the client account',
    created_by         BIGINT UNSIGNED NULL,
    created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_credit_notes_number (credit_note_number),
    KEY idx_credit_notes_client_id (client_id),
    KEY idx_credit_notes_contract_id (contract_id),
    KEY idx_credit_notes_invoice_id (invoice_id),
    KEY idx_credit_notes_payment_id (payment_id),
    KEY idx_credit_notes_status (status),
    KEY idx_credit_notes_reason (reason),
    KEY idx_credit_notes_issue_date (issue_date),
    CONSTRAINT fk_credit_notes_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_credit_notes_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_credit_notes_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_credit_notes_payment FOREIGN KEY (payment_id)
        REFERENCES payments (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_credit_notes_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
