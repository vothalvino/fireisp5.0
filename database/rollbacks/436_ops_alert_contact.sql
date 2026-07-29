-- Rollback 436 — remove the infrastructure-alert contact setting.
--
-- Infra alerts then fall back to the per-organization admin/manager fan-out,
-- which is the pre-436 behaviour. No alerts are lost by rolling back; they just
-- become noisier again on a multi-tenant install.
DELETE FROM settings WHERE setting_key = 'ops_alert_email';

DROP TABLE IF EXISTS ops_alert_deliveries;
