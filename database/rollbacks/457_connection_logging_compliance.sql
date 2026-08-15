-- =============================================================================
-- Rollback 457 — subscriber session and IP-attribution evidence
-- =============================================================================
-- DESTRUCTIVE: dropping the evidence tables permanently removes data collected
-- after migration 457. Export evidence first. Set MIGRATE_ISOLATED_TENANTS=true
-- and complete rollback preflight so the runner applies this rollback to the
-- primary and every enabled isolated tenant database.
-- The security backfill that binds legacy NULL-organization API tokens to a
-- fixed owner organization is intentionally not reversed: making credentials
-- follow a mutable user home organization again would reopen an authorization
-- ambiguity. Review/revoke those tokens explicitly before rollback.
-- The nullable report_access_logs API-token/government-request provenance
-- columns and the gov_data_requests exact-tuple/review columns are retained
-- intentionally. Older code ignores them, while dropping them would erase
-- credential, legal-review and case-scope provenance from historical records.
-- Permission definitions and grants are retained as well: migration 457 used
-- idempotent name-based inserts and cannot prove that a matching row was
-- created by this migration rather than pre-existing administrator state.

DROP EVENT IF EXISTS evt_subscriber_logging_partition_maintenance;
DROP PROCEDURE IF EXISTS subscriber_logging_maintain_partitions;
DROP TRIGGER IF EXISTS trg_connection_logs_after_update_evidence;
DROP TRIGGER IF EXISTS trg_connection_logs_after_insert_evidence;
DROP TRIGGER IF EXISTS trg_connection_logs_before_insert_org;

DROP TABLE IF EXISTS ip_attribution_case_evidence;
DROP TABLE IF EXISTS cgnat_binding_events;
DROP TABLE IF EXISTS cgnat_attribution_bindings;
DROP TABLE IF EXISTS cgnat_public_tuple_locks;
DROP TABLE IF EXISTS cgnat_exporter_configs;
DROP TABLE IF EXISTS collector_ingest_receipts;
DROP TABLE IF EXISTS radius_accounting_usage_daily;
DROP TABLE IF EXISTS radius_accounting_events;

DROP PROCEDURE IF EXISTS rollback_457_connection_log_org;
DELIMITER //
CREATE PROCEDURE rollback_457_connection_log_org()
BEGIN
  DECLARE v_alter LONGTEXT DEFAULT '';
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND INDEX_NAME = 'idx_conn_logs_app_lookup') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP INDEX idx_conn_logs_app_lookup');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND INDEX_NAME = 'idx_conn_logs_legacy_lookup') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP INDEX idx_conn_logs_legacy_lookup');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND INDEX_NAME = 'idx_conn_logs_retention') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP INDEX idx_conn_logs_retention');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND INDEX_NAME = 'idx_conn_logs_org_retention') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP INDEX idx_conn_logs_org_retention');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND INDEX_NAME = 'idx_conn_logs_org_instance') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP INDEX idx_conn_logs_org_instance');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND INDEX_NAME = 'idx_conn_logs_org_session') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP INDEX idx_conn_logs_org_session');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND INDEX_NAME = 'idx_conn_logs_org_time') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP INDEX idx_conn_logs_org_time');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'retention_at') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP COLUMN retention_at');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'usage_accounting_complete') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP COLUMN usage_accounting_complete');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'attribution_evidence_complete') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP COLUMN attribution_evidence_complete');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'attribution_anomaly_reason') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP COLUMN attribution_anomaly_reason');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'usage_anomaly_count') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP COLUMN usage_anomaly_count');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'usage_last_bytes_in') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP COLUMN usage_last_bytes_in');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'usage_last_bytes_out') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP COLUMN usage_last_bytes_out');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'usage_last_packets_in') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP COLUMN usage_last_packets_in');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'usage_last_packets_out') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP COLUMN usage_last_packets_out');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'usage_last_duration') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP COLUMN usage_last_duration');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'organization_id') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP COLUMN organization_id');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'last_accounting_at') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP COLUMN last_accounting_at');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'last_accounting_received_at') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP COLUMN last_accounting_received_at');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'acct_delay_seconds') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP COLUMN acct_delay_seconds');
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'session_instance_id') THEN
    SET v_alter = CONCAT_WS(', ', NULLIF(v_alter, ''), 'DROP COLUMN session_instance_id');
  END IF;
  IF v_alter <> '' THEN
    SET @sql = CONCAT('ALTER TABLE connection_logs ', v_alter);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL rollback_457_connection_log_org();
