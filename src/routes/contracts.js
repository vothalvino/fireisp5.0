// =============================================================================
// FireISP 5.0 — Contract Routes
// =============================================================================

const { Router } = require('express');
const Contract = require('../models/Contract');
const Client = require('../models/Client');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission, userHasPermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createContract, updateContract, patchContract, createContractAddon,
  prepareContractActivation, activateContract,
} = require('../middleware/schemas/contracts');
const db = require('../config/database');
const suspensionService = require('../services/suspensionService');
const inventorySerialService = require('../services/inventorySerialService');
const topologyContextService = require('../services/topologyContextService');
const provisioningService = require('../services/subscriberProvisioningService');
const routerProvisioningService = require('../services/routerProvisioningService');
const contractActivationService = require('../services/contractActivationService');
const mxRegisteredTemplateService = require('../services/mxRegisteredContractTemplateService');
const testWindowService = require('../services/testWindowService');
const { assertPlanSelectable } = require('../services/planAvailability');
const Nas = require('../models/Nas');
const auditLog = require('../services/auditLog');
const { ValidationError, ForbiddenError } = require('../utils/errors');
const logger = require('../utils/logger').child({ service: 'routes/contracts' });

const router = Router();
const ctrl = crudController(Contract);

const ACTIVATION_FROZEN_FIELDS = new Set([
  'client_id', 'plan_id', 'contract_template_mx_id', 'mx_contract_environment', 'connection_type',
  'start_date', 'end_date', 'billing_day', 'price_override', 'ip_address',
  'facturar', 'status',
]);

async function activationProjectionPermissions(req) {
  const [
    includeDocuments, canViewServiceOrders, canViewWorkOrders,
    canUpdateContracts, includeSpeedTest,
  ] = await Promise.all([
    userHasPermission(req, 'signed_documents.view'),
    userHasPermission(req, 'service_orders.view'),
    userHasPermission(req, 'work_orders.view'),
    userHasPermission(req, 'contracts.update'),
    userHasPermission(req, 'speed_tests.view'),
  ]);
  return {
    includeDocuments,
    includeServiceOrder: canViewServiceOrders || canUpdateContracts,
    includeWorkOrder: canViewWorkOrders || canUpdateContracts,
    includeSpeedTest,
  };
}

function comparableContractValue(field, value) {
  if (value === null || value === undefined || value === '') return null;
  if (field === 'start_date' || field === 'end_date') {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
  }
  if (['client_id', 'plan_id', 'contract_template_mx_id', 'billing_day', 'price_override'].includes(field)) {
    const numeric = Number(value);
    return Number.isNaN(numeric) ? String(value) : numeric;
  }
  if (field === 'facturar') return Number(Boolean(Number(value)));
  return String(value);
}

async function assertFacturarJurisdiction(body, orgId, runner = db, organization = null) {
  if (body.facturar !== true && Number(body.facturar) !== 1) return;
  if (orgId === null || orgId === undefined) {
    throw new ValidationError('facturar is available only for Mexican organizations');
  }
  let resolvedOrganization = organization;
  if (!resolvedOrganization) {
    const [rows] = await runner.query(
      'SELECT locale FROM organizations WHERE id = ? LIMIT 1',
      [orgId],
    );
    [resolvedOrganization] = rows;
  }
  if (resolvedOrganization?.locale !== 'MX') {
    throw new ValidationError('facturar is available only for Mexican organizations');
  }
}

