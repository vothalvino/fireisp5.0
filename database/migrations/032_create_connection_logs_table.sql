-- Migration: 032_create_connection_logs_table
-- Description: Creates the connection_logs table to record every subscriber
--              session event (start / stop / interim-update) for regulatory
--              compliance.  Each row captures the subscriber identity, the IP
--              address(es) assigned during the session, the NAS, and session
--              counters reported by RADIUS Accounting.
--
-- Design notes:
--   • No FK on contract_id / client_id — compliance logs must survive even if
--     the referenced contract or client is deleted.  The denormalised username
--     and IP columns ensure the record is self-contained.
--   • Monthly RANGE partitions on UNIX_TIMESTAMP(event_at) for instant
--     DROP PARTITION retention (default 2 years).
--   • Indexed by contract, client, username, IP, and session_id for the most
--     common compliance queries ("who had this IP at this time?").

CREATE TABLE IF NOT EXISTS connection_logs (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    contract_id           BIGINT UNSIGNED NOT NULL          COMMENT 'Contract at time of session (no FK — compliance)',
    client_id             BIGINT UNSIGNED NOT NULL          COMMENT 'Client at time of session (no FK — compliance)',
    nas_id                BIGINT UNSIGNED NULL              COMMENT 'NAS that authenticated the session',
    username              VARCHAR(64)     NOT NULL          COMMENT 'RADIUS username at time of session',
    session_id            VARCHAR(64)     NULL              COMMENT 'RADIUS Acct-Session-Id',
    ip_address            VARCHAR(45)     NULL              COMMENT 'IPv4 address assigned during session',
    ipv6_address          VARCHAR(45)     NULL              COMMENT 'IPv6 address assigned during session',
    ipv6_delegated_prefix VARCHAR(45)     NULL              COMMENT 'Delegated IPv6 prefix during session',
    nas_ip_address        VARCHAR(45)     NULL              COMMENT 'NAS IP address at time of session',
    event_type            ENUM('start','stop','interim-update') NOT NULL COMMENT 'RADIUS accounting event type',
    bytes_in              BIGINT UNSIGNED NULL              COMMENT 'Session inbound bytes (at stop/interim)',
    bytes_out             BIGINT UNSIGNED NULL              COMMENT 'Session outbound bytes (at stop/interim)',
    packets_in            BIGINT UNSIGNED NULL              COMMENT 'Session inbound packets (at stop/interim)',
    packets_out           BIGINT UNSIGNED NULL              COMMENT 'Session outbound packets (at stop/interim)',
    session_duration      INT UNSIGNED    NULL              COMMENT 'Session duration in seconds (at stop)',
    terminate_cause       VARCHAR(64)     NULL              COMMENT 'RADIUS Acct-Terminate-Cause',
    event_at              TIMESTAMP       NOT NULL          COMMENT 'When the accounting event occurred',
    created_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id, event_at),
    KEY idx_conn_logs_contract_time (contract_id, event_at),
    KEY idx_conn_logs_client_time (client_id, event_at),
    KEY idx_conn_logs_username (username, event_at),
    KEY idx_conn_logs_ip_address (ip_address, event_at),
    KEY idx_connection_logs_ipv6_address (ipv6_address),
    KEY idx_conn_logs_session_id (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
PARTITION BY RANGE (UNIX_TIMESTAMP(event_at)) (
    PARTITION p2026_01 VALUES LESS THAN (UNIX_TIMESTAMP('2026-02-01')),
    PARTITION p2026_02 VALUES LESS THAN (UNIX_TIMESTAMP('2026-03-01')),
    PARTITION p2026_03 VALUES LESS THAN (UNIX_TIMESTAMP('2026-04-01')),
    PARTITION p2026_04 VALUES LESS THAN (UNIX_TIMESTAMP('2026-05-01')),
    PARTITION p2026_05 VALUES LESS THAN (UNIX_TIMESTAMP('2026-06-01')),
    PARTITION p2026_06 VALUES LESS THAN (UNIX_TIMESTAMP('2026-07-01')),
    PARTITION p_future  VALUES LESS THAN MAXVALUE
);
