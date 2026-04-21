-- =============================================================================
-- Rollback 159 — Remove auto_create_ticket from alert_rules
-- =============================================================================
-- Reverses migration 159.
-- =============================================================================

ALTER TABLE alert_rules
  DROP COLUMN auto_create_ticket;

ALTER TABLE alert_rules
  MODIFY COLUMN metric VARCHAR(50) NOT NULL
    COMMENT 'cpu_usage, memory_usage, signal_strength, latency_ms, packet_loss, uptime';
