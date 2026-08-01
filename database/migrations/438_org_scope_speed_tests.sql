-- =============================================================================
-- Migration 438 — give speed_tests an organization_id, and let POST work
-- =============================================================================
-- Continues the BaseModel org-scoping sweep (425 device_config_backups +
-- recurring_payment_profiles, 426 radius, 429 sla_definitions, 435
-- scheduled_tasks, 437 outages).
--
-- PART 1 — ORG SCOPING
--
-- src/models/SpeedTest.js declared hasOrgScope = false, and BaseModel omits the
-- org predicate SILENTLY when it does, so every verb behind the generic
-- crudController ran unscoped. GET /speed-tests returned every measurement on
-- the install to every tenant — client_id, contract_id, the observed public
-- ip_address, technician notes and throughput history — and PUT/DELETE let any
-- tenant rewrite or destroy another tenant's records. Those records are SLA
-- evidence, so a competitor tenant could quietly edit the numbers that prove
-- whether a service met its contracted rate.
--
-- BACKFILL — client, then contract, then device.
--   All three are nullable and any combination may be set. Client wins because
--   a speed test is a statement about that subscriber's service; the contract
--   narrows it to which service, and the device is only the instrument that
--   measured it. COALESCE means a row with just one of the three still
--   resolves, and a row whose client has a NULL org falls through to the
--   contract rather than being demoted to unattributed.
--
-- ROWS WITH NONE of the three stay NULL — probe-only measurements with nothing
-- to derive an owner from. They are LEGACY ONLY: from this migration on every
-- row is stamped at creation, so the unattributed set is closed and can only
-- shrink. Reads admit them (`org = ? OR org IS NULL`) so a single-tenant
-- install still sees its data, and the first tenant that writes to one adopts
-- it.
--
-- NULLABLE, like every other org column here: clients.organization_id,
-- contracts.organization_id and devices.organization_id are themselves
-- 'NULL = single-tenant deployment', so a single-tenant install legitimately
-- backfills to NULL. A NOT NULL column could only be reconciled by DELETING
-- those rows.
--
-- PART 2 — tested_at HAD NO DEFAULT
--
-- tested_at is TIMESTAMP NOT NULL with no DEFAULT, and MySQL 8 ships
-- explicit_defaults_for_timestamp = ON, so it gets no implicit
-- CURRENT_TIMESTAMP either. The create validation schema never declared the
-- field, so POST /speed-tests with the body the API documents produced a hard
-- 500 (ER_NO_DEFAULT_FOR_FIELD) — the endpoint could not be used at all. The
-- default belongs on the column rather than only in the route, so every writer
-- gets it; callers importing historical measurements still pass an explicit
-- tested_at, which now validates instead of being silently ignored.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_438_org_scope_speed_tests;
DELIMITER //
CREATE PROCEDURE migration_438_org_scope_speed_tests()
BEGIN
  -- A leftover index from a previous rollback would make ADD KEY fail with
  -- ER_DUP_KEYNAME: dropping a column does not drop a multi-column index
  -- containing it. Migration 425 learned this from a red CI rollback.
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'speed_tests'
      AND INDEX_NAME   = 'idx_speed_tests_org'
  ) THEN
    ALTER TABLE speed_tests DROP INDEX idx_speed_tests_org;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'speed_tests'
      AND COLUMN_NAME  = 'organization_id'
  ) THEN
    ALTER TABLE speed_tests
      ADD COLUMN organization_id BIGINT UNSIGNED NULL
          COMMENT 'Owning org, denormalised from client/contract/device; NULL = unattributed legacy row, adoptable on write (migration 438)'
          AFTER id;

    -- Client first, then contract, then device. LEFT JOINs so a row with only
    -- one of the three still resolves; COALESCE so a parent with a NULL org
    -- falls through to the next instead of demoting an attributable row.
    UPDATE speed_tests st
      LEFT JOIN clients   c  ON c.id  = st.client_id
      LEFT JOIN contracts ct ON ct.id = st.contract_id
      LEFT JOIN devices   d  ON d.id  = st.device_id
       SET st.organization_id = COALESCE(c.organization_id, ct.organization_id, d.organization_id);

    -- (organization_id, tested_at) — the hot read is "my org's measurements,
    -- newest first", which filters and sorts on exactly this pair.
    ALTER TABLE speed_tests
      ADD KEY idx_speed_tests_org (organization_id, tested_at),
      ADD CONSTRAINT fk_speed_tests_org FOREIGN KEY (organization_id)
          REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- Separate guard: the default is a distinct defect from the missing column,
  -- so an install that somehow has one but not the other still converges.
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA    = DATABASE()
      AND TABLE_NAME      = 'speed_tests'
      AND COLUMN_NAME     = 'tested_at'
      AND COLUMN_DEFAULT IS NULL
  ) THEN
    ALTER TABLE speed_tests
      MODIFY COLUMN tested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      COMMENT 'When the test measurement was taken; defaults to insert time for live-recorded tests';
  END IF;
END //
DELIMITER ;

CALL migration_438_org_scope_speed_tests();
DROP PROCEDURE IF EXISTS migration_438_org_scope_speed_tests;
