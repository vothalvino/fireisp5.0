-- Migration: 035_create_netflow_usage_1day_table
-- Description: Creates the netflow_usage_1day table for daily aggregated data
--              usage per contract.  Rolled up from raw netflow_usage via the
--              netflow_rollup_to_1day() procedure.
--
-- Retention: kept indefinitely (3+ years) for billing and compliance.

CREATE TABLE IF NOT EXISTS netflow_usage_1day (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    contract_id     BIGINT UNSIGNED NOT NULL,
    period_start    DATE            NOT NULL           COMMENT 'Calendar day this row covers',
    sum_bytes_in    BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Total inbound bytes for the day',
    sum_bytes_out   BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Total outbound bytes for the day',
    sum_packets_in  BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Total inbound packets for the day',
    sum_packets_out BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Total outbound packets for the day',
    sample_count    INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'Number of raw 5-min samples aggregated',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_netflow_1day_contract_period (contract_id, period_start),
    KEY idx_netflow_1day_period_start (period_start),
    CONSTRAINT fk_netflow_1day_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
