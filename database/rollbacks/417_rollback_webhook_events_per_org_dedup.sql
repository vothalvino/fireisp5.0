-- Rollback 417 — restore the global webhook_events unique key.
-- Guarded/idempotent. NOTE: this only succeeds if (provider, provider_event_id)
-- is still globally unique across all rows (it is, unless a shared-account
-- multi-tenant install recorded the same event id under two orgs after 417).

DROP PROCEDURE IF EXISTS rollback_417_webhook_events_per_org_dedup;
DELIMITER //
CREATE PROCEDURE rollback_417_webhook_events_per_org_dedup()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'webhook_events'
      AND INDEX_NAME   = 'uq_webhook_events_org_provider_event'
  ) THEN
    ALTER TABLE webhook_events DROP INDEX uq_webhook_events_org_provider_event;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'webhook_events'
      AND INDEX_NAME   = 'uq_webhook_events_provider_event'
  ) THEN
    ALTER TABLE webhook_events
      ADD UNIQUE KEY uq_webhook_events_provider_event (provider, provider_event_id);
  END IF;
END //
DELIMITER ;
CALL rollback_417_webhook_events_per_org_dedup();
DROP PROCEDURE IF EXISTS rollback_417_webhook_events_per_org_dedup;
