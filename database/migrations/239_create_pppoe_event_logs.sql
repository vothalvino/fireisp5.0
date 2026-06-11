-- =============================================================================
-- Migration 239: Create pppoe_event_logs table (PPPoE Phase B)
-- =============================================================================
-- Creates the pppoe_event_logs table for PPPoE stage event logging.
-- A syslog shipper (e.g. rsyslog + a small connector) writes to this table;
-- FireISP reads it for MTU diagnostics and LCP failure detection.
--
-- NOTE: No foreign keys on organization_id or nas_id — loose coupling is
--       intentional; the syslog ingest path must not be blocked by FK violations
--       if a NAS is decommissioned or the org is deleted.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pppoe_event_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NULL,
  nas_id BIGINT UNSIGNED NULL,
  username VARCHAR(64) NULL,
  mac VARCHAR(17) NULL,
  stage ENUM('PADI','PADO','PADR','PADS','PADT','LCP','IPCP','IPV6CP','AUTH','OTHER') NOT NULL DEFAULT 'OTHER',
  severity ENUM('info','warning','error') NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  reason_code VARCHAR(50) NULL,
  logged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pppoe_event_logs_org (organization_id),
  KEY idx_pppoe_event_logs_username (username),
  KEY idx_pppoe_event_logs_logged_at (logged_at),
  KEY idx_pppoe_event_logs_severity (severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
