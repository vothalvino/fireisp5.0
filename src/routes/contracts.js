// =============================================================================
// FireISP 5.0 — Contract Routes
// =============================================================================

const { Router } = require('express');
const Contract = require('../models/Contract');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createContract, updateContract, patchContract, createContractAddon } = require('../middleware/schemas/contracts');
const db = require('../config/database');
const suspensionService = require('../services/suspensionService');
const topologyContextService = require('../services/topologyContextService');
const provisioningService = require('../services/subscriberProvisioningService');
const auditLog = require('../services/auditLog');
const logger = require('../utils/logger').child({ service: 'routes/contracts' });

const router = Router();
const ctrl = crudController(Contract);

router.use(authenticate);
router.use(orgScope);

/**
 * Shared handler for PUT/PATCH: validates static-IP uniqueness, applies the
 * update, and provisions a new IPv6 line when the connection type is upgraded
 * from IPv4-only to dual-stack (IPv4 -> DUAL).
 */
async function updateContractHandler(req, res, next) {
  try {
    const old = await Contract.findByIdOrFail(req.params.id, req.orgId);

    // Reject duplicate static IPs before mutating the contract.
    if (req.body.ip_address && req.body.ip_address !== old.ip_address) {
      await provisioningService.assertIpAvailable(db, {
        ip: req.body.ip_address,
        organizationId: req.orgId,
        excludeContractId: old.id,
      });
    }

    const record = await Contract.update(req.params.id, req.body, req.orgId);

    await auditLog.log({
      userId: req.user?.id,
      organizationId: req.orgId,
      action: 'update',
      tableName: Contract.tableName,
      recordId: record.id,
      oldValues: old,
      newValues: req.body,
    }).catch(() => {});

    let provisioning;
    const newType = req.body.connection_type;
    if (provisioningService.isIpv4ToDualUpgrade(old.connection_type, newType)) {
      provisioning = await provisioningService.enableIpv6Line(db, record);
    }

    topologyContextService.invalidate(record.id, 'contract')
      .catch(err => logger.warn({ err: err.message, contractId: record.id }, 'topology invalidate failed on contract update'));

    res.json({ data: provisioning ? { ...record, provisioning } : record });
  } catch (err) { next(err); }
}

