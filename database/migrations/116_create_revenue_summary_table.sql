-- Migration: 116_create_revenue_summary_table
-- Description: Materialized revenue summary table for MRR / churn / ARPU
--              reporting. Not a SQL VIEW — populated by a scheduled task so
--              that dashboard queries remain fast regardless of data volume.
--              One row per organization per calendar month per currency.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS revenue_summary (
    id                       BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
    organization_id          BIGINT UNSIGNED   NOT NULL                    COMMENT 'Tenant organization this summary row belongs to',
    period_date              DATE              NOT NULL                    COMMENT 'First day of the calendar month this row summarizes',
    total_mrr                DECIMAL(14, 2)    NOT NULL DEFAULT 0.00       COMMENT 'Monthly Recurring Revenue at end of period',
    total_clients_active     INT UNSIGNED      NOT NULL DEFAULT 0          COMMENT 'Number of clients with at least one active contract',
    total_contracts_active   INT UNSIGNED      NOT NULL DEFAULT 0          COMMENT 'Total active contracts at end of period',
    new_contracts            INT UNSIGNED      NOT NULL DEFAULT 0          COMMENT 'Contracts that started during this period',
    churned_contracts        INT UNSIGNED      NOT NULL DEFAULT 0          COMMENT 'Contracts that were cancelled or expired during this period',
    arpu                     DECIMAL(10, 2)    NOT NULL DEFAULT 0.00       COMMENT 'Average Revenue Per User = total_mrr / total_clients_active',
    total_revenue            DECIMAL(14, 2)    NOT NULL DEFAULT 0.00       COMMENT 'Total amount invoiced during this period',
    total_collected          DECIMAL(14, 2)    NOT NULL DEFAULT 0.00       COMMENT 'Total payments received during this period',
    total_outstanding        DECIMAL(14, 2)    NOT NULL DEFAULT 0.00       COMMENT 'Total unpaid invoice balance at end of period',
    currency                 VARCHAR(3)        NOT NULL DEFAULT 'MXN'      COMMENT 'ISO 4217 currency code for all amounts in this row',
    calculated_at            TIMESTAMP         NOT NULL                    COMMENT 'When the scheduled task last recalculated this row',
    created_at               TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_revenue_summary_org_period_currency (organization_id, period_date, currency),
    KEY idx_revenue_summary_period_date (period_date),
    CONSTRAINT fk_revenue_summary_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
