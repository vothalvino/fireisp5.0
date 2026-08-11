// =============================================================================
// FireISP 5.0 — Work Order Routes — §12.3
// =============================================================================

const path = require('path');
const fs = require('fs');
const { Router } = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission, userHasPermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createWorkOrder, updateWorkOrder, patchWorkOrder, completeTestWindow,
} = require('../middleware/schemas/workOrders');
const { pickupDisposition } = require('../middleware/schemas/inventorySerials');
const db = require('../config/database');
const User = require('../models/User');
const inventorySerialService = require('../services/inventorySerialService');
const eventBus = require('../services/eventBus');
const auditLog = require('../services/auditLog');
const logger = require('../utils/logger').child({ service: 'routes/workOrders' });
const { ForbiddenError, NotFoundError, ValidationError } = require('../utils/errors');
const { attachmentStorage, resolveStoredPath, STORAGE_ROOT,
  attachmentFileFilter, attachmentMimeType, contentDispositionAttachment } = require('../middleware/upload');

// Fire-and-forget: notifies the assignee (in-app + email via notificationHooks)
// without ever delaying or failing the HTTP response.
function emitAssigned(organizationId, workOrder, assignedBy) {
  Promise.resolve(eventBus.emit('work_order.assigned', { organizationId, workOrder, assignedBy }))
    .catch(err => logger.warn({ err: err.message, workOrderId: workOrder.id }, 'work_order.assigned emit failed'));
}

// A work order may only be assigned to someone who could actually work it, i.e.
// a user authorized to update work orders (`work_orders.update`). This is the
// same gate the mutation routes enforce via requirePermission, so an assignee is
// always someone who can progress/complete the order they are handed.
const WORK_ORDER_ASSIGN_PERMISSION = 'work_orders.update';

// ---------------------------------------------------------------------------
// Install-acceptance gate (migration 445). Completing an INSTALLATION work
// order that serves a contract requires at least one acceptance reading —
// wireless signal (dBm), negotiated link rate (Mbps), or FTTH optical Rx
// (dBm) — or an explicit waive. The reading can arrive in this request or
// already be on the row; `body` wins over `before` field-by-field so both
// PUT (full replace) and PATCH (sparse) evaluate the state being written.
// Only the transition INTO completed is gated — editing an already-completed
// order must not demand the readings again.
// ---------------------------------------------------------------------------
const ACCEPTANCE_READING_FIELDS = ['acceptance_signal_dbm', 'acceptance_link_mbps', 'acceptance_rx_dbm'];

function acceptanceGateError(before, body) {
  const merged = (field) => (field in body ? body[field] : before?.[field]);
  if (merged('status') !== 'completed' || before?.status === 'completed') return null;
  if (merged('work_type') !== 'installation') return null;
  if (!merged('contract_id')) return null;
  const hasReading = ACCEPTANCE_READING_FIELDS.some((f) => merged(f) !== null && merged(f) !== undefined);
  const waived = Boolean(merged('acceptance_waived'));
  if (hasReading || waived) return null;
  return 'Completing an installation work order requires an acceptance reading (signal dBm, link Mbps, or optical Rx dBm) — or an explicit waive with acceptance_waived';
}

/** True when this request records anything acceptance-related. */
function touchesAcceptance(body) {
  return ACCEPTANCE_READING_FIELDS.some((f) => f in body)
    || 'acceptance_waived' in body || 'acceptance_notes' in body;
}

// ---------------------------------------------------------------------------
// Legal-document gates (migration 447). Every active MX arrival template needs
// an exact signed service-order instance before work begins; every active MX
// activation-contract template needs one before completion. Only transitions
// INTO the target status are gated. Global organizations are exempt.
// ---------------------------------------------------------------------------
async function legalGateError(before, body, options) {
  const merged = (field) => (field in body ? body[field] : before?.[field]);
  const target = merged('status');
  if (!target || target === before?.status) return null;
  if (target !== 'in_progress' && target !== 'completed') return null;
  const legalDocumentService = require('../services/legalDocumentService');
  return legalDocumentService.pendingGateError(
    { work_type: merged('work_type'), service_order_id: merged('service_order_id') },
    target,
    options,
  );
}

/**
 * Completing the visit is the point of no return for the assigned-technician
 * commissioning endpoints. Refuse that transition until evidence is bound to
 * this exact WO and every bounded-network cleanup marker is gone. Generic
 * /speed-tests rows have work_order_id NULL and can never satisfy this gate.
 */
