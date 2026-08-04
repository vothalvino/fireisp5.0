-- =============================================================================
-- Migration 445 — subscriber-flow completion: lead plan, install acceptance,
--                 billing follow-up
-- =============================================================================
-- Three additions from the subscriber-flow gap analysis (2026-08-03):
--
--   * leads.desired_plan_id — the tier the prospect asked for at intake, so it
--     can prefill the service order instead of being re-asked (or lost) at
--     conversion time. FK to plans, SET NULL on plan deletion: a retired plan
--     must not block deleting itself over old leads.
--
--   * work_orders acceptance_* — install-acceptance readings captured when an
--     installation work order completes: wireless signal (dBm) / negotiated
--     link rate (Mbps) or FTTH optical Rx power (dBm), plus an explicit waive
--     escape hatch. The three-tier monitoring thresholds (migration 388) judge
--     these numbers later; this records ground truth at handoff. Enforcement
--     lives in the route (installation WOs linked to a contract cannot
--     complete without a reading or a waive), not in the schema — other WO
--     types never need them.
--
--   * service_orders.billing_followup_ticket_id — marker for the automated
--     billing follow-up ticket (billing_followup_dispatcher task): created
--     once per completed order, N days after completion, N per-org via the
--     billing_followup_days org setting (settingsCatalog). NULL = not yet
--     dispatched (or feature disabled). FK to tickets, SET NULL if the ticket
--     is hard-deleted so the order does not dangle.
--
-- Also seeds the billing_followup_dispatcher scheduled task (hourly; the
-- day-granular delay makes latency uncritical, hourly keeps "1 day" prompt).
-- The task name has a matching case in src/services/taskRunner.js added in the
-- same PR — a seeded task with no case never runs, silently.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_445_subscriber_flow;
DELIMITER //
CREATE PROCEDURE migration_445_subscriber_flow()
BEGIN
  -- ---- leads.desired_plan_id ----------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'leads'
      AND COLUMN_NAME  = 'desired_plan_id'
  ) THEN
    ALTER TABLE leads
      ADD COLUMN desired_plan_id BIGINT UNSIGNED NULL
          COMMENT 'Service plan the prospect asked for at intake; prefills the service order (migration 445)',
      ADD KEY idx_leads_desired_plan_id (desired_plan_id),
      ADD CONSTRAINT fk_leads_desired_plan FOREIGN KEY (desired_plan_id)
          REFERENCES plans (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- ---- work_orders acceptance columns -------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'work_orders'
      AND COLUMN_NAME  = 'acceptance_signal_dbm'
  ) THEN
    ALTER TABLE work_orders
      ADD COLUMN acceptance_signal_dbm SMALLINT NULL
          COMMENT 'Wireless CPE signal (dBm) measured at install handoff (migration 445)',
      ADD COLUMN acceptance_link_mbps DECIMAL(8,2) NULL
          COMMENT 'Negotiated RF link rate (Mbps) measured at install handoff (migration 445)',
      ADD COLUMN acceptance_rx_dbm DECIMAL(6,2) NULL
          COMMENT 'FTTH optical Rx power (dBm) measured at install handoff (migration 445)',
      ADD COLUMN acceptance_waived TINYINT(1) NOT NULL DEFAULT 0
          COMMENT 'Explicit skip of acceptance readings on an installation WO; reason goes in acceptance_notes (migration 445)',
      ADD COLUMN acceptance_notes VARCHAR(500) NULL
          COMMENT 'Free-text context for the acceptance readings or the waive reason (migration 445)',
      ADD COLUMN acceptance_recorded_at DATETIME NULL
          COMMENT 'When acceptance readings (or the waive) were recorded (migration 445)';
  END IF;

  -- ---- tickets.source gains 'automation' ----------------------------------
  -- The billing follow-up ticket is neither 'manual' nor an 'alert'; a scheduled
  -- dispatcher created it. Append-only ENUM change (existing values keep their
  -- positions, so stored data is untouched).
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'tickets'
      AND COLUMN_NAME  = 'source'
      AND COLUMN_TYPE LIKE '%automation%'
  ) THEN
    ALTER TABLE tickets
      MODIFY COLUMN source ENUM('manual','alert','portal','ai_escalated','automation')
        NOT NULL DEFAULT 'manual'
        COMMENT 'How the ticket was created (migration 297; automation added by 445)';
  END IF;

  -- ---- service_orders.billing_followup_ticket_id --------------------------
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'service_orders'
      AND COLUMN_NAME  = 'billing_followup_ticket_id'
  ) THEN
    ALTER TABLE service_orders
      ADD COLUMN billing_followup_ticket_id BIGINT UNSIGNED NULL
          COMMENT 'Billing follow-up ticket auto-created N days after completion; NULL = not yet dispatched or disabled (migration 445)',
      ADD KEY idx_service_orders_billing_followup (billing_followup_ticket_id),
      ADD CONSTRAINT fk_service_orders_billing_followup_ticket
          FOREIGN KEY (billing_followup_ticket_id)
          REFERENCES tickets (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;

CALL migration_445_subscriber_flow();
DROP PROCEDURE IF EXISTS migration_445_subscriber_flow;

-- ---- seed the billing follow-up dispatcher (idempotent) ---------------------
-- Global task (organization_id NULL): one sweep serves every org; the per-org
-- delay/enable knob is the billing_followup_days org setting, resolved inside
-- the dispatcher per order.
INSERT INTO scheduled_tasks
  (organization_id, task_name, task_type, description, cron_expression, priority, is_enabled)
SELECT NULL, 'billing_followup_dispatcher', 'notification',
       'Create the post-install client check-in ticket for the billing team, billing_followup_days days after a service order completes',
       '15 * * * *', 'normal', TRUE
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_tasks WHERE task_name = 'billing_followup_dispatcher'
);
