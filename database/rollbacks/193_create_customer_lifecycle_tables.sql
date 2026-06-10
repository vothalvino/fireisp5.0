-- =============================================================================
-- FireISP 5.0 — Rollback 193: Drop Customer Lifecycle tables
-- =============================================================================
-- Reverses migration 193. Drop order respects FK dependencies:
--   service_order_tasks → service_orders → leads, and winback_campaigns last.
-- =============================================================================

DROP TABLE IF EXISTS service_order_tasks;
DROP TABLE IF EXISTS service_orders;
DROP TABLE IF EXISTS winback_campaigns;
DROP TABLE IF EXISTS leads;
