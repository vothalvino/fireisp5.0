'use strict';
// =============================================================================
// FireISP 5.0 — no settings key may render without a reader (j20)
// =============================================================================
// settings.default_tax_rate sat in the seed with ZERO readers while still
// rendering as an editable field on the org Settings tab — Organization
// .getSettings returns key → value and DROPS the description, so an operator
// saw a `default_tax_rate` box, set it to 16, saved successfully, and nothing
// happened. The rate that actually applies comes from tax_rates / tax_rules via
// resolveTaxContext.
//
// The sharper risk was the other direction: "fixing" the dead setting by wiring
// it up would default MX orgs to 0% IVA, because the seeded value was 0.00.
// Migration 431 deletes it, following the precedent migration 405 set for
// default_currency.
//
// This test guards the SEED, not the live DB: it asserts the key is not
// re-introduced by a future seed edit.
// =============================================================================

const fs = require('fs');
const path = require('path');

const repo = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(repo, p), 'utf8');

// A key removed by a later migration must not still be seeded by schema.sql,
// which is the full-schema mirror new installs load.
const REMOVED_KEYS = [
  { key: 'default_tax_rate', migration: '431', reason: 'no readers; rate comes from tax_rates/tax_rules' },
  { key: 'default_currency', migration: '405', reason: 'currency lives on organizations.currency' },
];

describe('settings keys removed by a migration stay removed from the schema mirror', () => {
  const schema = read('database/schema.sql');

  it.each(REMOVED_KEYS)('$key (migration $migration) is not seeded in schema.sql', ({ key }) => {
    // Match the seed-row shape specifically, so a comment mentioning the key
    // does not fail the test.
    expect(schema).not.toMatch(new RegExp(`\\(\\s*'${key}'\\s*,`));
  });

  it('migration 431 exists and deletes the key', () => {
    const mig = read('database/migrations/431_remove_dead_default_tax_rate_setting.sql');
    expect(mig).toMatch(/DELETE FROM settings WHERE setting_key = 'default_tax_rate'/);
  });

  it('has a rollback that restores it', () => {
    const rb = read('database/rollbacks/431_remove_dead_default_tax_rate_setting.sql');
    expect(rb).toMatch(/INSERT IGNORE INTO settings/);
    expect(rb).toMatch(/default_tax_rate/);
  });
});

describe('the removed key really has no readers', () => {
  it('nothing in src/ or frontend/src reads default_tax_rate', () => {
    // If someone wires this up later, this test tells them the value they are
    // wiring is a 0.00 that would zero-rate MX orgs.
    const hits = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(path.join(repo, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) { walk(rel); continue; }
        if (!/\.(js|ts|tsx)$/.test(entry.name)) continue;
        if (read(rel).includes('default_tax_rate')) hits.push(rel);
      }
    };
    walk('src');
    walk('frontend/src');
    expect(hits).toEqual([]);
  });
});
