// =============================================================================
// FireISP 5.0 — Speed Test Routes
// =============================================================================

const { Router } = require('express');
const SpeedTest = require('../models/SpeedTest');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createSpeedTest, updateSpeedTest } = require('../middleware/schemas/speedTests');
const db = require('../config/database');
const { visibleToOrg, rejectOrgReassignment, adoptUnattributed } = require('../utils/orgAdoption');
const { ValidationError } = require('../utils/errors');

const router = Router();
const ctrl = crudController(SpeedTest);

router.use(authenticate);
router.use(orgScope);

// Theirs, or an unattributed legacy row. See src/utils/orgAdoption.js for why
// BaseModel cannot express this and why hiding the NULL-org rows would be
// worse than the leak it replaces.
const VISIBLE = visibleToOrg('st');

router.get('/', requirePermission('speed_tests.view'), async (req, res, next) => {
  try {
    const {
      client_id, contract_id, device_id, test_source, page = 1, limit = 50,
    } = req.query;
    const where = [VISIBLE, 'st.deleted_at IS NULL'];
    const params = [req.orgId];
    if (client_id) { where.push('st.client_id = ?'); params.push(client_id); }
    if (contract_id) { where.push('st.contract_id = ?'); params.push(contract_id); }
    if (device_id) { where.push('st.device_id = ?'); params.push(device_id); }
    if (test_source) { where.push('st.test_source = ?'); params.push(test_source); }

    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 100);
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const clause = `WHERE ${where.join(' AND ')}`;

    // is_unattributed tells the UI why a row it can see has no owner — the
    // same idea as is_shared (#566), is_global (#582) and outages (#599).
    const [rows] = await db.query(
      `SELECT st.*, (st.organization_id IS NULL) AS is_unattributed
         FROM speed_tests st ${clause}
        ORDER BY st.tested_at DESC
        LIMIT ${safeLimit} OFFSET ${(safePage - 1) * safeLimit}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM speed_tests st ${clause}`, params,
    );
    res.json({
      data: rows,
      meta: { total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) },
    });
  } catch (err) { next(err); }
});

router.get('/:id', requirePermission('speed_tests.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT st.*, (st.organization_id IS NULL) AS is_unattributed
         FROM speed_tests st WHERE st.id = ? AND ${VISIBLE} AND st.deleted_at IS NULL LIMIT 1`,
      [req.params.id, req.orgId],
    );
    if (!rows[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Speed test not found' } });
    }
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

/**
 * A speed test may only reference the caller's OWN client, contract and device.
 *
 * The foreign keys require these rows to EXIST, not to belong to anyone in
 * particular — an org-agnostic FK cannot express tenancy. So org A could post a
 * measurement against org B's contract, and crudController would stamp it
 * organization_id = A. The row is then invisible to B (their list is scoped to
 * their own org) and undeletable by them, while still being attached to their
 * contract.
 *
 * That is not merely litter. serviceHealthService.getLastSpeedTest keyed on
 * contract_id alone, so B's own service-health panel — and the context fed to
 * the AI reply assistant — would read A's forged row as B's most recent test.
 * A fabricated 0.05 Mbps with a far-future tested_at becomes B's "latest
 * measurement", which is a way to make another ISP's diagnostics lie.
 *
 * Checked here rather than in validate(): ownership is not a shape.
 */
async function assertOwnedReferences(req, res, next) {
  try {
    const checks = [
      ['client_id', 'clients'],
      ['contract_id', 'contracts'],
      ['device_id', 'devices'],
    ];
    for (const [field, table] of checks) {
      const value = req.body?.[field];
      if (value === undefined || value === null) continue;
      const [rows] = await db.query(
        // Admits NULL-org parents so a single-tenant install still works, the
        // same rule the read predicate uses.
        `SELECT id FROM ${table}
          WHERE id = ? AND (organization_id = ? OR (? IS NULL AND organization_id IS NULL))
            AND deleted_at IS NULL LIMIT 1`,
        [value, req.orgId, req.orgId],
      );
      if (!rows.length) {
        throw new ValidationError(`${field} does not belong to this organization`);
      }
    }
    next();
  } catch (err) { next(err); }
}

// From migration 438 on nothing new is unattributed, so adoption only ever
// shrinks the legacy set. Without it those rows would be permanently
// undeletable — visible on every tenant's list with no way to clear them.
const rejectMove = rejectOrgReassignment('speed test');
const adopt = adoptUnattributed('speed_tests', 'speed test');

function rejectCommissioningBinding(req, _res, next) {
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'work_order_id')) {
    return next(new ValidationError(
      'work_order_id is trusted commissioning evidence and may only be set through a work-order commissioning command',
    ));
  }
  next();
}

async function rejectBoundCommissioningMutation(req, _res, next) {
  try {
    const [rows] = await db.query(
      `SELECT st.work_order_id FROM speed_tests st
        WHERE st.id = ? AND ${VISIBLE}
        LIMIT 1`,
      [req.params.id, req.orgId],
    );
    if (rows[0]?.work_order_id) {
      throw new ValidationError(
        'Work-order commissioning evidence is immutable; record a new commissioning test instead',
      );
    }
    next();
  } catch (err) { next(err); }
}

router.post('/', requirePermission('speed_tests.create'), rejectCommissioningBinding, validate(createSpeedTest), assertOwnedReferences, ctrl.create);
router.put('/:id', requirePermission('speed_tests.update'), rejectBoundCommissioningMutation, rejectMove, validate(updateSpeedTest), assertOwnedReferences, adopt, ctrl.update);
router.delete('/:id', requirePermission('speed_tests.delete'), rejectBoundCommissioningMutation, adopt, ctrl.destroy);
router.post('/:id/restore', requirePermission('speed_tests.update'), rejectBoundCommissioningMutation, adopt, ctrl.restore);

module.exports = router;
