-- Migration: 076_create_regulatory_filings_table
-- Description: Tracks periodic regulatory filings submitted to IFT/CRT.
--              Mexican ISPs are required to submit various reports on a fixed
--              schedule (annual, quarterly, etc.) — this table records each filing
--              event, its status, and optional links to an uploaded document and
--              a concession title.

-- Disable FK checks: organizations, concession_titles, and files created in earlier migrations.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS regulatory_filings (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id         BIGINT UNSIGNED NOT NULL
                                COMMENT 'Organization responsible for this filing',
    concession_title_id     BIGINT UNSIGNED NULL
                                COMMENT 'Concession title this filing relates to; NULL = general organizational filing',
    filing_type             ENUM(
                                'annual_report',
                                'quarterly_stats',
                                'tariff_registration',
                                'qos_report',
                                'coverage_report',
                                'spectrum_usage',
                                'other'
                            ) NOT NULL
                                COMMENT 'annual_report=yearly LFTR report; quarterly_stats=subscriber/usage stats; tariff_registration=tariff change notification; qos_report=quality of service; coverage_report=geographic coverage update; spectrum_usage=spectrum use report',
    period_start            DATE            NULL
                                COMMENT 'Start date of the reporting period',
    period_end              DATE            NULL
                                COMMENT 'End date of the reporting period',
    filed_at                TIMESTAMP       NULL
                                COMMENT 'Timestamp when the filing was submitted to IFT/CRT',
    acknowledgement_number  VARCHAR(100)    NULL
                                COMMENT 'Official acknowledgement number assigned by IFT/CRT upon receipt',
    document_file_id        BIGINT UNSIGNED NULL
                                COMMENT 'Uploaded filing document in the files table',
    status                  ENUM('pending', 'filed', 'accepted', 'rejected', 'overdue')
                                NOT NULL DEFAULT 'pending'
                                COMMENT 'pending=not yet submitted; filed=submitted awaiting response; accepted=authority confirmed; rejected=returned for correction; overdue=deadline passed without filing',
    notes                   TEXT            NULL,
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_regulatory_filings_organization_id (organization_id),
    KEY idx_regulatory_filings_concession_title_id (concession_title_id),
    KEY idx_regulatory_filings_filing_type (filing_type),
    KEY idx_regulatory_filings_status (status),
    KEY idx_regulatory_filings_filed_at (filed_at),
    KEY idx_regulatory_filings_period_start (period_start),
    CONSTRAINT fk_regulatory_filings_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_regulatory_filings_concession_title FOREIGN KEY (concession_title_id)
        REFERENCES concession_titles (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_regulatory_filings_document FOREIGN KEY (document_file_id)
        REFERENCES files (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