async function updateContractWithActivationGuard(contract, body, orgId) {
  const touched = [...ACTIVATION_FROZEN_FIELDS].filter(field => body[field] !== undefined);
  if (!touched.length || Object.prototype.hasOwnProperty.call(body, 'organization_id')) {
    return Contract.update(contract.id, body, orgId);
  }

  const filtered = {};
  for (const field of Contract.fillable) {
    if (field !== 'organization_id' && body[field] !== undefined) filtered[field] = body[field];
  }
  const columns = Object.keys(filtered);
  if (!columns.length) return Contract.findByIdOrFail(contract.id, orgId);

  // One conditional UPDATE is the concurrency boundary: prepare locks the
  // contract before creating its order, while this statement locks/updates the
  // contract only when there is no prepared installation OR every supplied
  // activation field is unchanged. Including `new` orders closes the small
  // prepare-commit -> start gap; a stale PUT cannot slip in between the old
  // SELECT and Contract.update and change the values the order will activate.
  const sets = columns.map(field => `\`${field}\` = ?`).join(', ');
  const unchanged = touched.map(field => `\`${field}\` <=> ?`).join(' AND ');
  const params = [
    ...columns.map(field => filtered[field]),
    contract.id,
    orgId,
    ...touched.map(field => comparableContractValue(field, body[field])),
  ];
  const [result] = await db.query(
    `UPDATE \`contracts\`
        SET ${sets}
      WHERE id = ? AND organization_id = ? AND deleted_at IS NULL
        AND (
          NOT EXISTS (
            SELECT 1 FROM service_orders so
             WHERE so.contract_id = \`contracts\`.id
               AND so.organization_id = \`contracts\`.organization_id
               AND so.order_type = 'new_install'
               AND so.status IN ('new','in_process')
               AND so.deleted_at IS NULL
          )
          OR (${unchanged})
        )`,
    params,
  );
  const current = await Contract.findByIdOrFail(contract.id, orgId);
  if (result.affectedRows === 0) {
    const changed = touched.filter(field =>
      comparableContractValue(field, body[field]) !== comparableContractValue(field, current[field]));
    if (changed.length) {
      throw new ValidationError(
        `Finish or cancel the prepared/in-process installation before changing activation fields: ${changed.join(', ')}`,
      );
    }
  }
  return current;
}

router.use(authenticate);
router.use(orgScope);

/**
 * Shared handler for PUT/PATCH: validates static-IP uniqueness, applies the
 * update, and provisions a new IPv6 line when the connection type is upgraded
 * from IPv4-only to dual-stack (IPv4 -> DUAL).
 */
