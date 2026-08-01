'use strict';
// =============================================================================
// FireISP 5.0 — a model that scopes by org must be able to WRITE the org
// =============================================================================
// The trap, and it is silent in both directions:
//
//   crudController.create does `req.body.organization_id = req.orgId` when
//   Model.hasOrgScope is true. BaseModel.create then filters strictly to
//   `fillable` — so if organization_id is not listed there, the injected value
//   is DROPPED and the INSERT omits the column entirely.
//
// Nothing errors. The row is born NULL-org, which for these tables means
// "unattributed": visible to every tenant. Flipping hasOrgScope to true to
// close a cross-tenant leak, without also adding the column to fillable,
// therefore closes the leak for existing rows and reopens it for every new
// one — while every test that only asserts `expect(res.status).toBe(201)`
// keeps passing.
//
// This shipped in #600 for speed_tests and was caught on a live install, not
// by the suite. This test makes the whole class impossible rather than fixing
// the one instance.
// =============================================================================

const fs = require('node:fs');
const path = require('node:path');

const MODELS_DIR = path.join(__dirname, '../src/models');

// Models whose rows are created ONLY by a hand-written INSERT that names
// organization_id itself, so BaseModel.create is never the creation path.
// Adding to this list is a claim you must verify by reading the route — an
// entry that is wrong reintroduces exactly the bug above.
const RAW_INSERT_CREATORS = {
  CsdCertificate:
    'src/routes/csdCertificates.js mounts a custom POST / with a raw '
    + 'INSERT INTO csd_certificates (organization_id, ...); ctrl.create is never mounted.',
};

function loadModels() {
  return fs.readdirSync(MODELS_DIR)
    .filter(f => f.endsWith('.js') && f !== 'BaseModel.js')
    .map((f) => {
      let Model;
      try { Model = require(path.join(MODELS_DIR, f)); } catch { return null; }
      if (typeof Model !== 'function') return null;
      let hasOrgScope, fillable, tableName;
      try {
        hasOrgScope = Model.hasOrgScope;
        fillable = Model.fillable;
        tableName = Model.tableName;
      } catch { return null; }
      return { name: f.replace(/\.js$/, ''), hasOrgScope, fillable, tableName };
    })
    .filter(Boolean);
}

describe('org-scoped models can write their own organization_id', () => {
  const scoped = loadModels().filter(m => m.hasOrgScope === true && Array.isArray(m.fillable));

  it('finds a meaningful number of org-scoped models to check', () => {
    // Guards the guard: if the loader silently stopped resolving models this
    // suite would pass by checking nothing.
    expect(scoped.length).toBeGreaterThan(100);
  });

  it.each(scoped.map(m => [m.name, m]))(
    '%s lists organization_id in fillable',
    (name, model) => {
      if (RAW_INSERT_CREATORS[name]) {
        // Documented exception — assert the reason is recorded, not absent.
        expect(RAW_INSERT_CREATORS[name].length).toBeGreaterThan(20);
        return;
      }
      expect({
        model: name,
        table: model.tableName,
        fillableHasOrg: model.fillable.includes('organization_id'),
      }).toEqual({
        model: name,
        table: model.tableName,
        fillableHasOrg: true,
      });
    },
  );
});
