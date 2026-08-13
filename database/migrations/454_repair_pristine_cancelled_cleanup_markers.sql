-- =============================================================================
-- Migration 454 — release false cleanup markers on pristine cancellations
-- =============================================================================
-- The post-450 cancellation path deliberately marked every pending PPPoE line
-- before attempting external shutdown.  A never-opened installation has
-- nothing external to shut down, but the no-session result cannot be proven by
-- an unbounded (NULL-expiry) window and therefore left a retry marker behind.
--
-- Repair only that deterministic post-450 shape.  Older unbounded pending
-- access remains fail-closed, and any ambiguous RADIUS history, NAS,
-- FreeRADIUS, or accounting evidence keeps its marker for the normal sweep.

UPDATE contracts c
JOIN schema_migrations migration_450
  ON migration_450.filename = '450_commissioning_evidence_and_test_cleanup.sql'
 AND c.created_at >= migration_450.applied_at
   SET c.test_window_cleanup_pending = 0,
       c.test_window_cleanup_attempted_at = NULL
 WHERE c.status = 'cancelled'
   AND c.connection_type IN ('pppoe', 'pppoe_dual')
   AND c.first_activated_at IS NULL
   AND c.test_window_expires_at IS NULL
   AND c.test_window_cleanup_pending = 1
   AND c.test_window_cleanup_attempted_at IS NOT NULL
   AND EXISTS (
     SELECT 1
       FROM service_orders so
      WHERE so.contract_id = c.id
        AND so.order_type = 'new_install'
        AND so.status = 'cancelled'
   )
   -- A post-450 auto-provisioned PPPoE installation has exactly one live,
   -- inactive RADIUS identity even before commissioning.  Missing, duplicate,
   -- or archived account history is ambiguous and therefore remains blocked.
   AND 1 = (
     SELECT COUNT(*)
       FROM radius live_radius
      WHERE live_radius.contract_id = c.id
        AND live_radius.deleted_at IS NULL
   )
   AND NOT EXISTS (
     SELECT 1
       FROM radius archived_radius
      WHERE archived_radius.contract_id = c.id
        AND archived_radius.deleted_at IS NOT NULL
   )
   AND NOT EXISTS (
     SELECT 1
       FROM radius r
      WHERE r.contract_id = c.id
        AND r.deleted_at IS NULL
        AND (
             COALESCE(r.status, '') <> 'inactive'
          OR r.nas_id IS NOT NULL
          OR NULLIF(TRIM(r.username), '') IS NULL
          OR EXISTS (SELECT 1 FROM radcheck rc WHERE rc.username = r.username)
          OR EXISTS (SELECT 1 FROM radreply rr WHERE rr.username = r.username)
          OR EXISTS (SELECT 1 FROM radusergroup rug WHERE rug.username = r.username)
        )
   )
   AND NOT EXISTS (
     SELECT 1
       FROM connection_logs cl
      WHERE cl.contract_id = c.id
        AND cl.event_type IN ('start', 'interim-update')
        AND (
          cl.session_id IS NULL
          OR NOT EXISTS (
            SELECT 1
              FROM connection_logs stopped
             WHERE stopped.contract_id = cl.contract_id
               AND stopped.username = cl.username
               AND stopped.session_id = cl.session_id
               AND stopped.event_type = 'stop'
               AND stopped.event_at >= cl.event_at
          )
        )
   );
