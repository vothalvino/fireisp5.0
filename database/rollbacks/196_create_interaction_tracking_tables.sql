-- =============================================================================
-- FireISP 5.0 — Rollback 196: Drop Interaction Tracking tables
-- =============================================================================
-- Reverses migration 196. Drop order respects FK dependencies:
--   follow_up_reminders and satisfaction_surveys reference client_interactions,
--   so they are dropped first; ticket_escalations is independent.
-- =============================================================================

DELETE FROM scheduled_tasks
WHERE task_name IN ('follow_up_reminders', 'dispatch_satisfaction_surveys', 'auto_escalate_tickets');

DROP TABLE IF EXISTS follow_up_reminders;
DROP TABLE IF EXISTS satisfaction_surveys;
DROP TABLE IF EXISTS ticket_escalations;
DROP TABLE IF EXISTS client_interactions;