async function commissioningGateError(before, body, orgId) {
  const merged = (field) => (field in body ? body[field] : before?.[field]);
  if (merged('status') !== 'completed' || before?.status === 'completed') return null;
  if (merged('work_type') !== 'installation' || !merged('contract_id')
      || !merged('service_order_id')) return null;

  const [rows] = await db.query(
    `SELECT so.order_type, so.contract_id AS order_contract_id,
            c.id AS linked_contract_id,
            c.test_window_expires_at, c.test_window_cleanup_pending,
            EXISTS (
              SELECT 1 FROM speed_tests st
               WHERE st.work_order_id = ? AND st.contract_id = c.id
                 AND st.organization_id = ? AND st.test_source = 'technician'
                 AND st.tested_at >= so.started_at
                 AND st.deleted_at IS NULL
            ) AS has_commissioning_test
       FROM service_orders so
       LEFT JOIN contracts c
         ON c.id = ? AND c.id = so.contract_id
        AND (c.organization_id = ? OR c.organization_id IS NULL)
        AND c.deleted_at IS NULL
      WHERE so.id = ? AND so.organization_id = ? AND so.deleted_at IS NULL
      LIMIT 1`,
    [before.id, orgId, merged('contract_id'), orgId, merged('service_order_id'), orgId],
  );
  const installation = rows[0];
  // Survey/maintenance/manual installation visits are not activation visits
  // and have no commissioning endpoint, so their historical completion flow
  // remains unchanged.
  if (!installation || installation.order_type !== 'new_install') return null;
  if (!installation.linked_contract_id
      || Number(installation.order_contract_id) !== Number(merged('contract_id'))) {
    return 'The new-install order and installation work order must link to the same contract';
  }
  if (installation.test_window_expires_at
      || Number(installation.test_window_cleanup_pending) === 1) {
    return 'End the technician test window and wait for network cleanup before completing the installation';
  }
  if (!installation.has_commissioning_test) {
    return 'Record the technician commissioning speed test for this installation before completing it';
  }
  return null;
}

const ACTIVATION_WO_PROTECTED_FIELDS = [
  'assigned_to', 'client_id', 'contract_id', 'service_order_id', 'work_type',
];

async function activationServiceOrder(serviceOrderId, orgId, { runner = db, lock = false } = {}) {
  const run = typeof runner === 'function' ? runner : runner.query.bind(runner);
  const [orders] = await run(
    `SELECT so.id, so.order_type, so.status, so.contract_id, so.client_id,
            c.id AS linked_contract_id, c.client_id AS contract_client_id
       FROM service_orders so
       LEFT JOIN contracts c
         ON c.id = so.contract_id
        AND (c.organization_id = ? OR c.organization_id IS NULL)
        AND c.deleted_at IS NULL
      WHERE so.id = ? AND so.organization_id = ? AND so.deleted_at IS NULL
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [orgId, serviceOrderId, orgId],
  );
  return orders[0] || null;
}

async function enforceActivationWorkOrderCreate(body, req) {
  if (body.work_type !== 'installation' || !body.service_order_id) return;
  const order = await activationServiceOrder(body.service_order_id, req.orgId);
  if (!order || order.order_type !== 'new_install') return;
  if (order.status !== 'in_process' || !order.linked_contract_id
      || Number(order.contract_id) !== Number(body.contract_id)
      || Number(order.client_id) !== Number(body.client_id)
      || Number(order.contract_client_id) !== Number(body.client_id)) {
    throw new ValidationError(
      'Activation work orders must match the in-process new-install service order, contract, and client',
    );
  }
  const hasContractAuthority = req.user?.role === 'admin'
    || await userHasPermission(req, 'contracts.update');
  if (!hasContractAuthority) {
    throw new ForbiddenError(
      'Only a contract administrator may create a prepared activation visit',
    );
  }
  if (body.assigned_to
      && !(await User.hasEffectivePermission(body.assigned_to, req.orgId, 'speed_tests.create'))) {
    throw new ValidationError(
      'The assigned commissioning technician must be allowed to create speed tests',
    );
  }
  const [duplicates] = await db.query(
    `SELECT id FROM work_orders
      WHERE organization_id = ? AND service_order_id = ?
        AND work_type = 'installation' AND deleted_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [req.orgId, order.id],
  );
  if (duplicates[0]) {
    throw new ValidationError(
      'This new-install order already has its canonical installation work order',
    );
  }
}

function sameWorkOrderValue(left, right) {
  if (left === null || left === undefined || left === '') {
    return right === null || right === undefined || right === '';
  }
  return String(left) === String(right);
}

function sameAcceptanceValue(field, left, right) {
  if (field === 'acceptance_waived') {
    const normalizeWaiver = value => value === true || value === 1 || value === '1';
    return normalizeWaiver(left) === normalizeWaiver(right);
  }
  return sameWorkOrderValue(left, right);
}

/**
 * New-install visits carry activation authority, unlike ordinary maintenance
 * WOs. An ordinary technician may record acceptance/complete only their own
 * assigned visit and cannot relink/reassign it to manufacture that authority.
 * Admins or callers with contracts.update retain dispatcher override.
 */
