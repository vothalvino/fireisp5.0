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

// ---------------------------------------------------------------------------
// Shared (NULL-org) rates — j42
// ---------------------------------------------------------------------------
// Migration 121 seeds four rates with organization_id NULL, 'applies to all
// tenants'. The two halves of the product disagreed about whether they exist:
// the resolver's explicit-id branch admits them (organization_id IS NULL, kept
// deliberately in #548), while this router's org-scoped CRUD emitted
// `WHERE organization_id = ?`, which a NULL row can never match. So a rate the
// resolver would happily apply was invisible: the operator could not see,
// deactivate, or even discover WHY a rate id resolved.
//
// The fix makes the READ half agree with the resolver: list and get admit
// NULL-org rows, marked `is_shared`, and the write routes refuse them with an
// explicit 403 instead of the misleading 404 the org predicate used to
// produce. Writes stay refused because a shared row nobody owns must not be
// editable by any one tenant — deactivating it for yourself would deactivate
// it for everybody.
//
// req.orgId is always set here: orgScope (mounted above) rejects a caller with
// no organization outright, so there is no null-org case on this router and no
// branch is written for one.

/** True when the target row is a shared (NULL-org) rate. */
async function isSharedRate(id) {
  const [rows] = await db.query(
    'SELECT organization_id FROM tax_rates WHERE id = ? LIMIT 1',
    [id],
  );
  return rows.length > 0 && rows[0].organization_id === null;
}

function blockSharedRateWrites(req, res, next) {
  isSharedRate(req.params.id)
    .then((shared) => {
      if (!shared) return next();
      res.status(403).json({
        error: {
          code: 'SHARED_TAX_RATE_READONLY',
          message: 'This is a shared rate available to every organization on this install — it cannot be edited or deleted from one organization. Create your own rate instead.',
        },
      });
    })
    .catch(next);
}

router.get('/', requirePermission('tax_rates.view'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    // The org's own rows plus the install-wide shared ones.
    const conditions = ['deleted_at IS NULL', '(organization_id = ? OR organization_id IS NULL)'];
    const params = [req.orgId];
    if (req.query.status) { conditions.push('status = ?'); params.push(req.query.status); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const [rows] = await db.query(
      `SELECT tax_rates.*, (organization_id IS NULL) AS is_shared FROM tax_rates ${where}
        ORDER BY is_shared ASC, id ASC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM tax_rates ${where}`,
      params,
    );
    res.json({ data: rows, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('tax_rates.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT tax_rates.*, (organization_id IS NULL) AS is_shared
         FROM tax_rates
        WHERE id = ? AND deleted_at IS NULL
          AND (organization_id = ? OR organization_id IS NULL) LIMIT 1`,
      [req.params.id, req.orgId],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tax rate not found' } });
    }
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.post('/', requirePermission('tax_rates.create'), validate(createTaxRate), ctrl.create);
router.put('/:id', requirePermission('tax_rates.update'), blockSharedRateWrites, validate(updateTaxRate), ctrl.update);
router.delete('/:id', requirePermission('tax_rates.delete'), blockSharedRateWrites, ctrl.destroy);
router.post('/:id/restore', requirePermission('tax_rates.update'), blockSharedRateWrites, ctrl.restore);

module.exports = router;
