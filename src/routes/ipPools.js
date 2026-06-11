// =============================================================================
// FireISP 5.0 — IP Pool Routes
// =============================================================================

const { Router } = require('express');
const IpPool = require('../models/IpPool');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createIpPool, updateIpPool } = require('../middleware/schemas/ipPools');
const poolAssignmentService = require('../services/poolAssignmentService');
const { computeUsableCount } = require('../services/poolUtilizationService');
const db = require('../config/database');

const router = Router();
const ctrl = crudController(IpPool);

router.use(authenticate);
router.use(orgScope);

// GET /utilization — list utilization for all pools in the org
router.get('/utilization', requirePermission('ip_pools.utilization'), async (req, res, next) => {
  try {
    const pools = await IpPool.findAll({ orgId: req.orgId });

    const result = await Promise.all(pools.map(async (pool) => {
      const [assignedRows] = await db.query(
        `SELECT type, COUNT(*) AS cnt
         FROM ip_assignments
         WHERE pool_id = ? AND deleted_at IS NULL AND status != 'expired'
         GROUP BY type`,
        [pool.id],
      );
      const byType = { static: 0, dynamic: 0, reserved: 0 };
      let assigned = 0;
      for (const row of assignedRows) {
        const t = row.type;
        byType[t] = (byType[t] || 0) + Number(row.cnt);
        assigned += Number(row.cnt);
      }

      const usable = computeUsableCount(pool);
      const available = Math.max(0, usable - assigned);
      const percent_used = usable > 0 ? Math.round((assigned / usable) * 100) : 0;

      return {
        pool_id: pool.id,
        pool_name: pool.name,
        network: pool.network,
        subnet_mask: pool.subnet_mask,
        ip_version: pool.ip_version,
        total_usable: usable,
        assigned,
        available,
        percent_used,
        by_type: byType,
      };
    }));

    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// GET /:id/utilization — single pool utilization
router.get('/:id/utilization', requirePermission('ip_pools.utilization'), async (req, res, next) => {
  try {
    const pool = await IpPool.findByIdOrFail(req.params.id, req.orgId);

    const [assignedRows] = await db.query(
      `SELECT type, COUNT(*) AS cnt
       FROM ip_assignments
       WHERE pool_id = ? AND deleted_at IS NULL AND status != 'expired'
       GROUP BY type`,
      [pool.id],
    );
    const byType = { static: 0, dynamic: 0, reserved: 0 };
    let assigned = 0;
    for (const row of assignedRows) {
      const t = row.type;
      byType[t] = (byType[t] || 0) + Number(row.cnt);
      assigned += Number(row.cnt);
    }

    const usable = computeUsableCount(pool);
    const available = Math.max(0, usable - assigned);
    const percent_used = usable > 0 ? Math.round((assigned / usable) * 100) : 0;

    res.json({
      data: {
        pool_id: pool.id,
        pool_name: pool.name,
        network: pool.network,
        subnet_mask: pool.subnet_mask,
        ip_version: pool.ip_version,
        total_usable: usable,
        assigned,
        available,
        percent_used,
        by_type: byType,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /:id/assign-next — dynamically assign the next free IP from a pool
router.post('/:id/assign-next', requirePermission('ip_pools.assign'), async (req, res, next) => {
  try {
    const { contract_id, client_id, type = 'dynamic' } = req.body;
    const result = await poolAssignmentService.assignNextFreeIp(req.params.id, {
      contractId: contract_id,
      clientId: client_id,
      type,
      orgId: req.orgId,
    });
    res.status(201).json({ data: result });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    if (err.status === 422) return res.status(422).json({ error: err.message });
    next(err);
  }
});

// POST / — create pool with overlap detection
router.post('/', requirePermission('ip_pools.create'), validate(createIpPool), async (req, res, next) => {
  try {
    const body = { ...req.body, organization_id: req.orgId };
    await poolAssignmentService.assertNoOverlap(body);
    const pool = await IpPool.create(body);
    res.status(201).json({ data: pool });
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: err.message });
    next(err);
  }
});

// PUT /:id — update pool with overlap detection
router.put('/:id', requirePermission('ip_pools.update'), validate(updateIpPool), async (req, res, next) => {
  try {
    // Fetch current record to merge org_id and ip_version for overlap check
    const existing = await IpPool.findByIdOrFail(req.params.id, req.orgId);
    const merged = {
      ...existing,
      ...req.body,
      organization_id: req.orgId,
    };
    await poolAssignmentService.assertNoOverlap(merged, req.params.id);
    const pool = await IpPool.update(req.params.id, req.body, req.orgId);
    res.json({ data: pool });
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: err.message });
    next(err);
  }
});

router.get('/', requirePermission('ip_pools.view'), ctrl.list);
router.get('/:id', requirePermission('ip_pools.view'), ctrl.get);
router.delete('/:id', requirePermission('ip_pools.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('ip_pools.update'), ctrl.restore);

module.exports = router;
