// =============================================================================
// FireISP 5.0 — Service Order Routes (workflow) — §1.2
// =============================================================================
// Simplified lifecycle (migration 380): new → in_process → done, or cancelled
// (reachable from new/in_process). Each new order is seeded with a default
// onboarding checklist. "Start" auto-creates + provisions the contract for
// new_install orders; "Complete" activates it and optionally raises an
// installation-fee invoice.
// =============================================================================

const { Router } = require('express');
const ServiceOrder = require('../models/ServiceOrder');
const Client = require('../models/Client');
const Lead = require('../models/Lead');
const Contract = require('../models/Contract');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createServiceOrder, updateServiceOrder, patchServiceOrder, completeServiceOrder,
  createServiceOrderTask, updateServiceOrderTask,
} = require('../middleware/schemas/serviceOrders');
const lifecycleService = require('../services/lifecycleService');
const { assertPlanSelectable } = require('../services/planAvailability');
const auditLog = require('../services/auditLog');
const db = require('../config/database');
const { NotFoundError, ValidationError } = require('../utils/errors');

const router = Router();

// A service order's client_id/lead_id/plan_id/contract_id are all foreign
// keys into other org-scoped tables. The validate() DSL only checks type/min
// (see middleware/schemas/serviceOrders.js) — without this, a cross-org id
// would be accepted and stored verbatim on create, and PATCH could link an
// arbitrary OTHER organization's contract onto this order (lifecycleService's
// startOrder/completeOrder re-verify the client at start/complete time, but
// the write path itself must reject a cross-org id up front). Only checks
// whichever of the four FK fields is actually present in `body`.
async function assertServiceOrderFks(body, orgId) {
  if (body.client_id !== undefined) {
    const client = await Client.findById(body.client_id, orgId);
    if (!client) throw new ValidationError('client_id does not belong to this organization');
  }
  if (body.lead_id !== undefined) {
    const lead = await Lead.findById(body.lead_id, orgId);
    if (!lead) throw new ValidationError('lead_id does not belong to this organization');
  }
  if (body.plan_id !== undefined) {
    // Same org-or-global live-plan check as routes/contracts.js — a service
    // order may only be linked to a live plan (a fresh AppError so its
    // PLAN_ARCHIVED code is preserved rather than being flattened to
    // VALIDATION_ERROR).
    await assertPlanSelectable(db, body.plan_id, orgId);
  }
  if (body.contract_id !== undefined) {
    const contract = await Contract.findById(body.contract_id, orgId);
    if (!contract) throw new ValidationError('contract_id does not belong to this organization');
  }
}

const ctrl = crudController(ServiceOrder, {
  cacheResource: 'service-orders',
  beforeUpdate: (_old, req) => assertServiceOrderFks(req.body, req.orgId),
});

router.use(authenticate);
router.use(orgScope);

// List service orders with the same pagination/meta/filters/include_deleted
// semantics as crudController.list (see BaseModel.findAll/count), but LEFT
// JOINs clients/leads so the response carries client_name/lead_name directly
// — the frontend table used to depend on a separate, page-capped client
// lookup just to resolve a name for the client column (and had no way at all
// to identify a lead-sourced order); this removes that dependency.
router.get('/', requirePermission('service_orders.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50, order_by, order, include_deleted, only_deleted, ...filters } = req.query;
    const conditions = [];
    const params = [];

    if (req.orgId) { conditions.push('so.organization_id = ?'); params.push(req.orgId); }

    const withDeleted = include_deleted === 'true';
    const onlyDeleted = only_deleted === 'true';
    if (onlyDeleted) {
      conditions.push('so.deleted_at IS NOT NULL');
    } else if (!withDeleted) {
      conditions.push('so.deleted_at IS NULL');
    }

    // Generic column filters — same allowlist crudController/BaseModel.findAll
    // uses (fillable columns, plus id/status/organization_id).
    for (const [col, val] of Object.entries(filters)) {
      if (ServiceOrder.fillable.includes(col) || col === 'id' || col === 'status' || col === 'organization_id') {
        conditions.push(`so.\`${col}\` = ?`);
        params.push(val);
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 100);
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeOffset = (safePage - 1) * safeLimit;
    const safeOrderBy = ServiceOrder.sortable.includes(order_by) ? order_by : 'id';
    const safeOrder = order === 'DESC' ? 'DESC' : 'ASC';

    const [rows] = await db.query(
      `SELECT so.*, c.name AS client_name, l.name AS lead_name
         FROM service_orders so
         LEFT JOIN clients c ON c.id = so.client_id
         LEFT JOIN leads l ON l.id = so.lead_id
         ${where} ORDER BY so.${safeOrderBy} ${safeOrder} LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM service_orders so ${where}`,
      params,
    );

    res.json({
      data: rows,
      meta: { total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) },
    });
  } catch (err) { next(err); }
});
router.get('/:id', requirePermission('service_orders.view'), ctrl.get);

