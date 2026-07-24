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
-- Fix: make the uniqueness (and the app-layer dedup) per-tenant —
-- UNIQUE (organization_id, provider, provider_event_id). handleWebhookEvent now
-- sets organization_id at INSERT for gateway-scoped events and dedups scoped to
-- it. Env-var (global) route events keep organization_id NULL and dedup among
-- the NULL-org rows at the application layer (MySQL treats NULLs as distinct in
-- a unique key, so the constraint is a no-op for them — acceptable: the global
-- route is the single-tenant/legacy path and concurrent identical deliveries
-- there are rare; the app-layer SELECT still catches sequential retries).
--
-- Safe: the old key guaranteed (provider, provider_event_id) globally unique, so
-- no two existing rows can collide once organization_id is prepended. Guarded via
-- INFORMATION_SCHEMA (idempotent).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_417_webhook_events_per_org_dedup;
DELIMITER //
CREATE PROCEDURE migration_417_webhook_events_per_org_dedup()
BEGIN
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
      AND INDEX_NAME   = 'uq_webhook_events_org_provider_event'
  ) THEN
    ALTER TABLE webhook_events
      ADD UNIQUE KEY uq_webhook_events_org_provider_event (organization_id, provider, provider_event_id);
  END IF;
END //
DELIMITER ;
CALL migration_417_webhook_events_per_org_dedup();
DROP PROCEDURE IF EXISTS migration_417_webhook_events_per_org_dedup;
