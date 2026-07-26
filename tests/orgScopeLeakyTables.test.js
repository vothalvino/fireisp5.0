'use strict';
// =============================================================================
// FireISP 5.0 — the tables BaseModel used to leave unscoped
// =============================================================================
// src/models/BaseModel.js reads:
//
//     if (orgId !== null && this.hasOrgScope) { conditions.push('organization_id = ?') }
//
// so a model declaring `hasOrgScope = false` gets its org filter SILENTLY
// OMITTED rather than raising. No error, no log, no failing test — the defect is
// invisible by construction, which is why it survived. The same absent predicate
// flows into update/delete/restore, making it cross-tenant WRITE as well as read.
//
// device_config_backups and recurring_payment_profiles were both mounted behind
// a generic crudController over exactly such a model. The first holds full
// RouterOS exports (PPPoE/RADIUS secrets, SNMP communities, WireGuard keys); the
// second holds gateway tokens and Stripe customer ids.
//
// Migration 425 gave both an organization_id and the models now scope. These
// assertions pin the three things that have to stay true together — flip any one
// back and the hole reopens or the writes start landing unattributed.
// =============================================================================

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const DeviceConfigBackup = require('../src/models/DeviceConfigBackup');
const RecurringPaymentProfile = require('../src/models/RecurringPaymentProfile');

const SCOPED = [
  ['DeviceConfigBackup', DeviceConfigBackup, 'device_config_backups'],
  ['RecurringPaymentProfile', RecurringPaymentProfile, 'recurring_payment_profiles'],
];

