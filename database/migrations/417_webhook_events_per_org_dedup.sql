-- =============================================================================
-- Migration 417 — per-org webhook_events deduplication
-- =============================================================================
-- The webhook_events dedup key was GLOBAL: UNIQUE (provider, provider_event_id).
-- With the multi-tenant gateway-scoped receivers (PR #510,
-- POST /payment-webhooks/:provider/:gatewayId), two DIFFERENT orgs whose
-- gateways point at the SAME provider account receive the same provider_event_id
-- on their respective endpoints. The global key made whichever landed first
-- claim the slot; the owning org's delivery then hit the unique and was
-- suppressed/errored, so its payment could fail to reconcile.
--
-- Fix: dedup per-tenant. We CANNOT simply key on (organization_id, provider,
-- provider_event_id) because organization_id is NULL for the global env-var
-- route (no gateway/org context at insert time) and MySQL treats NULLs as
-- DISTINCT in a UNIQUE key — that would silently drop the DB-level backstop for
-- the global route (concurrent duplicates could both insert). Instead we add a
-- VIRTUAL generated column `org_dedup = COALESCE(organization_id, 0)` and key the
-- UNIQUE on it: gateway events partition by their org; global (NULL-org) events
-- all fall into partition 0, preserving a real concurrent-duplicate backstop for
-- that route too. org_dedup is derived (not a FK), so the 0 sentinel is safe.
--
-- Safe: the old key kept (provider, provider_event_id) globally unique, so no
-- existing rows collide once partitioned by org_dedup. Guarded via
-- INFORMATION_SCHEMA (idempotent).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_417_webhook_events_per_org_dedup;
DELIMITER //
CREATE PROCEDURE migration_417_webhook_events_per_org_dedup()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'webhook_events'
      AND COLUMN_NAME  = 'org_dedup'
  ) THEN
    ALTER TABLE webhook_events
      ADD COLUMN org_dedup BIGINT UNSIGNED
        AS (COALESCE(organization_id, 0)) VIRTUAL
        COMMENT 'Dedup partition: organization_id, or 0 for the global env-var route. VIRTUAL because organization_id has an FK with ON DELETE SET NULL / ON UPDATE CASCADE, which MySQL forbids on a STORED generated column base — migration 417'
        AFTER organization_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'webhook_events'
      AND INDEX_NAME   = 'uq_webhook_events_provider_event'
  ) THEN
    ALTER TABLE webhook_events DROP INDEX uq_webhook_events_provider_event;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'webhook_events'
      AND INDEX_NAME   = 'uq_webhook_events_orgdedup_provider_event'
  ) THEN
    ALTER TABLE webhook_events
      ADD UNIQUE KEY uq_webhook_events_orgdedup_provider_event (org_dedup, provider, provider_event_id);
  END IF;
END //
DELIMITER ;
CALL migration_417_webhook_events_per_org_dedup();
DROP PROCEDURE IF EXISTS migration_417_webhook_events_per_org_dedup;
