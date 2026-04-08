-- Migration: 048_add_indexes_to_connection_logs
-- Description: Adds dedicated single-column indexes on connection_logs.ip_address
--              and connection_logs.ipv6_address to support fast regulatory
--              compliance queries of the form "who had this IP address?".
--              The existing composite index idx_conn_logs_ip_address (ip_address, event_at)
--              is retained for time-ranged queries; the new standalone indexes
--              optimize pure IP-lookup queries without a time filter.
--              connection_logs is partitioned so indexes are local to each partition.

ALTER TABLE connection_logs
    ADD KEY idx_connection_logs_ip_address (ip_address),
    ADD KEY idx_connection_logs_ipv6_address (ipv6_address);
