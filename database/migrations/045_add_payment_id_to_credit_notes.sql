-- Migration: 045_add_payment_id_to_credit_notes
-- Description: Adds payment_id FK column to credit_notes so that a credit note
--              issued due to a duplicate payment can be traced back to that payment.

ALTER TABLE credit_notes
    ADD COLUMN payment_id BIGINT UNSIGNED NULL
        COMMENT 'Payment that triggered this credit note (e.g. duplicate payment refund)'
        AFTER invoice_id,
    ADD KEY idx_credit_notes_payment_id (payment_id),
    ADD CONSTRAINT fk_credit_notes_payment FOREIGN KEY (payment_id)
        REFERENCES payments (id) ON DELETE SET NULL ON UPDATE CASCADE;
