-- Rollback for migration 349 — drop integration_connections and integration_sync_logs
DROP TABLE IF EXISTS integration_sync_logs;
DROP TABLE IF EXISTS integration_connections;
