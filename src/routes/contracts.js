// =============================================================================
// FireISP 5.0 — Contract Routes
// =============================================================================

const { Router } = require('express');
const Contract = require('../models/Contract');
const Client = require('../models/Client');
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
const routerProvisioningService = require('../services/routerProvisioningService');
const { assertPlanSelectable } = require('../services/planAvailability');
const Nas = require('../models/Nas');
const auditLog = require('../services/auditLog');
const { ValidationError } = require('../utils/errors');
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

    // Block MOVING a contract onto an archived plan, or one belonging to a
    // different organization. Keeping its current plan is always fine — even
    // if that plan has since been archived.
    if (req.body.plan_id !== undefined && Number(req.body.plan_id) !== Number(old.plan_id)) {
      await assertPlanSelectable(db, req.body.plan_id, req.orgId);
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

    const record = await Contract.update(req.params.id, req.body, req.orgId);

    // A direct PATCH/PUT status change bypasses the dedicated /suspend,
    // /unsuspend, /terminate, and /renew routes' RADIUS sync entirely — e.g.
    // the Edit Contract modal (ContractList.tsx EDIT_STATUSES) always PUTs a
    // `status` field and legally drives active<->suspended (the FSM trigger
    // permits both, and Contract.fillable + this route's own schema enum
    // allow them), and the frontend's Cancel action is a plain
    // PATCH {status:'cancelled'} (ContractList.tsx patchContractStatus).
    // Sync radius.status for EVERY status transition the FSM lets through
    // this handler, mirroring each dedicated route's own radius handling so
    // a subscriber's live/dead PPPoE state never diverges from
    // contracts.status regardless of which endpoint drove the change:
    //   -> suspended                     : radius active -> suspended (+ CoA disconnect)
    //   -> active                        : radius suspended/inactive -> active (+ CoA
    //                                       reconnect) — mirrors /renew's reactivation;
    //                                       the FSM also allows
    //                                       terminated/cancelled/expired -> active
    //                                       through this same handler, so an inactive
    //                                       account must be resurrected here too or a
    //                                       contract edited back to 'active' would stay
    //                                       silently offline (same failure mode /renew
    //                                       fixes for its own endpoint).
    //   -> terminated/cancelled/expired  : radius -> inactive (+ CoA disconnect)
    //
    // The suspended branch, and the active branch WHEN old.status was
    // actually 'suspended', ALSO write a suspension_logs row (awaiting the
    // CoA outcome first so it can be logged) — before this, an
    // active<->suspended toggle driven through this generic handler left a
    // hole in the audit trail that the dedicated /suspend and /unsuspend
    // routes (via suspensionService.suspendContract/reconnectContract) always
    // filled. A failed suspension_logs write must never fail the request
    // (the contract/radius state is already committed by that point) but
    // MUST be logged loudly — a silently-failing audit write is exactly the
    // bug class being fixed here. The terminated/cancelled/expired branch
    // stays log-free, matching the deliberate decision already made for
    // POST /:id/terminate below (no 'terminated' value exists in the
    // suspension_logs.action ENUM). The active branch's audit write is
    // gated on old.status === 'suspended' specifically — pending->active
    // (a brand-new contract's ordinary first activation) and
    // terminated/cancelled/expired->active are real ->active transitions
    // that sync radius exactly like a genuine reconnect, but they were
    // never suspended, so logging an 'unsuspended' row for them would be a
    // phantom zero-duration suspension polluting the audit table.
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
      } else if (newStatus === 'active') {
        await db.query(
          "UPDATE radius SET status = 'active' WHERE contract_id = ? AND deleted_at IS NULL AND status IN ('suspended', 'inactive')",
          [record.id],
        );
        let coaSent = false;
        let coaResponse = null;
        try {
          const r = await suspensionService.sendRadiusCoA(record.id, 'reconnect');
          coaSent = r.sent;
          coaResponse = r.response;
        } catch (_e) {
          coaResponse = 'CoA send failed';
        }
        // Only write (and look for) a suspension_logs audit row when the
        // contract was ACTUALLY suspended — old.status === 'suspended'. The
        // FSM also allows pending->active (a brand-new contract's normal
        // first activation via the Edit modal — the single most common path
        // through this branch) and terminated/cancelled/expired->active.
        // Neither of those is a real reconnect: without this guard,
        // closeOpenSuspensionAndGetStart finds no open row (returns null)
        // and logSuspensionEvent still fabricates an 'unsuspended' row with
        // suspended_at=NOW()/restored_at=NOW() — a phantom zero-duration
        // suspension for a contract that was never suspended, polluting the
        // suspension_logs audit/compliance table on every ordinary
        // activation. The radius sync + CoA above are unconditional and
        // unchanged — they predate this suspension-logging addition and
        // correctly cover every ->active source (suspended AND inactive).
        if (old.status === 'suspended') {
          try {
            // Closes any suspension_logs row left open by a prior /suspend
            // (or a prior suspended->active toggle through this same
            // handler) so restored_at IS NULL keeps meaning "still
            // suspended" no matter which endpoint reactivated the contract.
            const suspendedAt = await suspensionService.closeOpenSuspensionAndGetStart(db.query.bind(db), record.id);
            await suspensionService.logSuspensionEvent(db.query.bind(db), {
              contractId: record.id,
              action: 'unsuspended',
              reason: `manual status change to 'active' via contract update (user #${req.user.id})`,
              triggeredByValue: 'manual',
              userId: req.user.id,
              coaSent,
              coaResponse,
              suspendedAt,
              restoredAt: new Date(),
            });
          } catch (logErr) {
            logger.error({ err: logErr.message, contractId: record.id }, 'Failed to write suspension_logs row for contract-update reactivate');
          }
        }
      } else if (['terminated', 'cancelled', 'expired'].includes(newStatus)) {
        await db.query(
          "UPDATE radius SET status = 'inactive' WHERE contract_id = ? AND deleted_at IS NULL",
          [record.id],
        );
        suspensionService.sendRadiusDisconnect(record.id).catch(() => {});
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

    // A new contract may only run on a live (non-archived) plan that belongs
    // to this organization, or a global plan (organization_id IS NULL).
    await assertPlanSelectable(conn, filtered.plan_id, req.orgId);

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
    // A renewal may not move the contract onto an archived plan, or one
    // belonging to a different organization (keeping the current plan,
    // archived or not, is fine).
    if (req.body.plan_id && Number(req.body.plan_id) !== Number(contract.plan_id)) {
      await assertPlanSelectable(db, req.body.plan_id, req.orgId);
    }

    // PPPoE re-provisioning: a pppoe/pppoe_dual contract cannot be activated
    // without a RADIUS account (trg_contracts_radius_consistency_bu). When the
    // account was removed (e.g. when the contract was cancelled), recreate one
    // with fresh credentials via the canonical provisioner so the renew succeeds
    // instead of failing the trigger. Runs before the activation UPDATE so the
    // account exists when the trigger fires.
    let provisioning = null;
    if (contract.connection_type === 'pppoe' || contract.connection_type === 'pppoe_dual') {
      const [radRows] = await db.query('SELECT COUNT(*) AS cnt FROM radius WHERE contract_id = ?', [contract.id]);
      if (radRows[0].cnt === 0) {
        provisioning = await provisioningService.provisionNewContract(db, contract);
      } else {
        // An existing account may have been deactivated by a prior
        // terminate/cancel (radius.status='inactive' — see suspendContract/
        // routes/contracts.js updateContractHandler/lifecycleService.cancelOrder).
        // A renew is an explicit staff decision to reinstate service, so
        // reactivate it here rather than leaving the contract 'active' but
        // offline. Unlike suspensionService.reconnectContract (billing-driven,
        // automatic — see its "never resurrect inactive" guard), this
        // intentionally CAN resurrect a deactivated account.
        await db.query(
          "UPDATE radius SET status = 'active' WHERE contract_id = ? AND deleted_at IS NULL AND status = 'inactive'",
          [contract.id],
        );
      }
    }

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
      newValues: { ...updates, radius_reprovisioned: Boolean(provisioning) },
    }).catch(() => {});
    // When a RADIUS account was recreated, return its (fresh) credentials so the
    // operator can reconfigure the subscriber's CPE.
    res.json({ data: record, ...(provisioning && provisioning.pppoe ? { provisioning } : {}) });
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

    // Best-effort: push the new secret to the NAS (RouterOS direct-API devices).
    // FreeRADIUS-SQL deployments pick the new password up on the next sync. The
    // subscriber's CPE must still be reconfigured with these credentials.
    let pushed = false;
    if (radius.nas_id) {
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