async function updateContractHandler(req, res, next) {
  let retainedCleanup = null;
  try {
    const old = await Contract.findByIdOrFail(req.params.id, req.orgId);
    if (Object.prototype.hasOwnProperty.call(req.body, 'mx_contract_environment')) {
      throw new ValidationError(
        'mx_contract_environment is server-managed and immutable; create a new contract in the other environment',
      );
    }
    await assertFacturarJurisdiction(req.body, req.orgId);

    // No generic form may turn service on. Each source status has a dedicated
    // route whose side effects and evidence requirements cannot be represented
    // by a status dropdown.
    if (req.body.status === 'active' && old.status !== 'active') {
      if (old.status === 'pending') {
        throw new ValidationError('Activate pending service from the contract activation flow after the technician test and client signature');
      }
      if (old.status === 'suspended') {
        throw new ValidationError('Use the contract unsuspend action to restore suspended service');
      }
      throw new ValidationError('Use the contract renew action to reactivate a cancelled, expired, or terminated contract');
    }
    if (req.body.status === 'pending' && old.status !== 'pending') {
      throw new ValidationError(
        'Only the renew or reconnect workflow can return previously closed service to pending activation',
      );
    }

    if (req.body.connection_type !== undefined
        && req.body.connection_type !== old.connection_type) {
      const oldUsesRadius = provisioningService.isPppoe(old.connection_type);
      const newUsesRadius = provisioningService.isPppoe(req.body.connection_type);
      if (oldUsesRadius !== newUsesRadius) {
        throw new ValidationError(
          'Changing between PPPoE and static service families requires a dedicated reprovisioning workflow',
        );
      }
    }

    // Reject duplicate static IPs before mutating the contract.
    if (req.body.ip_address && req.body.ip_address !== old.ip_address) {
      await provisioningService.assertIpAvailable(db, {
        ip: req.body.ip_address,
        organizationId: req.orgId,
        excludeContractId: old.id,
      });
    }

    // Block MOVING a contract onto an archived plan, or one belonging to a
    // different organization. Keeping its current plan is always fine — even
    // if that plan has since been archived.
    if (req.body.plan_id !== undefined && Number(req.body.plan_id) !== Number(old.plan_id)) {
      await assertPlanSelectable(db, req.body.plan_id, req.orgId);
    }

    if (req.body.contract_template_mx_id !== undefined) {
      const changesRegisteredSource = Number(req.body.contract_template_mx_id)
        !== Number(old.contract_template_mx_id);
      const initializesFrozenEnvironment = !old.mx_contract_environment;
      const changesFrozenSnapshot = changesRegisteredSource || initializesFrozenEnvironment;
      if (old.first_activated_at && changesFrozenSnapshot) {
        throw new ValidationError(
          'The registered MX contract template is immutable after first activation; use a dedicated re-contracting and signature workflow',
        );
      }
      // Migration 452 initializes every source-linked legacy row. A remaining
      // NULL lane is therefore unclassified/corrupt history. Do not let a
      // generic PATCH choose its provenance based on a mode read that can race
      // the environment switch; cancel it and create a correctly classified
      // contract through the normal flow instead.
      if (initializesFrozenEnvironment) {
        throw new ValidationError(
          'This legacy contract has no frozen MX environment and cannot be initialized by PATCH; cancel it and create a new classified contract',
        );
      }
      if (changesFrozenSnapshot) {
        if (old.status !== 'pending') {
          throw new ValidationError(
            'The registered MX contract template can only be initialized or changed while the contract is pending',
          );
        }
        const [documentHistory] = await db.query(
          `SELECT id
             FROM signed_documents
            WHERE organization_id = ? AND contract_id = ?
            LIMIT 1`,
          [req.orgId, old.id],
        );
        if (documentHistory.length) {
          throw new ValidationError(
            'The registered MX contract template is immutable after contract documents have been generated; use a dedicated re-contracting and signature workflow',
          );
        }
      }
      if (!old.first_activated_at) {
        const activeMxSource = await mxRegisteredTemplateService.resolveActiveContractSource(
          db.query.bind(db),
          {
            orgId: req.orgId,
            contractTemplateMxId: req.body.contract_template_mx_id,
            contractEnvironment: old.mx_contract_environment || undefined,
          },
        );
        // Optional validation permits an explicit null. Normalize every
        // pre-activation request to the authoritative active source so
        // PATCH {contract_template_mx_id:null} cannot clear an MX contract;
        // global organizations deliberately normalize to null.
        req.body.contract_template_mx_id = activeMxSource?.contractTemplateMxId ?? null;
        if (old.mx_contract_environment
            && activeMxSource?.contractEnvironment !== old.mx_contract_environment) {
          throw new ValidationError(
            'The registered source must remain in the contract\'s frozen MX environment',
          );
        }
        // This is an internal coupled snapshot write; client-supplied values
        // were rejected above and the already-frozen lane is preserved.
        req.body.mx_contract_environment = old.mx_contract_environment;
      }
    }

    // Block MOVING a contract onto another organization's client (security
    // hardening — mirrors serviceOrders.js#assertServiceOrderFks, PR #388).
    // Keeping its current client_id is always fine, even if that client were
    // somehow already wrong. Without this, PUT/PATCH {client_id: <foreign>}
    // silently reassigned the contract cross-tenant, exposing that client's
    // PII on the response.
    if (req.body.client_id !== undefined && Number(req.body.client_id) !== Number(old.client_id)) {
      const client = await Client.findById(req.body.client_id, req.orgId);
      if (!client) throw new ValidationError('client_id does not belong to this organization');
    }

    // A pending PPPoE line must be quiesced before a state/type mutation even
    // when it predates test-window markers: legacy provisioning may already
    // have pushed an unbounded RouterOS local secret. The durable marker stays
    // set until this mutation finishes and external cleanup is confirmed.
    const changesStatus = req.body.status !== undefined && req.body.status !== old.status;
    const changesType = req.body.connection_type !== undefined
      && req.body.connection_type !== old.connection_type;
    const hasWindowState = old.test_window_expires_at
      || Number(old.test_window_cleanup_pending) === 1;
    const legacyPendingPppoeShutdown = old.status === 'pending'
      && provisioningService.isPppoe(old.connection_type);
    if (old.status !== 'active'
        && (hasWindowState || legacyPendingPppoeShutdown)
        && (changesStatus || changesType)) {
      retainedCleanup = await testWindowService.closeForContractMutation(old.id, {
        orgId: req.orgId,
        reason: changesStatus ? 'contract_status_change' : 'contract_connection_type_change',
      });
    }

    const record = await updateContractWithActivationGuard(old, req.body, req.orgId);
    if (retainedCleanup?.prepared
        && retainedCleanup.nas_disabled !== false
        && retainedCleanup.disconnect_confirmed === true) {
      await testWindowService.releaseCleanupMarker(old.id, { orgId: req.orgId });
      retainedCleanup = null;
    }

    // Generic transitions that turn service OFF retain their historical
    // RADIUS/audit side effects. All transitions INTO active were removed
    // above and belong to /activate, /unsuspend, or /renew.
    if (req.body.status !== undefined && req.body.status !== old.status) {
      const newStatus = req.body.status;
      if (newStatus === 'suspended') {
        await db.query(
          "UPDATE radius SET status = 'suspended' WHERE contract_id = ? AND deleted_at IS NULL AND status = 'active'",
          [record.id],
        );
        let coaSent = false;
        let coaResponse = null;
        try {
          const r = await suspensionService.sendRadiusDisconnect(record.id);
          coaSent = r.sent;
          coaResponse = r.response;
        } catch (_e) {
          coaResponse = 'CoA send failed';
        }
        try {
          await suspensionService.logSuspensionEvent(db.query.bind(db), {
            contractId: record.id,
            action: 'suspended',
            reason: `manual status change to 'suspended' via contract update (user #${req.user.id})`,
            triggeredByValue: 'manual',
            userId: req.user.id,
            coaSent,
            coaResponse,
          });
        } catch (logErr) {
          logger.error({ err: logErr.message, contractId: record.id }, 'Failed to write suspension_logs row for contract-update suspend');
        }
      } else if (['terminated', 'cancelled', 'expired'].includes(newStatus)) {
        await db.query(
          "UPDATE radius SET status = 'inactive' WHERE contract_id = ? AND deleted_at IS NULL",
          [record.id],
        );
        suspensionService.sendRadiusDisconnect(record.id).catch(() => {});
        // Inventory Phase 3 (migration 391): if this contract still has
        // rented equipment out (ownership='rented', assigned/active), auto-
        // create a technician pickup follow-up — idempotent, and never lets
        // a failure here block the status change that already committed.
        inventorySerialService.ensurePickupWorkOrder(record.id, { orgId: req.orgId, performedBy: req.user?.id || null })
          .catch(err => logger.error({ err: err.message, contractId: record.id }, 'Failed to auto-create equipment pickup work order'));
      }
    }

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
  } catch (err) {
    // If network cleanup succeeded but the business mutation failed, the line
    // is safely down and the retained concurrency marker can be released.
    if (retainedCleanup?.prepared
        && retainedCleanup.nas_disabled !== false
        && retainedCleanup.disconnect_confirmed === true) {
      await testWindowService.releaseCleanupMarker(req.params.id, { orgId: req.orgId }).catch(() => {});
    }
    next(err);
  }
}