router.get('/', requirePermission('contracts.view'), ctrl.list);
router.get('/:id', requirePermission('contracts.view'), ctrl.get);
router.post('/', requirePermission('contracts.create'), validate(createContract), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    if (req.orgId) req.body.organization_id = req.orgId;

    // Build the contract insert from fillable columns (transactional write).
    const filtered = {};
    for (const key of Contract.fillable) {
      if (req.body[key] !== undefined) filtered[key] = req.body[key];
    }

    // Reject duplicate static IPs before creating the contract.
    if (filtered.ip_address) {
      await provisioningService.assertIpAvailable(conn, {
        ip: filtered.ip_address,
        organizationId: req.orgId,
      });
    }

    const cols = Object.keys(filtered);
    const [ins] = await conn.query(
      `INSERT INTO contracts (${cols.map(c => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      Object.values(filtered),
    );
    const contractId = ins.insertId;

    // Resolve a readable username seed from the client name when available.
    let seed;
    try {
      const [clientRows] = await conn.query('SELECT name FROM clients WHERE id = ? LIMIT 1', [filtered.client_id]);
      seed = clientRows[0] && clientRows[0].name;
    } catch { /* seed is optional */ }

    const provisioning = await provisioningService.provisionNewContract(
      conn,
      { id: contractId, ...filtered },
      { seed },
    );

    await conn.commit();

    const record = await Contract.findById(contractId, req.orgId);
    await auditLog.log({
      userId: req.user?.id,
      organizationId: req.orgId,
      action: 'create',
      tableName: Contract.tableName,
      recordId: contractId,
      newValues: filtered,
    }).catch(() => {});

    res.status(201).json({ data: { ...record, provisioning } });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});
router.put('/:id', requirePermission('contracts.update'), validate(updateContract), updateContractHandler);
router.patch('/:id', requirePermission('contracts.update'), validate(patchContract), updateContractHandler);
router.delete('/:id', requirePermission('contracts.delete'), async (req, res, next) => {
  try {
    const old = await Contract.findByIdOrFail(req.params.id, req.orgId);
    await Contract.delete(req.params.id, req.orgId);
    topologyContextService.invalidate(old.id, 'contract')
      .catch(err => logger.warn({ err: err.message, contractId: old.id }, 'topology invalidate failed on contract delete'));
    res.status(204).send();
  } catch (err) { next(err); }
});
router.post('/:id/restore', requirePermission('contracts.update'), async (req, res, next) => {
  try {
    const record = await Contract.restore(req.params.id, req.orgId);
    topologyContextService.invalidate(record.id, 'contract')
      .catch(err => logger.warn({ err: err.message, contractId: record.id }, 'topology invalidate failed on contract restore'));
    res.json({ data: record });
  } catch (err) { next(err); }
});

// Contract add-ons
router.get('/:id/addons', requirePermission('contracts.view'), async (req, res, next) => {
  try {
    const addons = await Contract.getAddons(req.params.id);
    res.json({ data: addons });
  } catch (err) {
    next(err);
  }
});

// Suspend a contract and immediately kick the active RADIUS session via CoA Disconnect-Request
router.post('/:id/suspend', requirePermission('contracts.update'), async (req, res, next) => {
  try {
    const [contracts] = await db.query(
      'SELECT * FROM contracts WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (!contracts[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contract not found' } });
    }
    if (contracts[0].status === 'suspended') {
      return res.status(422).json({ error: { code: 'ALREADY_SUSPENDED', message: 'Contract is already suspended' } });
    }
    await suspensionService.suspendContract(
      parseInt(req.params.id, 10),
      req.body.rule_id || null,
      req.user.id,
      req.body.invoice_id || null,
    );
    res.json({ data: { contract_id: parseInt(req.params.id, 10), status: 'suspended' } });
  } catch (err) {
    next(err);
  }
});

// Unsuspend a contract and restore RADIUS access via CoA-Request
router.post('/:id/unsuspend', requirePermission('contracts.update'), async (req, res, next) => {
  try {
    const [contracts] = await db.query(
      'SELECT * FROM contracts WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (!contracts[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contract not found' } });
    }
    if (contracts[0].status !== 'suspended') {
      return res.status(422).json({ error: { code: 'NOT_SUSPENDED', message: 'Contract is not suspended' } });
    }
    await suspensionService.reconnectContract(
      parseInt(req.params.id, 10),
      req.user.id,
      req.body.invoice_id || null,
    );
    res.json({ data: { contract_id: parseInt(req.params.id, 10), status: 'active' } });
  } catch (err) {
    next(err);
  }
});

// Renew (reinstate) a contract — allowed from suspended, expired, cancelled, or
// terminated states. The contract-status FSM trigger permits the *->active
// transition for all of these as of migration 362; before that, renewing a
// cancelled/expired/terminated contract was rejected by the database trigger.
router.post('/:id/renew', requirePermission('contracts.update'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM contracts WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    const contract = rows[0];
    if (!contract) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contract not found' } });
    }
    const renewableStatuses = ['suspended', 'expired', 'cancelled', 'terminated'];
    if (!renewableStatuses.includes(contract.status)) {
      return res.status(422).json({
        error: { code: 'NOT_RENEWABLE', message: `Cannot renew a contract with status '${contract.status}'` },
      });
    }
    const updates = { status: 'active' };
    if (req.body.end_date !== undefined) updates.end_date = req.body.end_date || null;
    if (req.body.plan_id) updates.plan_id = req.body.plan_id;
    const record = await Contract.update(req.params.id, updates, req.orgId);
    // Restore RADIUS access for states whose service was disconnected: both
    // suspend and terminate send a RADIUS disconnect, so without this a renewed
    // (reinstated) contract would be status='active' yet still offline. The CoA
    // reconnect is best-effort — don't fail the renew if it can't be delivered.
    if (contract.status === 'suspended' || contract.status === 'terminated') {
      suspensionService
        .reconnectContract(parseInt(req.params.id, 10), req.user.id, req.body.invoice_id || null)
        .catch(() => {});
    }
    await auditLog.log({
      userId: req.user?.id,
      organizationId: req.orgId,
      action: 'renew',
      tableName: Contract.tableName,
      recordId: record.id,
      oldValues: { status: contract.status },
      newValues: updates,
    }).catch(() => {});
    res.json({ data: record });
  } catch (err) { next(err); }
});

// Terminate a contract — permanently ends service. Allowed from active or suspended.
// Sends RADIUS Disconnect-Request when terminating an active/suspended contract.
router.post('/:id/terminate', requirePermission('contracts.update'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM contracts WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    const contract = rows[0];
    if (!contract) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contract not found' } });
    }
    const terminableStatuses = ['active', 'suspended'];
    if (!terminableStatuses.includes(contract.status)) {
      return res.status(422).json({
        error: { code: 'NOT_TERMINABLE', message: `Cannot terminate a contract with status '${contract.status}'` },
      });
    }
    // Fire RADIUS disconnect best-effort (don't fail the terminate if CoA fails)
    if (contract.status === 'active' || contract.status === 'suspended') {
      suspensionService.suspendContract(
        parseInt(req.params.id, 10), null, req.user.id, null,
      ).catch(() => {});
    }
    const record = await Contract.update(req.params.id, { status: 'terminated' }, req.orgId);
    await auditLog.log({
      userId: req.user?.id,
      organizationId: req.orgId,
      action: 'terminate',
      tableName: Contract.tableName,
      recordId: record.id,
      oldValues: { status: contract.status },
      newValues: { status: 'terminated' },
    }).catch(() => {});
    res.json({ data: record });
  } catch (err) { next(err); }
});

router.post('/:id/addons', requirePermission('contracts.update'), validate(createContractAddon), async (req, res, next) => {
  try {
    const { plan_addon_id, quantity, unit_price, start_date, end_date } = req.body;
    const [result] = await db.query(
      `INSERT INTO contract_addons (contract_id, plan_addon_id, quantity, unit_price, start_date, end_date, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [req.params.id, plan_addon_id, quantity || 1, unit_price, start_date, end_date],
    );
    const [rows] = await db.query('SELECT * FROM contract_addons WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