async function enforceActivationWorkOrderPolicy(before, body, req) {
  const merged = (field) => (field in body ? body[field] : before?.[field]);
  if (merged('work_type') !== 'installation'
      || !merged('service_order_id') || !merged('contract_id')) return false;

  const order = await activationServiceOrder(merged('service_order_id'), req.orgId);
  if (!order || order.order_type !== 'new_install') return false;
  if (!order.linked_contract_id
      || Number(order.contract_id) !== Number(merged('contract_id'))
      || Number(order.client_id) !== Number(merged('client_id'))
      || Number(order.contract_client_id) !== Number(merged('client_id'))) {
    throw new ValidationError(
      'The new-install work order must remain linked to its service order contract and client',
    );
  }

  // Completion is the durable boundary that makes the acceptance snapshot
  // immutable. Do not allow a two-request bypass (reopen, then rewrite).
  if (before?.status === 'completed' && merged('status') !== 'completed') {
    throw new ValidationError('A completed new-install activation work order cannot be reopened');
  }

  const acceptanceFields = [
    ...ACCEPTANCE_READING_FIELDS, 'acceptance_waived', 'acceptance_notes',
  ];
  const changesCompletedAcceptance = before?.status === 'completed'
    && acceptanceFields.some(field => (
      field in body && !sameAcceptanceValue(field, body[field], before?.[field])
    ));
  if (changesCompletedAcceptance) {
    throw new ValidationError(
      'Acceptance evidence on a completed new-install work order is immutable',
    );
  }

  const hasContractAuthority = req.user?.role === 'admin'
    || await userHasPermission(req, 'contracts.update');
  const protectedChange = ACTIVATION_WO_PROTECTED_FIELDS.find(field =>
    field in body && !sameWorkOrderValue(body[field], before?.[field]));
  if (protectedChange && !hasContractAuthority) {
    throw new ForbiddenError(
      `Only a contract administrator may change ${protectedChange} on a prepared activation visit`,
    );
  }
  if (protectedChange === 'assigned_to' && body.assigned_to
      && !(await User.hasEffectivePermission(body.assigned_to, req.orgId, 'speed_tests.create'))) {
    throw new ValidationError(
      'The assigned commissioning technician must be allowed to create speed tests',
    );
  }

  const recordsAcceptance = touchesAcceptance(body);
  const completesVisit = merged('status') === 'completed' && before?.status !== 'completed';
  if ((recordsAcceptance || completesVisit) && !hasContractAuthority
      && (!before.assigned_to || Number(before.assigned_to) !== Number(req.user?.id))) {
    throw new ForbiddenError(
      'Only the assigned technician or a contract administrator may record activation acceptance or complete this visit',
    );
  }

  const waived = Boolean(merged('acceptance_waived'));
  const waiverNotes = String(merged('acceptance_notes') || '').trim();
  if (waived && (recordsAcceptance || completesVisit) && !waiverNotes) {
    throw new ValidationError('Acceptance waiver notes are required for a new-install activation visit');
  }
  return true;
}

const ACTIVATION_TRANSITION_GUARD_FIELDS = [
  'status', 'work_type', 'client_id', 'contract_id', 'service_order_id',
  'assigned_to', ...ACCEPTANCE_READING_FIELDS, 'acceptance_waived',
  'acceptance_notes', 'acceptance_recorded_at',
];

/**
 * Linearize an activation-owned legal transition with template activation.
 * Template CRUD locks the same organization row that pendingGateError reaches
 * through its authoritative service-order query. Holding that lock until the
 * guarded WO write commits prevents an active template appearing between the
 * exact-signature check and assigned -> in_progress/completed.
 */
