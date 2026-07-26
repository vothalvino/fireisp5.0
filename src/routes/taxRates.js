// =============================================================================
// FireISP 5.0 — Tax Rate Routes
// =============================================================================

const { Router } = require('express');
const TaxRate = require('../models/TaxRate');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createTaxRate, updateTaxRate } = require('../middleware/schemas/taxRates');
const db = require('../config/database');

const router = Router();

/**
 * At most one ACTIVE default rate may exist per org scope.
 *
 * Migration 427 enforces that with a unique index over a generated column, so a
 * race can only ever produce ER_DUP_ENTRY rather than two defaults. But the
 * index alone would make the ordinary act of changing the default FAIL — the
 * operator would have to un-default the old rate first, and would otherwise see
 * a duplicate-key error with no explanation. This demotes the incumbent so
 * "make this one the default" does what it says.
 *
 * Scoped with `IFNULL(organization_id, 0)` to match the guard exactly:
 * tax_rates.organization_id is 'NULL = applies to all tenants', and a plain
 * `organization_id = ?` would never match those global rows.
 *
 * `excludeId` keeps a PUT that merely re-saves the current default from
 * demoting itself.
 */
async function demoteExistingDefault(orgId, excludeId = null) {
  const params = [orgId ?? 0];
  let sql = `UPDATE tax_rates
                SET is_default = 0
              WHERE is_default = 1
                AND status = 'active'
                AND deleted_at IS NULL
                AND IFNULL(organization_id, 0) = ?`;
  if (excludeId) { sql += ' AND id <> ?'; params.push(excludeId); }
  await db.query(sql, params);
}

const isTruthy = (v) => v === true || v === 1 || v === '1' || v === 'true';

const ctrl = crudController(TaxRate, {
  beforeCreate: async (req) => {
    if (isTruthy(req.body.is_default)) await demoteExistingDefault(req.orgId);
  },
  // `old` is the existing row; the incoming body may omit is_default entirely on
  // a PATCH, in which case the row keeps whatever it had and nothing needs
  // demoting.
  beforeUpdate: async (old, req) => {
    if (req.body.is_default === undefined) return;
    if (isTruthy(req.body.is_default)) await demoteExistingDefault(req.orgId, old.id);
  },
});

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('tax_rates.view'), ctrl.list);
router.get('/:id', requirePermission('tax_rates.view'), ctrl.get);
router.post('/', requirePermission('tax_rates.create'), validate(createTaxRate), ctrl.create);
router.put('/:id', requirePermission('tax_rates.update'), validate(updateTaxRate), ctrl.update);
router.delete('/:id', requirePermission('tax_rates.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('tax_rates.update'), ctrl.restore);

module.exports = router;