router.get('/', requirePermission('contracts.view'), ctrl.list);
router.get('/:id', requirePermission('contracts.view'), ctrl.get);
router.get('/:id/activation', requirePermission('contracts.view'), async (req, res, next) => {
  try {
    const projection = await activationProjectionPermissions(req);
    const state = await contractActivationService.getActivationState(req.params.id, {
      orgId: req.orgId,
      ...projection,
    });
    res.json({ data: state });
  } catch (err) { next(err); }
});
router.post(
  '/:id/activation/retry-network',
  requirePermission('contracts.update'),
  async (req, res, next) => {
    try {
      const result = await contractActivationService.retryNetworkActivation(req.params.id, {
        orgId: req.orgId,
      });
      await auditLog.log({
        userId: req.user?.id, organizationId: req.orgId,
        action: 'activation_network_retry', tableName: Contract.tableName,
        recordId: Number(req.params.id),
        newValues: {
          service_order_id: result.service_order_id,
          radius_id: result.radius_id,
          nas_id: result.nas_id,
          success: result.success,
        },
      }).catch(() => {});
      res.json({ data: result });
    } catch (err) { next(err); }
  },
);
router.post(
  '/:id/activation/prepare',
  requirePermission('contracts.update'),
  validate(prepareContractActivation, { strip: true }),
  async (req, res, next) => {
    try {
      const canStartInstallation = await userHasPermission(req, 'installations.start');
      if (!canStartInstallation) {
        throw new ForbiddenError('Preparing a new installation requires installations.start');
      }
      const projection = await activationProjectionPermissions(req);
      const state = await contractActivationService.prepareActivation(req.params.id, {
        orgId: req.orgId,
        userId: req.user?.id ?? null,
        assignedTo: req.body.assigned_to ?? null,
        canStartInstallation,
        ...projection,
      });
      await auditLog.log({
        userId: req.user?.id, organizationId: req.orgId,
        action: 'activation_prepare', tableName: Contract.tableName,
        recordId: Number(req.params.id),
        newValues: {
          service_order_id: state.service_order?.id || null,
          work_order_id: state.work_order?.id || null,
          assigned_to: req.body.assigned_to ?? null,
        },
      }).catch(() => {});
      res.json({ data: state });
    } catch (err) { next(err); }
  },
);
router.post(
  '/:id/activate',
  requirePermission('contracts.update'),
  validate(activateContract, { strip: true }),
  async (req, res, next) => {
    try {
      const canCreateInvoice = req.body.billing !== 'create_invoice'
        || await userHasPermission(req, 'invoices.create');
      if (!canCreateInvoice) {
        throw new ForbiddenError('Creating an installation invoice requires invoices.create');
      }
      const projection = await activationProjectionPermissions(req);
      const state = await contractActivationService.activate(req.params.id, {
        orgId: req.orgId,
        userId: req.user?.id ?? null,
        billing: req.body.billing,
        installationFee: req.body.installation_fee,
        description: req.body.description,
        canCreateInvoice,
        ...projection,
      });
      await auditLog.log({
        userId: req.user?.id, organizationId: req.orgId,
        action: 'activate', tableName: Contract.tableName,
        recordId: Number(req.params.id),
        newValues: {
          status: state.status,
          service_order_id: state.service_order?.id || null,
          invoice_id: state.invoice?.id || null,
        },
      }).catch(() => {});
      res.json({ data: state });
    } catch (err) { next(err); }
  },
);
router.post(
  '/:id/activation/cancel',
  requirePermission('contracts.update'),
  async (req, res, next) => {
    try {
      const projection = await activationProjectionPermissions(req);
      const state = await contractActivationService.cancelActivation(req.params.id, {
        orgId: req.orgId,
        ...projection,
      });
      await auditLog.log({
        userId: req.user?.id,
        organizationId: req.orgId,
        action: 'cancel_activation',
        tableName: Contract.tableName,
        recordId: Number(req.params.id),
        newValues: state.cancellation,
      }).catch(() => {});
      res.json({ data: state });
    } catch (err) { next(err); }
  },
);
router.post('/', requirePermission('contracts.create'), validate(createContract), async (req, res, next) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    if (req.orgId) req.body.organization_id = req.orgId;
    if (Object.prototype.hasOwnProperty.call(req.body, 'mx_contract_environment')) {
      throw new ValidationError('mx_contract_environment is server-managed');
    }
    // Take the same organization/profile lock used by locale changes and the
    // contract-environment switch before any locale-dependent validation.
    // The later source resolver reuses the transaction and may safely lock the
    // same rows again; no stale MX check can commit after a locale change.
    const lockedOrganization = await mxRegisteredTemplateService
      .loadOrganizationContractEnvironment(conn.query.bind(conn), {
        orgId: req.orgId,
        lock: true,
      });
    if (!lockedOrganization) throw new ValidationError('Contract organization does not exist');
    await assertFacturarJurisdiction(
      req.body,
      req.orgId,
      conn,
      lockedOrganization,
    );

    // Build the contract insert from fillable columns (transactional write).
    const filtered = {};
    for (const key of Contract.fillable) {
      if (req.body[key] !== undefined) filtered[key] = req.body[key];
    }
    // The line remains offline until the activation workflow proves the
    // technician test + acceptance (+ MX signatures where applicable).
    filtered.status = 'pending';

    // Reject duplicate static IPs before creating the contract.
    if (filtered.ip_address) {
      await provisioningService.assertIpAvailable(conn, {
        ip: filtered.ip_address,
        organizationId: req.orgId,
      });
    }

    // A new contract may only run on a live (non-archived) plan that belongs
    // to this organization, or a global plan (organization_id IS NULL).
    await assertPlanSelectable(conn, filtered.plan_id, req.orgId);

    const activeMxSource = await mxRegisteredTemplateService.resolveActiveContractSource(
      conn.query.bind(conn),
      {
        orgId: req.orgId,
        contractTemplateMxId: filtered.contract_template_mx_id,
        lock: true,
      },
    );
    if (activeMxSource) {
      filtered.contract_template_mx_id = activeMxSource.contractTemplateMxId;
      filtered.mx_contract_environment = activeMxSource.contractEnvironment;
    } else {
      delete filtered.contract_template_mx_id;
      delete filtered.mx_contract_environment;
    }

    // Reject a client_id that does not belong to this organization (security
    // hardening — mirrors serviceOrders.js#assertServiceOrderFks, PR #388).
    // Without this, a contract could be created against another
    // organization's client, exposing that client's PII on the response and
    // — for pppoe contracts — provisioning a live RADIUS account bound to a
    // foreign client.
    if (filtered.client_id !== undefined) {
      const client = await Client.findById(filtered.client_id, req.orgId);
      if (!client) throw new ValidationError('client_id does not belong to this organization');
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
  let retainedCleanup = null;
  try {
    const old = await Contract.findByIdOrFail(req.params.id, req.orgId);
    if (!['cancelled', 'terminated', 'expired'].includes(old.status)) {
      if (old.status === 'pending') {
        throw new ValidationError(
          'Cancel the pending activation before deleting this contract',
        );
      }
      throw new ValidationError(
        'Terminate live or suspended service before deleting this contract',
      );
    }
    if (old.status !== 'active'
        && (old.test_window_expires_at
          || Number(old.test_window_cleanup_pending) === 1
          || provisioningService.isPppoe(old.connection_type))) {
      retainedCleanup = await testWindowService.closeForContractMutation(old.id, {
        orgId: req.orgId,
        reason: 'contract_delete',
      });
    }
    await Contract.delete(req.params.id, req.orgId);
    if (retainedCleanup?.prepared
        && retainedCleanup.nas_disabled !== false
        && retainedCleanup.disconnect_confirmed === true) {
      await testWindowService.releaseCleanupMarker(old.id, { orgId: req.orgId });
      retainedCleanup = null;
    }
    topologyContextService.invalidate(old.id, 'contract')
      .catch(err => logger.warn({ err: err.message, contractId: old.id }, 'topology invalidate failed on contract delete'));
    res.status(204).send();
  } catch (err) {
    if (retainedCleanup?.prepared
        && retainedCleanup.nas_disabled !== false
        && retainedCleanup.disconnect_confirmed === true) {
      await testWindowService.releaseCleanupMarker(req.params.id, { orgId: req.orgId }).catch(() => {});
    }
    next(err);
  }
});
router.post('/:id/restore', requirePermission('contracts.update'), async (req, res, next) => {
  try {
    const [archivedRows] = await db.query(
      `SELECT * FROM contracts
        WHERE id = ? AND organization_id = ? AND deleted_at IS NOT NULL
        LIMIT 1`,
      [req.params.id, req.orgId],
    );
    if (archivedRows[0]) {
      await mxRegisteredTemplateService.assertSandboxContractCanResume(
        db.query.bind(db),
        { contract: archivedRows[0], context: 'Archived contract' },
      );
    }
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
    const outcome = await suspensionService.reconnectContract(
      parseInt(req.params.id, 10),
      req.user.id,
      req.body.invoice_id || null,
      { orgId: req.orgId },
    );
    res.json({
      data: outcome || {
        contract_id: parseInt(req.params.id, 10), status: 'active', activation_required: false,
      },
    });
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
    // A renewal may not move the contract onto an archived plan, or one
    // belonging to a different organization (keeping the current plan,
    // archived or not, is fine).
    if (req.body.plan_id && Number(req.body.plan_id) !== Number(contract.plan_id)) {
      await assertPlanSelectable(db, req.body.plan_id, req.orgId);
    }

    // A terminal/suspended contract with no first-activation marker was never
    // legitimately live (for example: pending -> cancelled). Reinstating it
    // directly would bypass commissioning, acceptance, and—on MX tenants—the
    // client's signatures. Shut down any leftover test/NAS credentials, move
    // it back to pending through the explicit FSM edge, and hand it back to
    // the guided activation flow. Existing/imported subscribers carry the
    // durable marker and continue through the ordinary direct-renew path.
    if (!contract.first_activated_at) {
      await mxRegisteredTemplateService.assertSandboxContractCanResume(
        db.query.bind(db),
        { contract, context: 'Contract renewal' },
      );
      const pppoe = provisioningService.isPppoe(contract.connection_type);
      // A never-activated terminal PPPoE record may be a pre-window legacy
      // line with a local RouterOS secret despite carrying no marker. Always
      // run the idempotent shutdown before reopening it for commissioning.
      if (pppoe) {
        await testWindowService.cleanupMarkedWindow(contract.id, {
          orgId: req.orgId,
          reason: 'first_activation_reset',
          requireMarker: false,
        });
      }
      if (pppoe) {
        await db.query(
          `UPDATE radius SET status = 'inactive'
            WHERE contract_id = ? AND deleted_at IS NULL`,
          [contract.id],
        );
      }

      const resetSets = ["status = 'pending'"];
      const resetParams = [];
      if (!pppoe) {
        resetSets.push('test_window_expires_at = NULL');
        resetSets.push('test_window_cleanup_pending = 0');
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'end_date')) {
        resetSets.push('end_date = ?');
        resetParams.push(updates.end_date);
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'plan_id')) {
        resetSets.push('plan_id = ?');
        resetParams.push(updates.plan_id);
      }
      const [reset] = await db.query(
        `UPDATE contracts SET ${resetSets.join(', ')}
          WHERE id = ? AND organization_id = ? AND status = ?
            AND first_activated_at IS NULL AND deleted_at IS NULL
            AND ${mxRegisteredTemplateService.sandboxResumeSqlPredicate('contracts')}`,
        [...resetParams, contract.id, req.orgId, contract.status],
      );
      if (reset.affectedRows !== 1) {
        await mxRegisteredTemplateService.assertSandboxContractCanResume(
          db.query.bind(db),
          { contract, context: 'Contract renewal' },
        );
        throw new ValidationError('Contract renewal was modified concurrently — reload and retry');
      }
      const record = await Contract.findByIdOrFail(contract.id, req.orgId);
      await auditLog.log({
        userId: req.user?.id,
        organizationId: req.orgId,
        action: 'renew_activation_reset',
        tableName: Contract.tableName,
        recordId: record.id,
        oldValues: { status: contract.status, first_activated_at: null },
        newValues: { ...updates, status: 'pending', activation_required: true },
      }).catch(() => {});
      return res.json({
        data: { ...record, activation_required: true },
        activation_required: true,
      });
    }

    const renewal = await contractActivationService.renewPreviouslyActivated(contract.id, {
      orgId: req.orgId,
      endDate: Object.prototype.hasOwnProperty.call(updates, 'end_date')
        ? updates.end_date
        : undefined,
      planId: Object.prototype.hasOwnProperty.call(updates, 'plan_id')
        ? updates.plan_id
        : undefined,
    });
    const record = renewal.contract;
    const provisioning = renewal.provisioning;
    await auditLog.log({
      userId: req.user?.id,
      organizationId: req.orgId,
      action: 'renew',
      tableName: Contract.tableName,
      recordId: record.id,
      oldValues: { status: contract.status },
      newValues: {
        ...updates,
        radius_reprovisioned: Boolean(provisioning),
        network_activation: renewal.network_activation,
      },
    }).catch(() => {});
    // When a RADIUS account was recreated, return its (fresh) credentials so the
    // operator can reconfigure the subscriber's CPE.
    res.json({
      data: { ...record, activation_required: false },
      activation_required: false,
      network_activation: renewal.network_activation,
      ...(provisioning && provisioning.pppoe ? { provisioning } : {}),
    });
  } catch (err) { next(err); }
});