// Create a service order: generate an order number and seed the onboarding
// checklist inside a single transaction.
router.post('/', requirePermission('service_orders.create'), validate(createServiceOrder), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Reject a cross-org client/lead/plan/contract before writing anything.
    await assertServiceOrderFks(req.body, req.orgId);

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

// Start: new -> in_process. Auto-creates + provisions the contract for
// new_install orders (and auto-converts an unconverted lead, if needed).
router.post('/:id/start', requirePermission('service_orders.update'), async (req, res, next) => {
  try {
    const { order, contract, provisioning } = await lifecycleService.startOrder(req.params.id, {
      orgId: req.orgId,
      userId: req.user?.id,
    });
    await auditLog.log({
      userId: req.user?.id,
      organizationId: req.orgId,
      action: 'transition:in_process',
      tableName: ServiceOrder.tableName,
      recordId: parseInt(req.params.id, 10),
      newValues: { status: 'in_process', contract_id: contract?.id || order.contract_id || null },
    }).catch(() => {});
    res.json({ data: { ...order, contract: contract || undefined, provisioning: provisioning || undefined } });
  } catch (err) { next(err); }
});

// Complete: in_process -> done. Activates the linked contract and either
// leaves the install as already-paid or raises an installation-fee invoice.
router.post('/:id/complete', requirePermission('service_orders.update'), validate(completeServiceOrder), async (req, res, next) => {
  try {
    const { billing, installation_fee: installationFee, description } = req.body;
    const { order, invoice } = await lifecycleService.completeOrder(req.params.id, {
      orgId: req.orgId,
      userId: req.user?.id,
      billing,
      installationFee,
      description,
    });
    await auditLog.log({
      userId: req.user?.id,
      organizationId: req.orgId,
      action: 'transition:done',
      tableName: ServiceOrder.tableName,
      recordId: parseInt(req.params.id, 10),
      newValues: { status: 'done', billing, invoice_id: invoice?.id || null },
    }).catch(() => {});
    res.json({ data: { ...order, invoice: invoice || undefined } });
  } catch (err) { next(err); }
});

// Cancel: new/in_process -> cancelled. Deprovisions (cancels + deactivates
// RADIUS on) a still-pending auto-created contract; leaves a manually-linked
// contract in any other status untouched.
router.post('/:id/cancel', requirePermission('service_orders.update'), async (req, res, next) => {
  try {
    const { order, contractCancelled } = await lifecycleService.cancelOrder(req.params.id, {
      orgId: req.orgId,
      userId: req.user?.id,
    });
    await auditLog.log({
      userId: req.user?.id,
      organizationId: req.orgId,
      action: 'transition:cancelled',
      tableName: ServiceOrder.tableName,
      recordId: parseInt(req.params.id, 10),
      newValues: { status: 'cancelled', contract_cancelled: contractCancelled },
    }).catch(() => {});
    res.json({ data: order });
  } catch (err) { next(err); }
});

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