describe('the formerly-unscoped models now scope by organization', () => {
  it.each(SCOPED)('%s.hasOrgScope is true', (_name, Model) => {
    expect(Model.hasOrgScope).toBe(true);
  });

  it.each(SCOPED)('%s lists organization_id in fillable', (_name, Model) => {
    // THE TRAP: crudController injects req.orgId into the body only when
    // hasOrgScope is true (crudController.js:123-125), and BaseModel.create
    // filters strictly to `fillable`. Turning scoping on WITHOUT this line makes
    // every POST silently drop the org — writing a NULL-org row that is
    // invisible to its own creator's list and 404s on update. The fix would
    // have caused a new instance of the bug class it closes.
    expect(Model.fillable).toContain('organization_id');
  });

  it.each(SCOPED)('%s table has a NOT NULL organization_id in schema.sql', (_name, _Model, table) => {
    const schema = read('database/schema.sql');
    const block = schema.slice(schema.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`));
    const ddl = block.slice(0, block.indexOf('ENGINE='));
    expect(ddl).toMatch(/organization_id\s+BIGINT UNSIGNED\s+NOT NULL/);
    // Nullable would recreate the same silent class: a row no tenant can see.
    expect(ddl).not.toMatch(/organization_id\s+BIGINT UNSIGNED\s+NULL/);
  });
});

describe('BaseModel still omits the predicate silently — the reason this is easy to get wrong', () => {
  it('adds the org condition only when hasOrgScope is set', () => {
    // Pinning the trap itself. If this ever becomes a throw instead, the whole
    // class becomes loud and these per-model guards matter far less.
    const src = read('src/models/BaseModel.js');
    expect(src).toMatch(/if\s*\(orgId !== null && this\.hasOrgScope\)/);
  });
});

describe('raw SQL that BaseModel scoping cannot reach', () => {
  it('the config-backup diff route filters by organization', () => {
    // GET /device-config-backups/diff/:id is a hand-written query, so the model
    // flag does nothing for it. Without an explicit predicate any tenant could
    // read any other tenant's config diff by guessing an id.
    const src = read('src/routes/deviceConfigBackups.js');
    const diff = src.slice(src.indexOf("router.get('/diff/:id'"));
    const handler = diff.slice(0, diff.indexOf('});'));
    expect(handler).toMatch(/FROM device_config_backups/);
    expect(handler).toMatch(/organization_id = \?/);
    expect(handler).toMatch(/req\.orgId/);
  });

  it('the nightly config pull writes an organization_id', () => {
    // configBackupService runs unattended with no request context, so it derives
    // the org from the device in the statement itself. Miss this and every
    // nightly backup fails the NOT NULL — or worse, if the column were nullable,
    // silently refills the table with rows no tenant can see.
    const src = read('src/services/configBackupService.js');
    const ins = src.slice(src.indexOf('INSERT INTO device_config_backups'));
    const stmt = ins.slice(0, ins.indexOf('`,'));
    expect(stmt).toMatch(/organization_id/);
    expect(stmt).toMatch(/SELECT organization_id FROM devices WHERE id = \?/);
  });

  it('autopay enrollment writes an organization_id taken from the gateway', () => {
    const src = read('src/services/autopayService.js');
    const ins = src.slice(src.indexOf('INSERT INTO recurring_payment_profiles'));
    const stmt = ins.slice(0, ins.indexOf('`,'));
    expect(stmt).toMatch(/organization_id/);
    expect(src).toMatch(/\[gateway\.organization_id, clientId, gateway\.id/);
  });
});

describe('migration 425 backfills before it constrains', () => {
  const mig = read('database/migrations/425_org_scope_config_backups_and_autopay_profiles.sql');

  it('adds the column nullable, backfills from the parent, then tightens', () => {
    // Adding it NOT NULL outright would fail on any table with existing rows.
    // Anchor on the SECTION MARKERS, not on bare table names: those appear in
    // the header comment and in the shared stale-index guard, so an indexOf on
    // the name lands somewhere arbitrary and silently truncates the slice —
    // which is exactly how this assertion first went vacuous.
    const start = mig.indexOf('-- ── device_config_backups →');
    const end = mig.indexOf('-- ── recurring_payment_profiles →');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const dcb = mig.slice(start, end);
    expect(dcb.length).toBeGreaterThan(300);
    expect(dcb).toMatch(/ADD COLUMN organization_id BIGINT UNSIGNED NULL/);
    expect(dcb).toMatch(/JOIN devices d ON d\.id = b\.device_id/);
    expect(dcb.indexOf('UPDATE device_config_backups'))
      .toBeLessThan(dcb.indexOf('MODIFY COLUMN organization_id BIGINT UNSIGNED NOT NULL'));
  });

  it('backfills autopay profiles from their client', () => {
    expect(mig).toMatch(/JOIN clients c ON c\.id = p\.client_id/);
  });

  it('is guarded so it can be re-run', () => {
    expect(mig).toMatch(/INFORMATION_SCHEMA\.COLUMNS/);
    expect(mig).toMatch(/DROP PROCEDURE IF EXISTS/);
  });

  it('ships a rollback', () => {
    const rb = read('database/rollbacks/425_org_scope_config_backups_and_autopay_profiles.sql');
    expect(rb).toMatch(/DROP FOREIGN KEY fk_dcb_org/);
    expect(rb).toMatch(/DROP FOREIGN KEY fk_rpp_org/);
  });

  it('the rollback drops the indexes EXPLICITLY, not as a side effect', () => {
    // Dropping a column does NOT drop a multi-column index containing it —
    // MySQL removes the column from the index and keeps the remainder. So
    // dropping only organization_id left an idx_dcb_org over
    // (device_id, created_at), and re-migrating died with ER_DUP_KEYNAME.
    // Caught by the CI rollback round-trip against real MySQL, which no unit
    // test here can reproduce; this assertion is the cheap standing guard.
    const rb = read('database/rollbacks/425_org_scope_config_backups_and_autopay_profiles.sql');
    expect(rb).toMatch(/DROP INDEX idx_dcb_org/);
    expect(rb).toMatch(/DROP INDEX idx_rpp_org/);
    expect(rb).toMatch(/INFORMATION_SCHEMA\.STATISTICS/);
  });

  it('the forward migration survives a leftover index from an older rollback', () => {
    // Operators who already ran the previous rollback have the stale index on
    // disk; without this the upgrade fails for exactly them.
    expect(mig).toMatch(/INFORMATION_SCHEMA\.STATISTICS/);
    const body = mig.slice(mig.indexOf('CREATE PROCEDURE'));
    expect(body.indexOf('DROP INDEX idx_dcb_org'))
      .toBeLessThan(body.indexOf('ADD KEY idx_dcb_org'));
  });
});
