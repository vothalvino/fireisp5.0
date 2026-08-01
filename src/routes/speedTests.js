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

// From migration 438 on nothing new is unattributed, so adoption only ever
// shrinks the legacy set. Without it those rows would be permanently
// undeletable — visible on every tenant's list with no way to clear them.
const rejectMove = rejectOrgReassignment('speed test');
const adopt = adoptUnattributed('speed_tests', 'speed test');

router.post('/', requirePermission('speed_tests.create'), validate(createSpeedTest), ctrl.create);
router.put('/:id', requirePermission('speed_tests.update'), rejectMove, validate(updateSpeedTest), adopt, ctrl.update);
router.delete('/:id', requirePermission('speed_tests.delete'), adopt, ctrl.destroy);
router.post('/:id/restore', requirePermission('speed_tests.update'), adopt, ctrl.restore);

module.exports = router;
