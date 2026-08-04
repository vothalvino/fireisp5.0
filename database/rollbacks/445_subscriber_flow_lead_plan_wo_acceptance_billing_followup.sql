-- Rollback for migration 445 — subscriber-flow completion
-- Drops the lead plan column, the work-order acceptance columns, the service
-- order follow-up marker, and the dispatcher task seed.

DELETE FROM scheduled_tasks WHERE task_name = 'billing_followup_dispatcher';

-- Requires no ticket row to still carry source='automation' (re-point or
-- delete those tickets first).
ALTER TABLE tickets
  MODIFY COLUMN source ENUM('manual','alert','portal','ai_escalated')
    NOT NULL DEFAULT 'manual'
    COMMENT 'How the ticket was created (migration 297)';

ALTER TABLE service_orders
  DROP FOREIGN KEY fk_service_orders_billing_followup_ticket;
ALTER TABLE service_orders
  DROP COLUMN billing_followup_ticket_id;

ALTER TABLE work_orders
  DROP COLUMN acceptance_signal_dbm,
  DROP COLUMN acceptance_link_mbps,
  DROP COLUMN acceptance_rx_dbm,
  DROP COLUMN acceptance_waived,
  DROP COLUMN acceptance_notes,
  DROP COLUMN acceptance_recorded_at;

ALTER TABLE leads
  DROP FOREIGN KEY fk_leads_desired_plan;
ALTER TABLE leads
  DROP COLUMN desired_plan_id;
