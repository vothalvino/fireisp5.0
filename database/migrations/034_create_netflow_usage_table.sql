-- Migration: 034_create_netflow_usage_table
-- Description: Creates the netflow_usage table for tracking per-contract data
--              consumption from NetFlow/IPFIX collectors.  One row per contract
--              per 5-minute sampling interval.
--
-- Design notes:
--   • No FK on contract_id — follows the snmp_metrics pattern to avoid write
--     overhead on the hot insert path (collectors write at high volume).
--   • Composite PK (id, sampled_at) enables partition elimination.
--   • Monthly RANGE partitions on UNIX_TIMESTAMP(sampled_at) for instant
--     DROP PARTITION retention (90 days).

CREATE TABLE IF NOT EXISTS netflow_usage (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    contract_id   BIGINT UNSIGNED NOT NULL          COMMENT 'Contract this usage belongs to (no FK — hot path)',
    bytes_in      BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Inbound bytes (download) during interval',
    bytes_out     BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Outbound bytes (upload) during interval',
    packets_in    BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Inbound packets during interval',
    packets_out   BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Outbound packets during interval',
    sampled_at    TIMESTAMP       NOT NULL           COMMENT 'Start of the 5-minute sampling interval',
    created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id, sampled_at),
    KEY idx_netflow_usage_contract_time (contract_id, sampled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (UNIX_TIMESTAMP(sampled_at)) (
    PARTITION p2026_01 VALUES LESS THAN (UNIX_TIMESTAMP('2026-02-01')),
    PARTITION p2026_02 VALUES LESS THAN (UNIX_TIMESTAMP('2026-03-01')),
    PARTITION p2026_03 VALUES LESS THAN (UNIX_TIMESTAMP('2026-04-01')),
    PARTITION p2026_04 VALUES LESS THAN (UNIX_TIMESTAMP('2026-05-01')),
    PARTITION p2026_05 VALUES LESS THAN (UNIX_TIMESTAMP('2026-06-01')),
    PARTITION p2026_06 VALUES LESS THAN (UNIX_TIMESTAMP('2026-07-01')),
    PARTITION p_future  VALUES LESS THAN MAXVALUE
);
