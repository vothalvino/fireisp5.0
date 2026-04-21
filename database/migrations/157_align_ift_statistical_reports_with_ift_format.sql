-- Migration: 157_align_ift_statistical_reports_with_ift_format
-- Description: Aligns the ift_statistical_reports table with the IFT
--              "Formato Estadistico - Servicio Fijo de Internet" required
--              fields, per docs/ift-statistical-report-schema-review.md.
--              Adds the concession title FK, the per-municipality breakdown,
--              the customer-type and payment-modality breakdowns, and a
--              free-form notes column.

-- Disable FK checks: concession_titles created in earlier migration (075).
SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE ift_statistical_reports
    ADD COLUMN concession_title_id BIGINT UNSIGNED NULL
        COMMENT 'Concession/authorization title under which the service is provided (IFT F2)'
        AFTER organization_id,
    ADD COLUMN subscribers_by_municipality JSON NULL
        COMMENT 'JSON object: INEGI municipality code => subscriber count (IFT F5 breakdown)'
        AFTER subscribers_by_state,
    ADD COLUMN subscribers_by_customer_type JSON NULL
        COMMENT 'JSON object: residential/business subscriber counts (IFT F11)'
        AFTER subscribers_by_technology,
    ADD COLUMN subscribers_by_payment_modality JSON NULL
        COMMENT 'JSON object: pospago/prepago/empaquetado subscriber counts (IFT F12)'
        AFTER subscribers_by_customer_type,
    ADD COLUMN notes TEXT NULL
        COMMENT 'Free-form notes / filing comments for this snapshot'
        AFTER status,
    ADD KEY idx_ift_statistical_reports_concession_title_id (concession_title_id),
    ADD CONSTRAINT fk_ift_statistical_reports_concession_title
        FOREIGN KEY (concession_title_id)
        REFERENCES concession_titles (id) ON DELETE SET NULL ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;