// Regenerate the PPPoE credentials (rotate the password) for a contract's RADIUS
// account. The username is kept stable; a fresh cleartext password is generated,
// stored, and — best-effort — pushed to the subscriber's NAS (RouterOS direct-API
// devices). The new credentials are returned so the operator can reconfigure the
// subscriber's CPE. Use /renew to (re)provision an account that does not exist yet.
router.post('/:id/regenerate-pppoe', requirePermission('contracts.update'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM contracts WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    const contract = rows[0];
    if (!contract) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contract not found' } });
    }
    if (contract.connection_type !== 'pppoe' && contract.connection_type !== 'pppoe_dual') {
      return res.status(422).json({ error: { code: 'NOT_PPPOE', message: 'Contract is not a PPPoE contract' } });
    }

    const [radRows] = await db.query(
      'SELECT * FROM radius WHERE contract_id = ? AND deleted_at IS NULL LIMIT 1',
      [contract.id],
    );
    const radius = radRows[0];
    if (!radius) {
      return res.status(422).json({
        error: { code: 'NO_PPPOE_ACCOUNT', message: 'This contract has no PPPoE account. Renew the contract to provision one.' },
      });
    }

    const password = provisioningService.generatePassword();
    await db.query('UPDATE radius SET password = ? WHERE id = ?', [password, radius.id]);

    // Best-effort: push the new secret only for formally active service. A
    // pending/suspended/terminal contract may rotate its stored credential,
    // but materialising a local RouterOS PPP secret would create an unbounded
    // network path outside the technician test-window lifecycle.
    // FreeRADIUS-SQL deployments pick the new password up on the next sync. The
    // subscriber's CPE must still be reconfigured with these credentials.
    let pushed = false;
    if (radius.nas_id && contract.status === 'active') {
      try {
        const nas = await Nas.findByIdOrFail(radius.nas_id, req.orgId);
        await routerProvisioningService.pushSubscriber(nas, {
          username: radius.username,
          password,
          profile: radius.profile,
          comment: 'FireISP radius#' + radius.id + ' contract#' + contract.id,
        });
        pushed = true;
      } catch (e) {
        logger.warn({ err: e, contractId: contract.id }, 'regenerate-pppoe: NAS push failed (best-effort)');
      }
    }

    await auditLog.log({
      userId: req.user?.id,
      organizationId: req.orgId,
      action: 'regenerate_pppoe',
      tableName: 'radius',
      recordId: radius.id,
      oldValues: {},
      newValues: { username: radius.username, pushed }, // never log the password
    }).catch(() => {});

    res.json({ data: { username: radius.username, password }, pushed });
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
    const record = await Contract.update(req.params.id, { status: 'terminated' }, req.orgId);
    // Termination is a permanent end of service — deactivate any RADIUS
    // account tied to this contract so it stops authenticating NEW PPPoE
    // sessions (mirrors lifecycleService.cancelOrder's pending->cancelled
    // flip). Unconditional (not guarded by current radius status), same as
    // cancelOrder. Previously this route reused suspensionService.suspendContract
    // purely for its CoA-disconnect side effect, which incorrectly also set
    // contracts.status back to 'suspended' (immediately overwritten below) and
    // logged a misleading 'suspend' suspension_logs entry for what is actually
    // a terminate — replaced with a direct radius flip + CoA disconnect.
    await db.query(
      "UPDATE radius SET status = 'inactive' WHERE contract_id = ? AND deleted_at IS NULL",
      [req.params.id],
    );
    // Fire RADIUS disconnect best-effort (don't fail the terminate if CoA fails)
    suspensionService.sendRadiusDisconnect(parseInt(req.params.id, 10)).catch(() => {});
    // Inventory Phase 3 (migration 391) — see updateContractHandler's identical hook.
    inventorySerialService.ensurePickupWorkOrder(record.id, { orgId: req.orgId, performedBy: req.user?.id || null })
      .catch(err => logger.error({ err: err.message, contractId: record.id }, 'Failed to auto-create equipment pickup work order'));
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
