-- Migration: 056_add_tax_rate_id_to_financial_tables
-- Description: Links invoices, quotes, and credit notes to the new tax_rates
--              master table. The existing tax_rate DECIMAL column is kept as a
--              snapshot of the rate at document-creation time; tax_rate_id
--              records which named configuration was used.

ALTER TABLE invoices
    ADD COLUMN tax_rate_id BIGINT UNSIGNED NULL COMMENT 'Tax rate configuration used; NULL = manual / legacy rate',
    ADD KEY idx_invoices_tax_rate_id (tax_rate_id),
    ADD CONSTRAINT fk_invoices_tax_rate FOREIGN KEY (tax_rate_id)
        REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE quotes
    ADD COLUMN tax_rate_id BIGINT UNSIGNED NULL COMMENT 'Tax rate configuration used; NULL = manual / legacy rate',
    ADD KEY idx_quotes_tax_rate_id (tax_rate_id),
    ADD CONSTRAINT fk_quotes_tax_rate FOREIGN KEY (tax_rate_id)
        REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE credit_notes
    ADD COLUMN tax_rate_id BIGINT UNSIGNED NULL COMMENT 'Tax rate configuration used; NULL = manual / legacy rate',
    ADD KEY idx_credit_notes_tax_rate_id (tax_rate_id),
    ADD CONSTRAINT fk_credit_notes_tax_rate FOREIGN KEY (tax_rate_id)
        REFERENCES tax_rates (id) ON DELETE SET NULL ON UPDATE CASCADE;