DROP PROCEDURE IF EXISTS rollback_457_connection_log_org;

UPDATE scheduled_tasks
   SET description = 'Delete connection_logs rows older than RADIUS_ACCOUNTING_RETENTION_MONTHS (default 12) months'
 WHERE task_name = 'purge_radius_accounting'
   AND organization_id IS NULL;

-- Restore the exact pre-457 migration-248 behavior. This is intentionally
-- destructive: the legacy procedure can drop start-time partitions older than
-- two years, including a very long-lived session. Operators should normally
-- roll forward; this definition is restored solely for true schema rollback.
DROP EVENT IF EXISTS evt_connection_logs_partition_maintenance;
DROP PROCEDURE IF EXISTS connection_logs_maintain_partitions;
DELIMITER //
CREATE PROCEDURE connection_logs_maintain_partitions()
BEGIN
  DECLARE v_month DATE;
  DECLARE v_pname VARCHAR(32);
  DECLARE v_next_ts BIGINT;
  DECLARE v_exists INT DEFAULT 0;

  SET v_month = DATE_FORMAT(CURDATE(), '%Y-%m-01');
  WHILE v_month <= DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 3 MONTH), '%Y-%m-01') DO
    SET v_pname = CONCAT('p', DATE_FORMAT(v_month, '%Y_%m'));
    SET v_next_ts = UNIX_TIMESTAMP(DATE_ADD(v_month, INTERVAL 1 MONTH));
    SELECT COUNT(*) INTO v_exists
      FROM information_schema.PARTITIONS
     WHERE table_schema = DATABASE() AND table_name = 'connection_logs'
       AND partition_name = v_pname;
    IF v_exists = 0 THEN
      SET @sql = CONCAT(
        'ALTER TABLE connection_logs REORGANIZE PARTITION p_future INTO (',
        'PARTITION ', v_pname, ' VALUES LESS THAN (', v_next_ts, '), ',
        'PARTITION p_future VALUES LESS THAN MAXVALUE)');
      PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
    END IF;
    SET v_month = DATE_ADD(v_month, INTERVAL 1 MONTH);
  END WHILE;

  BEGIN
    DECLARE v_cutoff_cl BIGINT;
    DECLARE v_old_cl VARCHAR(32);
    DECLARE v_done_cl TINYINT DEFAULT 0;
    DECLARE c_old_cl CURSOR FOR
      SELECT partition_name FROM information_schema.PARTITIONS
       WHERE table_schema = DATABASE() AND table_name = 'connection_logs'
         AND partition_name != 'p_future' AND partition_description != 'MAXVALUE'
         AND CAST(partition_description AS UNSIGNED) <= v_cutoff_cl;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done_cl = 1;
    SET v_cutoff_cl = UNIX_TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 YEAR));
    OPEN c_old_cl;
    drop_cl_loop: LOOP
      FETCH c_old_cl INTO v_old_cl;
      IF v_done_cl THEN LEAVE drop_cl_loop; END IF;
      SET @sql = CONCAT('ALTER TABLE connection_logs DROP PARTITION ', v_old_cl);
      PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
    END LOOP;
    CLOSE c_old_cl;
  END;
END //
DELIMITER ;

CREATE EVENT evt_connection_logs_partition_maintenance
  ON SCHEDULE EVERY 1 DAY
  STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 3 HOUR + INTERVAL 30 MINUTE)
  ON COMPLETION PRESERVE
  COMMENT 'Maintain connection_logs monthly partitions: add future, drop expired (2-year retention)'
  DO CALL connection_logs_maintain_partitions();