async function writeActivationTransition({ req, before, body, activationOwned, write }) {
  const target = 'status' in body ? body.status : before?.status;
  const enteringLegalState = activationOwned
    && target !== before?.status
    && (target === 'in_progress' || target === 'completed');
  if (!enteringLegalState) return write(db);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM work_orders
        WHERE id = ? AND organization_id = ? AND deleted_at IS NULL
        FOR UPDATE`,
      [req.params.id, req.orgId],
    );
    const locked = rows[0];
    if (!locked) throw new NotFoundError('Work order');

    const concurrentChange = ACTIVATION_TRANSITION_GUARD_FIELDS.find(field => (
      field === 'acceptance_waived'
        ? !sameAcceptanceValue(field, locked[field], before?.[field])
        : !sameWorkOrderValue(locked[field], before?.[field])
    ));
    if (concurrentChange) {
      throw new ValidationError(
        'The activation work order changed concurrently — reload before changing its status',
      );
    }

    const mergedLocked = field => (field in body ? body[field] : locked[field]);
    const lockedOrder = await activationServiceOrder(mergedLocked('service_order_id'), req.orgId, {
      runner: conn,
      lock: true,
    });
    if (!lockedOrder || lockedOrder.order_type !== 'new_install'
        || !lockedOrder.linked_contract_id
        || Number(lockedOrder.contract_id) !== Number(mergedLocked('contract_id'))
        || Number(lockedOrder.client_id) !== Number(mergedLocked('client_id'))
        || Number(lockedOrder.contract_client_id) !== Number(mergedLocked('client_id'))) {
      throw new ValidationError(
        'The activation service-order chain changed concurrently — reload before changing status',
      );
    }

    const legalError = await legalGateError(locked, body, { runner: conn, lock: true });
    if (legalError) throw new ValidationError(legalError);
    const result = await write(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Guard for the `assigned_to` field on create/update/patch. Resolves to an error
 * string when the target user may not be assigned, or null when assignment is
 * allowed (including the unassigned case). Falsy `assignedTo` = unassign/no-op.
 */
async function assigneeAuthError(assignedTo, orgId) {
  if (!assignedTo) return null;
  const ok = await User.hasEffectivePermission(assignedTo, orgId, WORK_ORDER_ASSIGN_PERMISSION);
  return ok ? null : 'Assigned user is not authorized to work with work orders';
}

// ---------------------------------------------------------------------------
// Multer — work order attachments (disk storage, 20 MB limit)
// ---------------------------------------------------------------------------
// Under STORAGE_ROOT, which is the ONLY directory any deployment mounts:
// `storage:/app/storage` in docker-compose.prod.yml and the fireisp-storage PVC
// in k8s/deployment.yaml. The previous ../../uploads/work-orders was mounted by
// nothing, so a technician's installation photos lived in the container's
// writable layer and were destroyed by every redeploy.
const workOrderAttachUpload = multer({
  storage: attachmentStorage('work-orders'),
  // Was absent: this path accepted ANY extension and ANY mime type, with
  // the 20 MB cap as the only restriction (j35).
  fileFilter: attachmentFileFilter,
  limits: { fileSize: 20 * 1024 * 1024 },
}).single('file');

function uploadAttachment(req, res, next) {
  workOrderAttachUpload(req, res, (err) => {
    if (err) return res.status(422).json({ error: err.message });
    next();
  });
}

const router = Router();

router.use(authenticate);
router.use(orgScope);

// GET /work-orders/stats — MUST be before /:id
router.get('/stats', requirePermission('work_orders.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT status, COUNT(*) AS count
       FROM work_orders
       WHERE organization_id = ? AND deleted_at IS NULL
       GROUP BY status`,
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// GET /work-orders/assignable-users — MUST be before /:id.
// The set of users a work order may be assigned to: staff authorized to work
// with work orders (see WORK_ORDER_ASSIGN_PERMISSION). Gated by view so any
// dispatcher building an order can populate the assignee picker. The contract
// activation wizard is also used by contract administrators who deliberately
// need not have broad work-order visibility, so commissioning mode accepts
// either authority. That permission controls who may open the picker; each
// returned commissioning assignee must independently hold work_orders.view,
// work_orders.update, and speed_tests.create so they can see and finish the
// visit they receive. The ordinary picker remains work_orders.view-only.
const requireAssignableUsersPermission = (req, res, next) => (
  req.query.commissioning === 'true'
    ? requirePermission('work_orders.view', 'contracts.update')(req, res, next)
    : requirePermission('work_orders.view')(req, res, next)
);

router.get('/assignable-users', requireAssignableUsersPermission, async (req, res, next) => {
  try {
    let users = await User.getUsersWithPermission(req.orgId, WORK_ORDER_ASSIGN_PERMISSION);
    if (req.query.commissioning === 'true') {
      const eligible = await Promise.all(users.map(async user => {
        const [canViewWorkOrders, canRecordSpeed] = await Promise.all([
          User.hasEffectivePermission(user.id, req.orgId, 'work_orders.view'),
          User.hasEffectivePermission(user.id, req.orgId, 'speed_tests.create'),
        ]);
        return canViewWorkOrders && canRecordSpeed ? user : null;
      }));
      users = eligible.filter(Boolean);
    }
    res.json({ data: users });
  } catch (err) { next(err); }
});

// Allowlist of own-table (work_orders) columns that are safe to sort by.
const WORK_ORDER_SORTABLE = ['id', 'title', 'status', 'priority', 'work_type', 'scheduled_at', 'created_at', 'updated_at', 'client_id', 'site_id', 'device_id', 'assigned_to'];

// GET /work-orders
router.get('/', requirePermission('work_orders.view'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;

    // Validate order_by against the allowlist; joined/derived columns (e.g. assigned_first)
    // are excluded because they are not columns of work_orders itself.
    const safeOrderBy = WORK_ORDER_SORTABLE.includes(req.query.order_by) ? req.query.order_by : 'created_at';
    const safeOrder = req.query.order === 'ASC' ? 'ASC' : 'DESC';

    // Optional filters: by target (client/site/device) or status.
    const where = ['wo.organization_id = ?', 'wo.deleted_at IS NULL'];
    const params = [req.orgId];
    for (const f of ['client_id', 'site_id', 'device_id', 'status', 'ticket_id', 'service_order_id']) {
      if (req.query[f] !== undefined && req.query[f] !== null && req.query[f] !== '') { where.push(`wo.${f} = ?`); params.push(req.query[f]); }
    }
    const whereSql = where.join(' AND ');

    const [rows] = await db.query(
      `SELECT wo.*, u.first_name AS assigned_first, u.last_name AS assigned_last,
              c.name AS client_name, s.name AS site_name, d.name AS device_name
       FROM work_orders wo
       LEFT JOIN users u ON u.id = wo.assigned_to
       LEFT JOIN clients c ON c.id = wo.client_id
       LEFT JOIN sites s ON s.id = wo.site_id
       LEFT JOIN devices d ON d.id = wo.device_id
       WHERE ${whereSql}
       ORDER BY wo.${safeOrderBy} ${safeOrder} LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM work_orders wo WHERE ${whereSql}`,
      params,
    );
    res.json({ data: rows, meta: { total, page, limit } });
  } catch (err) { next(err); }
});

// GET /work-orders/:id
router.get('/:id', requirePermission('work_orders.view'), async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      `SELECT wo.*, u.first_name AS assigned_first, u.last_name AS assigned_last,
              c.name AS client_name, s.name AS site_name, d.name AS device_name
       FROM work_orders wo
       LEFT JOIN users u ON u.id = wo.assigned_to
       LEFT JOIN clients c ON c.id = wo.client_id
       LEFT JOIN sites s ON s.id = wo.site_id
       LEFT JOIN devices d ON d.id = wo.device_id
       WHERE wo.id = ? AND wo.organization_id = ? AND wo.deleted_at IS NULL`,
      [req.params.id, req.orgId],
    );
    if (!row) return res.status(404).json({ error: 'Work order not found' });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// POST /work-orders
