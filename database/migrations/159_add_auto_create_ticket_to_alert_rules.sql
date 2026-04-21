-- =============================================================================
-- Migration 159 — Add auto_create_ticket to alert_rules
-- =============================================================================
-- Extends alert_rules with an auto_create_ticket flag so that when a threshold
-- breach is detected (e.g. bandwidth > 90%) a support ticket is automatically
-- opened against the offending device.
-- Also updates the metric column comment to document bandwidth metrics.
-- =============================================================================

ALTER TABLE alert_rules
  ADD COLUMN auto_create_ticket BOOLEAN NOT NULL DEFAULT FALSE
    COMMENT 'When TRUE, automatically open a ticket on threshold breach'
    AFTER auto_create_outage;

ALTER TABLE alert_rules
  MODIFY COLUMN metric VARCHAR(50) NOT NULL
    COMMENT 'cpu_usage, memory_usage, signal_strength, latency_ms, packet_loss, uptime, if_in_octets, if_out_octets';
