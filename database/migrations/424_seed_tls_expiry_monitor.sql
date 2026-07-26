-- =============================================================================
-- Migration 424 — seed the tls_expiry_monitor scheduled task
-- =============================================================================
-- The product watched two kinds of certificate and neither was the server's own
-- TLS certificate:
--   * check_certificate_expiry -> subscriber_certificates (EAP-TLS for RADIUS)
--   * csd_expiry_monitor       -> csd_certificates        (SAT fiscal signing)
--
-- Meanwhile the renewal loop ran `certbot renew --quiet` under
-- `restart: unless-stopped`, so a failing renewal printed nothing, restarted
-- forever, and raised no alert. The first symptom of a broken renewal would
-- have been the customer portal serving an expired certificate ~60-90 days
-- later. PR #538 removed the --quiet; this seeds the detection half.
--
-- Global task (organization_id NULL): one certificate serves the whole install.
-- Daily at 07:00 — after the 12-hourly certbot loop has had its overnight run,
-- so an alert means renewal genuinely did not happen rather than has not been
-- attempted yet.
--
-- Idempotent: re-running is a no-op. The task name MUST have a matching case in
-- src/services/taskRunner.js — a seeded task with no case never runs, silently.
-- That case is added in the same change as this migration.
-- =============================================================================

INSERT INTO scheduled_tasks
  (organization_id, task_name, task_type, description, cron_expression, priority, is_enabled)
SELECT NULL, 'tls_expiry_monitor', 'notification',
       'Check the server TLS certificate expiry and alert admins at 30/14/7 days',
       '0 7 * * *', 'high', TRUE
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'tls_expiry_monitor' AND organization_id IS NULL
);