router.post('/', requirePermission('work_orders.create'), validate(createWorkOrder), async (req, res, next) => {
  try {
    const { ticket_id, assigned_to, title, description, status, priority, scheduled_at, latitude, longitude, address, notes,
      client_id, site_id, device_id, contract_id, service_order_id, work_type } = req.body;
    if (!client_id && !site_id && !device_id) {
      return res.status(422).json({ error: 'A work order must target at least one of client, site, or device' });
    }
    const assignErr = await assigneeAuthError(assigned_to, req.orgId);
    if (assignErr) return res.status(422).json({ error: assignErr });
    await enforceActivationWorkOrderCreate(req.body, req);
    const [result] = await db.query(
      `INSERT INTO work_orders
         (organization_id, client_id, site_id, device_id, contract_id, service_order_id, ticket_id, assigned_to, created_by,
          title, description, status, priority, work_type, scheduled_at, latitude, longitude, address, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, client_id || null, site_id || null, device_id || null, contract_id || null, service_order_id || null,
        ticket_id || null, assigned_to || null, req.user.id, title, description || null,
        status || 'pending', priority || 'medium', work_type || 'other', scheduled_at || null,
        latitude || null, longitude || null, address || null, notes || null],
    );
    const [[row]] = await db.query('SELECT * FROM work_orders WHERE id = ?', [result.insertId]);
    if (row.assigned_to) emitAssigned(req.orgId, row, req.user.id);
    // work-order mutations were the only site-history writer with no audit
    // trail (hand-rolled handlers; crudController audits automatically)
    await auditLog.log({
      userId: req.user?.id, organizationId: req.orgId, action: 'create',
      tableName: 'work_orders', recordId: row.id, newValues: req.body,
    });
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// PUT /work-orders/:id
router.put('/:id', requirePermission('work_orders.update'), validate(updateWorkOrder), async (req, res, next) => {
  try {
    const { ticket_id, assigned_to, title, description, status, priority, scheduled_at, started_at, completed_at, latitude, longitude, address, notes,
      client_id, site_id, device_id, contract_id, service_order_id, work_type } = req.body;
    if (!client_id && !site_id && !device_id) {
      return res.status(422).json({ error: 'A work order must target at least one of client, site, or device' });
    }
    const assignErr = await assigneeAuthError(assigned_to, req.orgId);
    if (assignErr) return res.status(422).json({ error: assignErr });
    const [[before]] = await db.query(
      'SELECT * FROM work_orders WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!before) return res.status(404).json({ error: 'Work order not found' });
    const activationOwned = await enforceActivationWorkOrderPolicy(before, req.body, req);
    const gateErr = acceptanceGateError(before, req.body);
    if (gateErr) return res.status(422).json({ error: gateErr });
    const legalErr = activationOwned ? null : await legalGateError(before, req.body);
    if (legalErr) return res.status(422).json({ error: legalErr });
    const commissioningErr = await commissioningGateError(before, req.body, req.orgId);
    if (commissioningErr) return res.status(422).json({ error: commissioningErr });
    // Acceptance columns are append-preserve, not full-replace like the rest of
    // PUT: a reading recorded at handoff is a historical measurement — a later
    // PUT that simply doesn't carry it must not blank it.
    const [result] = await writeActivationTransition({
      req,
      before,
      body: req.body,
      activationOwned,
      write: runner => runner.query(
        `UPDATE work_orders SET
         client_id=?, site_id=?, device_id=?, contract_id=?, service_order_id=?,
         ticket_id=?, assigned_to=?, title=?, description=?, status=?, priority=?, work_type=?,
         scheduled_at=?, started_at=?, completed_at=?, latitude=?, longitude=?, address=?, notes=?,
         acceptance_signal_dbm = COALESCE(?, acceptance_signal_dbm),
         acceptance_link_mbps  = COALESCE(?, acceptance_link_mbps),
         acceptance_rx_dbm     = COALESCE(?, acceptance_rx_dbm),
         acceptance_waived     = COALESCE(?, acceptance_waived),
         acceptance_notes      = COALESCE(?, acceptance_notes),
         acceptance_recorded_at = CASE WHEN ? THEN NOW() ELSE acceptance_recorded_at END
         WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
        [client_id || null, site_id || null, device_id || null, contract_id || null, service_order_id || null,
          ticket_id || null, assigned_to || null, title, description || null, status || 'pending',
          priority || 'medium', work_type || 'other', scheduled_at || null, started_at || null, completed_at || null,
          latitude || null, longitude || null, address || null, notes || null,
          req.body.acceptance_signal_dbm ?? null, req.body.acceptance_link_mbps ?? null,
          req.body.acceptance_rx_dbm ?? null,
          'acceptance_waived' in req.body ? (req.body.acceptance_waived ? 1 : 0) : null,
          req.body.acceptance_notes ?? null,
          touchesAcceptance(req.body) ? 1 : 0,
          req.params.id, req.orgId],
      ),
    });
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Work order not found' });
    const [[row]] = await db.query('SELECT * FROM work_orders WHERE id = ?', [req.params.id]);
    if (row.assigned_to && row.assigned_to !== before?.assigned_to) emitAssigned(req.orgId, row, req.user.id);
    await auditLog.log({
      userId: req.user?.id, organizationId: req.orgId, action: 'update',
      tableName: 'work_orders', recordId: row.id, oldValues: before, newValues: req.body,
    });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// PATCH /work-orders/:id
router.patch('/:id', requirePermission('work_orders.update'), validate(patchWorkOrder), async (req, res, next) => {
  try {
    const allowed = ['ticket_id','assigned_to','title','description','status','priority','scheduled_at','started_at','completed_at','latitude','longitude','address','notes','client_id','site_id','device_id','contract_id','service_order_id','work_type',
      'acceptance_signal_dbm','acceptance_link_mbps','acceptance_rx_dbm','acceptance_waived','acceptance_notes'];
    const fields = Object.keys(req.body).filter(k => allowed.includes(k));
    if (fields.length === 0) return res.status(422).json({ error: 'No valid fields to update' });
    // Only re-check authorization when this patch actually sets an assignee; a
    // patch that leaves assigned_to untouched (e.g. a status transition) or that
    // clears it must still pass.
    if ('assigned_to' in req.body) {
      const assignErr = await assigneeAuthError(req.body.assigned_to, req.orgId);
      if (assignErr) return res.status(422).json({ error: assignErr });
    }
    // One snapshot serves the target-integrity check, the assignment-change
    // detection, and the audit trail's oldValues.
    const [[beforePatch]] = await db.query(
      'SELECT * FROM work_orders WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!beforePatch) return res.status(404).json({ error: 'Work order not found' });
    const activationOwned = await enforceActivationWorkOrderPolicy(beforePatch, req.body, req);
    // If the patch touches any target field, ensure the work order still targets
    // at least one of client/site/device once the change is applied.
    const targetKeys = ['client_id', 'site_id', 'device_id'];
    if (targetKeys.some(k => k in req.body)) {
      const merged = targetKeys.map(k => (k in req.body ? req.body[k] : beforePatch[k]));
      if (!merged.some(Boolean)) {
        return res.status(422).json({ error: 'A work order must target at least one of client, site, or device' });
      }
    }
    const patchGateErr = acceptanceGateError(beforePatch, req.body);
    if (patchGateErr) return res.status(422).json({ error: patchGateErr });
    const patchLegalErr = activationOwned ? null : await legalGateError(beforePatch, req.body);
    if (patchLegalErr) return res.status(422).json({ error: patchLegalErr });
    const patchCommissioningErr = await commissioningGateError(beforePatch, req.body, req.orgId);
    if (patchCommissioningErr) return res.status(422).json({ error: patchCommissioningErr });
    const sets = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => req.body[f] ?? null);
    const acceptanceStamp = touchesAcceptance(req.body) ? ', acceptance_recorded_at = NOW()' : '';
    const [result] = await writeActivationTransition({
      req,
      before: beforePatch,
      body: req.body,
      activationOwned,
      write: runner => runner.query(
        `UPDATE work_orders SET ${sets}${acceptanceStamp} WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
        [...values, req.params.id, req.orgId],
      ),
    });
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Work order not found' });
    const [[row]] = await db.query('SELECT * FROM work_orders WHERE id = ?', [req.params.id]);
    if ('assigned_to' in req.body && row.assigned_to && row.assigned_to !== beforePatch.assigned_to) {
      emitAssigned(req.orgId, row, req.user.id);
    }
    await auditLog.log({
      userId: req.user?.id, organizationId: req.orgId, action: 'update',
      tableName: 'work_orders', recordId: row.id, oldValues: beforePatch, newValues: req.body,
    });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Install test window (migration 448) — the technician's bounded internet for
// on-site testing before formal activation. Start/complete are available only
// from an assigned/in-progress installation visit attached to an in-process
// service order. End remains a broadly available safety command so dispatch
// changes cannot strand a temporary line online.
// ---------------------------------------------------------------------------
async function resolveInstallWo(req, { strict = true } = {}) {
  const [rows] = await db.query(
    `SELECT wo.*, so.id AS linked_service_order_id,
            so.status AS service_order_status,
            so.order_type AS service_order_type
       FROM work_orders wo
       LEFT JOIN service_orders so
         ON so.id = wo.service_order_id
        AND (so.organization_id = ? OR so.organization_id IS NULL)
        AND so.deleted_at IS NULL
      WHERE wo.id = ? AND wo.organization_id = ? AND wo.deleted_at IS NULL`,
    [req.orgId, req.params.id, req.orgId],
  );
  const wo = rows[0];
  if (!wo) throw new NotFoundError('Work order');
  if (wo.work_type !== 'installation' || !wo.contract_id) {
    throw new ValidationError('The test window applies to installation work orders linked to a contract');
  }
  // Closing is a safety command. Once a window is open it must remain
  // available even if dispatch later completes/cancels/unassigns the visit;
  // requirePermission still gates the caller and endWindow's pending row lock
  // prevents it from ever disabling a formally activated contract.
  if (!strict) return wo;
  if (!wo.service_order_id || !wo.linked_service_order_id
      || wo.service_order_type !== 'new_install'
      || wo.service_order_status !== 'in_process') {
    throw new ValidationError('The installation must be linked to an in-process new-install service order');
  }
  if (!['assigned', 'in_progress'].includes(wo.status) || !wo.assigned_to) {
    throw new ValidationError('The installation work order must be assigned and in assigned or in-progress status');
  }
  const canSupervise = await userHasPermission(req, 'contracts.update');
  if (!canSupervise && Number(wo.assigned_to) !== Number(req.user?.id)) {
    throw new ForbiddenError('Only the assigned technician or a contract supervisor may operate this test window');
  }
  wo.can_supervise_commissioning = canSupervise;
  return wo;
}

router.post('/:id/test-window/start', requirePermission('work_orders.update'), async (req, res, next) => {
  try {
    const wo = await resolveInstallWo(req);

    const testWindowService = require('../services/testWindowService');
    const result = await testWindowService.startWindow(wo.contract_id, {
      orgId: req.orgId,
      performedBy: req.user?.id ?? null,
      isAdmin: wo.can_supervise_commissioning,
      workOrderId: wo.id,
    });
    await auditLog.log({
      userId: req.user?.id, organizationId: req.orgId, action: 'test_window_start',
      tableName: 'contracts', recordId: wo.contract_id,
      newValues: { expires_at: result.expires_at, work_order_id: wo.id },
    }).catch(() => {});
    res.json({ data: result });
  } catch (err) { next(err); }
});

router.post('/:id/test-window/end', requirePermission('work_orders.update'), async (req, res, next) => {
  try {
    const wo = await resolveInstallWo(req, { strict: false });
    const testWindowService = require('../services/testWindowService');
    const result = await testWindowService.endWindow(wo.contract_id, {
      orgId: req.orgId, reason: 'manual',
    });
    await auditLog.log({
      userId: req.user?.id, organizationId: req.orgId, action: 'test_window_end',
      tableName: 'contracts', recordId: wo.contract_id,
      newValues: { work_order_id: wo.id },
    }).catch(() => {});
    res.json({ data: result });
  } catch (err) { next(err); }
});

// POST /work-orders/:id/test-window/complete — save the on-site measurement
// and shut the temporary line off in the same transaction.  The service locks
// and re-validates the WO, service order, contract and RADIUS account; no
// client/contract/test_source supplied by the caller can override ownership.
router.post(
  '/:id/test-window/complete',
  requirePermission('work_orders.update'),
  requirePermission('speed_tests.create'),
  validate(completeTestWindow, { strip: true }),
  async (req, res, next) => {
    try {
      const testWindowService = require('../services/testWindowService');
      const canSupervise = await userHasPermission(req, 'contracts.update');
      const result = await testWindowService.completeWindow(req.params.id, req.body, {
        orgId: req.orgId,
        performedBy: req.user?.id ?? null,
        isAdmin: canSupervise,
      });
      await auditLog.log({
        userId: req.user?.id, organizationId: req.orgId, action: 'test_window_complete',
        tableName: 'contracts', recordId: result.speed_test.contract_id,
        newValues: {
          work_order_id: Number(req.params.id),
          speed_test_id: result.speed_test.id,
          download_mbps: result.speed_test.download_mbps,
          upload_mbps: result.speed_test.upload_mbps,
        },
      }).catch(() => {});
      res.json({ data: result });
    } catch (err) { next(err); }
  },
);

// POST /work-orders/:id/commissioning-test — static/dual services have no
// RADIUS line to open. Record the same work-order-bound technician evidence
// while keeping connectivity offline until formal activation.
router.post(
  '/:id/commissioning-test',
  requirePermission('work_orders.update'),
  requirePermission('speed_tests.create'),
  validate(completeTestWindow, { strip: true }),
  async (req, res, next) => {
    try {
      const wo = await resolveInstallWo(req);

      const testWindowService = require('../services/testWindowService');
      const result = await testWindowService.recordOfflineCommissioningTest(
        req.params.id,
        req.body,
        {
          orgId: req.orgId,
          performedBy: req.user?.id ?? null,
          isAdmin: wo.can_supervise_commissioning,
        },
      );
      await auditLog.log({
        userId: req.user?.id, organizationId: req.orgId,
        action: 'commissioning_test_record', tableName: 'speed_tests',
        recordId: result.speed_test.id,
        newValues: {
          work_order_id: Number(req.params.id),
          contract_id: result.speed_test.contract_id,
          download_mbps: result.speed_test.download_mbps,
          upload_mbps: result.speed_test.upload_mbps,
        },
      }).catch(() => {});
      res.json({ data: result });
    } catch (err) { next(err); }
  },
);

// DELETE /work-orders/:id
router.delete('/:id', requirePermission('work_orders.delete'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'UPDATE work_orders SET deleted_at = NOW() WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Work order not found' });
    await auditLog.log({
      userId: req.user?.id, organizationId: req.orgId, action: 'delete',
      tableName: 'work_orders', recordId: Number(req.params.id),
    });
    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /work-orders/:id/restore
router.post('/:id/restore', requirePermission('work_orders.update'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'UPDATE work_orders SET deleted_at = NULL WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Work order not found' });
    const [[row]] = await db.query('SELECT * FROM work_orders WHERE id = ?', [req.params.id]);
    await auditLog.log({
      userId: req.user?.id, organizationId: req.orgId, action: 'restore',
      tableName: 'work_orders', recordId: row.id,
    });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// GET /work-orders/:id/materials
router.get('/:id/materials', requirePermission('work_order_materials.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM work_order_materials WHERE work_order_id = ? ORDER BY created_at ASC',
      [req.params.id],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// POST /work-orders/:id/materials
router.post('/:id/materials', requirePermission('work_order_materials.create'), async (req, res, next) => {
  try {
    const { item_name, quantity, unit, unit_cost, notes } = req.body;
    if (!item_name) return res.status(422).json({ error: 'item_name is required' });
    const [result] = await db.query(
      'INSERT INTO work_order_materials (work_order_id, item_name, quantity, unit, unit_cost, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.id, item_name, quantity || 1, unit || null, unit_cost || null, notes || null],
    );
    const [[row]] = await db.query('SELECT * FROM work_order_materials WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// DELETE /work-orders/:id/materials/:matId
router.delete('/:id/materials/:matId', requirePermission('work_order_materials.delete'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'DELETE FROM work_order_materials WHERE id = ? AND work_order_id = ?',
      [req.params.matId, req.params.id],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Material not found' });
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Equipment pickup checklist (Inventory Phase 3, migration 391) — completing
// a work_type='pickup' order asks per outstanding-rented-unit disposition.
// ---------------------------------------------------------------------------

// GET /work-orders/:id/pickup-items — the outstanding rented-equipment
// checklist for this pickup order (computed live from cpe_devices; sold
// devices are the client's property and never appear here).
router.get('/:id/pickup-items', requirePermission('work_orders.view'), async (req, res, next) => {
  try {
    const result = await inventorySerialService.getPickupChecklist(parseInt(req.params.id, 10), req.orgId);
    res.json({ data: result.units, meta: { work_order_id: result.workOrder.id, contract_id: result.workOrder.contract_id, status: result.workOrder.status } });
  } catch (err) { next(err); }
});

// POST /work-orders/:id/pickup-items — resolve one unit's disposition
// (returned -> back in stock +1, ledger 'return'; rma -> no stock change).
// The work order auto-completes once every outstanding rented unit on its
// contract has been resolved.
router.post('/:id/pickup-items', requirePermission('work_orders.update'), validate(pickupDisposition), async (req, res, next) => {
  try {
    const device = await inventorySerialService.completePickupUnit({
      workOrderId: parseInt(req.params.id, 10),
      cpeDeviceId: req.body.cpe_device_id,
      disposition: req.body.disposition,
      notes: req.body.notes || null,
      orgId: req.orgId,
      performedBy: req.user?.id || null,
    });
    res.json({ data: device });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Work order attachments (§12.3 — installation photos)
// ---------------------------------------------------------------------------
router.get('/:id/attachments', requirePermission('work_order_attachments.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT id, filename, original_filename, mime_type, file_size, uploaded_by, created_at FROM work_order_attachments WHERE work_order_id = ? AND organization_id = ? ORDER BY created_at DESC',
      [req.params.id, req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/:id/attachments', requirePermission('work_order_attachments.create'), uploadAttachment, async (req, res, next) => {
  try {
    if (!req.file) return res.status(422).json({ error: 'No file uploaded' });
    const [result] = await db.query(
      'INSERT INTO work_order_attachments (work_order_id, filename, original_filename, mime_type, file_size, storage_path, uploaded_by, organization_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      // Relative to STORAGE_ROOT, matching clients.js and files.js — see the
      // note on the ticket-attachment insert.
      [req.params.id, req.file.filename, req.file.originalname, attachmentMimeType(req.file.originalname), req.file.size,
        path.relative(STORAGE_ROOT, req.file.path), req.user.id, req.orgId],
    );
    const [[row]] = await db.query('SELECT id, filename, original_filename, mime_type, file_size, uploaded_by, created_at FROM work_order_attachments WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

router.delete('/:id/attachments/:attachmentId', requirePermission('work_order_attachments.delete'), async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      'SELECT storage_path FROM work_order_attachments WHERE id = ? AND work_order_id = ? AND organization_id = ?',
      [req.params.attachmentId, req.params.id, req.orgId],
    );
    if (!row) return res.status(404).json({ error: 'Attachment not found' });
    await db.query('DELETE FROM work_order_attachments WHERE id = ?', [req.params.attachmentId]);
    const abs = resolveStoredPath(row.storage_path);
    if (abs) fs.unlink(abs, () => {});
    res.status(204).end();
  } catch (err) { next(err); }
});

router.get('/:id/attachments/:attachmentId/download', requirePermission('work_order_attachments.view'), async (req, res, next) => {
  try {
    const [[row]] = await db.query(
      'SELECT * FROM work_order_attachments WHERE id = ? AND work_order_id = ? AND organization_id = ?',
      [req.params.attachmentId, req.params.id, req.orgId],
    );
    if (!row) return res.status(404).json({ error: 'Attachment not found' });
    const abs = resolveStoredPath(row.storage_path);
    if (!abs) return res.status(404).json({ error: 'Attachment file not found' });
    res.setHeader('Content-Disposition', contentDispositionAttachment(row.original_filename));
    res.setHeader('Content-Type', row.mime_type);
    res.sendFile(abs);
  } catch (err) { next(err); }
});

module.exports = router;
