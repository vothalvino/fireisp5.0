// =============================================================================
// FireISP 5.0 — Service Order Routes (workflow) — §1.2
// =============================================================================
// Lifecycle: requested → approved → provisioning → activated (or cancelled).
// Each new order is seeded with a default onboarding checklist.
// =============================================================================

const { Router } = require('express');
const ServiceOrder = require('../models/ServiceOrder');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createServiceOrder, updateServiceOrder, patchServiceOrder, activateServiceOrder,
  createServiceOrderTask, updateServiceOrderTask,
} = require('../middleware/schemas/serviceOrders');
const lifecycleService = require('../services/lifecycleService');
const auditLog = require('../services/auditLog');
const db = require('../config/database');
const { NotFoundError } = require('../utils/errors');

const router = Router();
const ctrl = crudController(ServiceOrder, { cacheResource: 'service-orders' });

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('service_orders.view'), ctrl.list);
router.get('/:id', requirePermission('service_orders.view'), ctrl.get);

// Create a service order: generate an order number and seed the onboarding
// checklist inside a single transaction.
router.post('/', requirePermission('service_orders.create'), validate(createServiceOrder), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const orderNumber = req.body.order_number || await lifecycleService.generateOrderNumber(conn, req.orgId);

    const filtered = {};
    for (const key of ServiceOrder.fillable) {
      if (req.body[key] !== undefined) filtered[key] = req.body[key];
    }
    filtered.order_number = orderNumber;
    if (req.orgId) filtered.organization_id = req.orgId;

    const cols = Object.keys(filtered);
    const [ins] = await conn.query(
      `INSERT INTO service_orders (${cols.map(c => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map(c => filtered[c]),
    );
    const orderId = ins.insertId;

    await lifecycleService.seedDefaultTasks(conn, orderId);

    await conn.commit();

    const record = await ServiceOrder.findById(orderId, req.orgId);
    await auditLog.log({
      userId: req.user?.id,
      organizationId: req.orgId,
      action: 'create',
      tableName: ServiceOrder.tableName,
      recordId: orderId,
      newValues: filtered,
    }).catch(() => {});

    res.status(201).json({ data: record });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

router.put('/:id', requirePermission('service_orders.update'), validate(updateServiceOrder), ctrl.update);
router.patch('/:id', requirePermission('service_orders.update'), validate(patchServiceOrder), ctrl.partialUpdate);
router.delete('/:id', requirePermission('service_orders.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('service_orders.update'), ctrl.restore);

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------
function transitionRoute(toStatus, extractContractId = false) {
  return async (req, res, next) => {
    try {
      const order = await lifecycleService.transitionOrder(req.params.id, toStatus, {
        orgId: req.orgId,
        userId: req.user?.id,
        contractId: extractContractId ? (req.body?.contract_id || null) : null,
      });
      await auditLog.log({
        userId: req.user?.id,
        organizationId: req.orgId,
        action: `transition:${toStatus}`,
        tableName: ServiceOrder.tableName,
        recordId: parseInt(req.params.id, 10),
        newValues: { status: toStatus },
      }).catch(() => {});
      res.json({ data: order });
    } catch (err) { next(err); }
  };
}

router.post('/:id/approve', requirePermission('service_orders.update'), transitionRoute('approved'));
router.post('/:id/provision', requirePermission('service_orders.update'), transitionRoute('provisioning'));
router.post('/:id/activate', requirePermission('service_orders.update'), validate(activateServiceOrder), transitionRoute('activated', true));
router.post('/:id/cancel', requirePermission('service_orders.update'), transitionRoute('cancelled'));

// ---------------------------------------------------------------------------
// Onboarding checklist tasks
// ---------------------------------------------------------------------------
router.get('/:id/tasks', requirePermission('service_orders.view'), async (req, res, next) => {
  try {
    await ServiceOrder.findByIdOrFail(req.params.id, req.orgId);
    const tasks = await ServiceOrder.getTasks(req.params.id);
    res.json({ data: tasks });
  } catch (err) { next(err); }
});

router.post('/:id/tasks', requirePermission('service_orders.update'), validate(createServiceOrderTask), async (req, res, next) => {
  try {
    await ServiceOrder.findByIdOrFail(req.params.id, req.orgId);
    const { task_key, label, sort_order, notes } = req.body;
    const [result] = await db.query(
      `INSERT INTO service_order_tasks (service_order_id, task_key, label, sort_order, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [req.params.id, task_key, label, sort_order ?? 0, notes ?? null],
    );
    const [rows] = await db.query('SELECT * FROM service_order_tasks WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/:id/tasks/:taskId', requirePermission('service_orders.update'), validate(updateServiceOrderTask), async (req, res, next) => {
  try {
    await ServiceOrder.findByIdOrFail(req.params.id, req.orgId);
    const updates = [];
    const params = [];
    if (req.body.label !== undefined) { updates.push('label = ?'); params.push(req.body.label); }
    if (req.body.sort_order !== undefined) { updates.push('sort_order = ?'); params.push(req.body.sort_order); }
    if (req.body.notes !== undefined) { updates.push('notes = ?'); params.push(req.body.notes); }
    if (req.body.is_done !== undefined) {
      updates.push('is_done = ?'); params.push(req.body.is_done ? 1 : 0);
      if (req.body.is_done) {
        updates.push('completed_at = NOW()'); updates.push('completed_by = ?'); params.push(req.user?.id || null);
      } else {
        updates.push('completed_at = NULL'); updates.push('completed_by = NULL');
      }
    }
    if (updates.length === 0) {
      const [existing] = await db.query('SELECT * FROM service_order_tasks WHERE id = ? AND service_order_id = ?', [req.params.taskId, req.params.id]);
      if (!existing[0]) throw new NotFoundError('Service order task');
      return res.json({ data: existing[0] });
    }
    params.push(req.params.taskId, req.params.id);
    const [result] = await db.query(
      `UPDATE service_order_tasks SET ${updates.join(', ')} WHERE id = ? AND service_order_id = ?`,
      params,
    );
    if (result.affectedRows === 0) throw new NotFoundError('Service order task');
    const [rows] = await db.query('SELECT * FROM service_order_tasks WHERE id = ?', [req.params.taskId]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
