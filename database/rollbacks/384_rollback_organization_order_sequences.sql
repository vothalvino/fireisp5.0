-- =============================================================================
-- Rollback 384 — Atomic per-organization service-order-number sequence
-- =============================================================================
-- Drops organization_order_sequences. Safe: nothing else references this
-- table via foreign key, and the application code path that reads/writes it
-- (lifecycleService.nextOrderNumber) only runs on the current codebase — a
-- rollback of this migration must be paired with reverting the application
-- code that calls it (lifecycleService.js / routes/serviceOrders.js), or
-- service-order-number generation will throw on the missing table. Dropping
-- the table does NOT touch any existing service_orders.order_number values
-- already issued.
-- =============================================================================

DROP TABLE IF EXISTS organization_order_sequences;
