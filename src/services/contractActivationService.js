'use strict';

// =============================================================================
// FireISP 5.0 — Contract activation orchestration
// =============================================================================
// A contract created directly from the Contracts screen starts pending and
// offline.  This service joins that entry point back onto the canonical
// customer-lifecycle path:
//
//   prepareActivation  -> create/reuse + start a linked new_install order
//   getActivationState -> one readiness payload for the contract screen
//   activate           -> complete that order through lifecycleService
//
// Permanent activation itself deliberately remains in
// lifecycleService.completeOrder().  That is the single transaction/lock gate
// used by both the service-order screen and the contract screen.
// =============================================================================

const db = require('../config/database');
const Contract = require('../models/Contract');
const User = require('../models/User');
const lifecycleService = require('./lifecycleService');
const legalDocumentService = require('./legalDocumentService');
const mxRegisteredTemplateService = require('./mxRegisteredContractTemplateService');
const { ValidationError, NotFoundError, ForbiddenError } = require('../utils/errors');
const logger = require('../utils/logger').child({ service: 'contractActivation' });

const WORK_ORDER_ASSIGN_PERMISSION = 'work_orders.update';

function orgWhere(alias, orgId, params) {
  if (orgId === null || orgId === undefined) return '';
  params.push(orgId);
  return ` AND ${alias}.organization_id = ?`;
}

async function loadContract(contractId, orgId, run = db.query.bind(db)) {
  const params = [contractId];
  const scope = orgWhere('c', orgId, params);
  const [rows] = await run(
    `SELECT c.* FROM contracts c
      WHERE c.id = ?${scope} AND c.deleted_at IS NULL
      LIMIT 1`,
    params,
  );
  if (!rows[0]) throw new NotFoundError('Contract');
  return rows[0];
}

/** Prefer the currently actionable order, while retaining completed history. */
async function findActivationOrder(contractId, orgId, run = db.query.bind(db)) {
  const params = [contractId];
  const scope = orgWhere('so', orgId, params);
  const [rows] = await run(
    `SELECT so.* FROM service_orders so
      WHERE so.contract_id = ?${scope}
        AND so.order_type = 'new_install' AND so.deleted_at IS NULL
      ORDER BY FIELD(so.status, 'in_process', 'new', 'done', 'cancelled'), so.id DESC
      LIMIT 1`,
    params,
  );
  return rows[0] || null;
}

async function findInstallWorkOrder(orderId, orgId, run = db.query.bind(db), contractId = null) {
  if (!orderId) return null;
  const params = [orderId];
  const scope = orgWhere('wo', orgId, params);
  let contractScope = '';
  if (contractId !== null && contractId !== undefined) {
    contractScope = ' AND wo.contract_id = ?';
    params.push(contractId);
  }
  const [rows] = await run(
    `SELECT wo.* FROM work_orders wo
      WHERE wo.service_order_id = ?${scope}
        ${contractScope}
        AND wo.work_type = 'installation' AND wo.deleted_at IS NULL
      ORDER BY wo.id DESC
      LIMIT 1`,
    params,
  );
  return rows[0] || null;
}

function hasAcceptanceEvidence(workOrder) {
  if (!workOrder) return false;
  return workOrder.acceptance_signal_dbm !== null && workOrder.acceptance_signal_dbm !== undefined
    || workOrder.acceptance_link_mbps !== null && workOrder.acceptance_link_mbps !== undefined
    || workOrder.acceptance_rx_dbm !== null && workOrder.acceptance_rx_dbm !== undefined
    || Number(workOrder.acceptance_waived) === 1;
}

async function organizationLocale(orgId, run = db.query.bind(db)) {
  if (orgId === null || orgId === undefined) return 'global';
  const [rows] = await run('SELECT locale FROM organizations WHERE id = ? LIMIT 1', [orgId]);
  return rows[0]?.locale || 'global';
}

async function getDocuments(orderId, contractId, run = db.query.bind(db)) {
  if (!orderId) return [];
  const [rows] = await run(
    `SELECT id, template_id, template_type, title, status,
            signer_name, signer_name AS signer, signed_at
       FROM signed_documents
      WHERE service_order_id = ? AND contract_id = ? AND deleted_at IS NULL
      ORDER BY id`,
    [orderId, contractId],
  );
  return rows;
}

async function getRequiredActivationTemplates(
  orgId, contractEnvironment, run = db.query.bind(db),
) {
  const [rows] = await run(
    `SELECT dt.*${mxRegisteredTemplateService.joinedRegistrationColumns('ctm')}
       FROM document_templates dt
       LEFT JOIN contract_templates_mx ctm ON ctm.id = dt.contract_template_mx_id
      WHERE dt.organization_id = ? AND dt.template_type = 'activation_contract'
        AND dt.is_active = 1 AND dt.deleted_at IS NULL
        AND (ctm.id IS NULL OR ctm.environment = ?)
      ORDER BY dt.id`,
    [orgId, contractEnvironment],
  );
  if (rows.length) {
    mxRegisteredTemplateService.assertOneRegisteredSource(rows, orgId, contractEnvironment);
  }
  return rows;
}

async function getActivationTemplateInstanceState(
  orderId, contractId, orgId, clientId,
  templateType = 'activation_contract', run = db.query.bind(db), requiredMxSource = null,
) {
  if (!orderId) return { liveTemplateIds: new Set(), signedTemplateIds: new Set() };
  const [rows] = await run(
    `SELECT *
      FROM signed_documents
      WHERE service_order_id = ? AND organization_id = ?
        AND client_id <=> ? AND contract_id = ?
        AND template_type = ?
        AND status IN ('pending','signed')
        AND deleted_at IS NULL`,
    [orderId, orgId, clientId, contractId, templateType],
  );
  const validRows = requiredMxSource
    ? rows.filter(row => mxRegisteredTemplateService.snapshotMatchesRegisteredSource(
      row,
      requiredMxSource,
    ))
    : rows;
  return {
    liveTemplateIds: new Set(validRows.map(row => Number(row.template_id))),
    signedTemplateIds: new Set(validRows
      .filter(row => row.status === 'signed'
        && legalDocumentService.signatureEvidenceIsValid(row))
      .map(row => Number(row.template_id))),
  };
}

async function getArrivalAuthorizationState(
  orderId, orgId, contractId, clientId, run = db.query.bind(db),
) {
  if (!orderId || orgId === null || orgId === undefined) {
    return { unsigned: false, missingLiveInstance: false };
  }
  const [rows] = await run(
    `SELECT dt.id,
            MAX(sd.status = 'signed') AS has_signed,
            COUNT(sd.id) > 0 AS has_live
       FROM document_templates dt
       LEFT JOIN signed_documents sd
         ON sd.service_order_id = ? AND sd.organization_id = ?
        AND sd.client_id <=> ? AND sd.contract_id <=> ?
        AND sd.template_id = dt.id
        AND sd.template_type = 'installation_authorization'
        AND sd.status IN ('pending','signed') AND sd.deleted_at IS NULL
      WHERE dt.organization_id = ?
        AND dt.template_type = 'installation_authorization'
        AND dt.is_active = 1 AND dt.deleted_at IS NULL
      GROUP BY dt.id
      ORDER BY dt.id`,
    [orderId, orgId, clientId, contractId, orgId],
  );
  return {
    unsigned: rows.some(row => Number(row.has_signed) !== 1),
    missingLiveInstance: rows.some(row => Number(row.has_live) !== 1),
  };
}

async function latestTechnicianSpeedTest(contractId, workOrderId, startedAt, run = db.query.bind(db)) {
  if (!workOrderId || !startedAt) return null;
  const [rows] = await run(
    `SELECT id, contract_id, client_id, work_order_id, device_id, test_source, server_location,
            download_mbps, upload_mbps, latency_ms, jitter_ms, packet_loss_pct,
            ip_address, notes, tested_at
       FROM speed_tests
      WHERE contract_id = ? AND work_order_id = ?
        AND test_source = 'technician' AND tested_at >= ?
        AND deleted_at IS NULL
      ORDER BY tested_at DESC, id DESC
      LIMIT 1`,
    [contractId, workOrderId, startedAt],
  );
  return rows[0] || null;
}

/** Backfill newly-enabled MX templates without duplicating live instances. */
async function backfillRequiredDocuments(contract, order, {
  orgId, userId,
} = {}) {
  if (!order) return;
  const effectiveOrgId = contract.organization_id ?? orgId ?? null;
  if (effectiveOrgId === null) return;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // Serialise two concurrent prepare clicks on the contract. There is no
    // historical unique key on (order, template), so the lock is what keeps
    // the ID-granular backfill idempotent.
    const [contracts] = await conn.query(
      `SELECT id FROM contracts
        WHERE id = ? AND organization_id = ? AND deleted_at IS NULL
        FOR UPDATE`,
      [contract.id, effectiveOrgId],
    );
    if (!contracts[0]) throw new NotFoundError('Contract');

    const [locales] = await conn.query(
      'SELECT locale FROM organizations WHERE id = ? LIMIT 1',
      [effectiveOrgId],
    );
    const locale = locales[0]?.locale || 'global';

    const workOrder = await findInstallWorkOrder(
      order.id, effectiveOrgId, conn.query.bind(conn), contract.id,
    );
    if (locale !== 'MX') {
      const [existing] = await conn.query(
        `SELECT id FROM signed_documents
          WHERE service_order_id = ? AND organization_id = ?
            AND client_id <=> ? AND contract_id = ?
            AND template_type = ? AND status IN ('pending','signed')
            AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
        [
          order.id, effectiveOrgId, order.client_id, contract.id,
          legalDocumentService.GLOBAL_ACKNOWLEDGMENT_TYPE,
        ],
      );
      if (!existing[0]) {
        await legalDocumentService.generateForOrder(conn.query.bind(conn), {
          orgId: effectiveOrgId,
          clientId: order.client_id,
          contractId: contract.id,
          orderId: order.id,
          workOrderId: workOrder?.id || null,
          createdBy: userId,
          onlyTemplateIds: new Set([legalDocumentService.GLOBAL_ACKNOWLEDGMENT_TEMPLATE_ID]),
        });
      }
      await conn.commit();
      return;
    }

    const canGenerateArrivalAuthorization = Boolean(
      workOrder && ['pending', 'assigned'].includes(workOrder.status),
    );
    const [missingTemplates] = await conn.query(
      `SELECT dt.id
         FROM document_templates dt
        WHERE dt.organization_id = ?
          AND (
            dt.template_type = 'activation_contract'
            OR (dt.template_type = 'installation_authorization' AND ? = 1)
          )
          AND dt.is_active = 1
          AND dt.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM signed_documents sd
             WHERE sd.service_order_id = ? AND sd.organization_id = dt.organization_id
               AND sd.client_id <=> ? AND sd.contract_id = ?
               AND sd.template_id = dt.id
               AND sd.template_type = dt.template_type
               AND sd.status IN ('pending','signed') AND sd.deleted_at IS NULL
          )
        ORDER BY dt.id`,
      [
        effectiveOrgId, canGenerateArrivalAuthorization ? 1 : 0,
        order.id, order.client_id, contract.id,
      ],
    );
    if (missingTemplates.length) {
      await legalDocumentService.generateForOrder(conn.query.bind(conn), {
        orgId: effectiveOrgId,
        clientId: order.client_id,
        contractId: contract.id,
        orderId: order.id,
        workOrderId: workOrder?.id || null,
        createdBy: userId,
        onlyTemplateIds: new Set(missingTemplates.map(template => Number(template.id))),
      });
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

function serviceOrderView(order) {
  if (!order) return null;
  return {
    id: order.id,
    order_number: order.order_number,
    order_type: order.order_type,
    status: order.status,
    assigned_to: order.assigned_to,
    requested_at: order.requested_at,
    started_at: order.started_at,
    completed_at: order.completed_at,
    cancelled_at: order.cancelled_at,
    created_at: order.created_at,
    updated_at: order.updated_at,
  };
}

function workOrderView(workOrder) {
  if (!workOrder) return null;
  return {
    id: workOrder.id,
    service_order_id: workOrder.service_order_id,
    work_type: workOrder.work_type,
    title: workOrder.title,
    status: workOrder.status,
    assigned_to: workOrder.assigned_to,
    scheduled_at: workOrder.scheduled_at,
    started_at: workOrder.started_at,
    completed_at: workOrder.completed_at,
    acceptance_signal_dbm: workOrder.acceptance_signal_dbm,
    acceptance_link_mbps: workOrder.acceptance_link_mbps,
    acceptance_rx_dbm: workOrder.acceptance_rx_dbm,
    acceptance_waived: Number(workOrder.acceptance_waived) === 1,
    acceptance_notes: workOrder.acceptance_notes,
    acceptance_recorded_at: workOrder.acceptance_recorded_at,
    created_at: workOrder.created_at,
    updated_at: workOrder.updated_at,
  };
}

/**
 * Return the complete, org-scoped activation/readiness state used by the
 * contract page. `blockers` are stable machine-readable codes so all three UI
 * languages can render their own copy.
 */
async function getActivationState(contractId, {
  orgId = null, includeDocuments = false, includeServiceOrder = true,
  includeWorkOrder = true, includeSpeedTest = true,
} = {}) {
  const contract = await loadContract(contractId, orgId);
  const order = await findActivationOrder(contract.id, orgId);
  const workOrder = await findInstallWorkOrder(order?.id, orgId, db.query.bind(db), contract.id);
  const speedTest = await latestTechnicianSpeedTest(
    contract.id,
    workOrder?.id,
    order?.started_at,
  );

  const effectiveOrgId = contract.organization_id ?? orgId ?? null;
  const radiusParams = [contract.id];
  const radiusScope = orgWhere('r', effectiveOrgId, radiusParams);
  const [radiusRows] = await db.query(
    `SELECT r.status, r.nas_id FROM radius r
      WHERE r.contract_id = ?${radiusScope} AND r.deleted_at IS NULL
      ORDER BY r.id DESC`,
    radiusParams,
  );
  const activeRadiusRows = radiusRows.filter(radius => radius.status === 'active');
  const locale = await organizationLocale(effectiveOrgId);
  // Legal-document metadata is permission-sensitive. MX requires the ISP's
  // active reviewed contract templates; global requires one bundled neutral
  // service acknowledgment and never borrows Mexican legal wording.
  // Readiness uses the complete stored evidence envelope so hiding metadata
  // from the response does not accidentally bypass signature verification.
  const requiredDocumentType = locale === 'MX'
    ? 'activation_contract'
    : legalDocumentService.GLOBAL_ACKNOWLEDGMENT_TYPE;
  const requiredTemplates = locale === 'MX'
    ? await getRequiredActivationTemplates(effectiveOrgId, contract.mx_contract_environment)
    : [{
      id: legalDocumentService.GLOBAL_ACKNOWLEDGMENT_TEMPLATE_ID,
      name: legalDocumentService.GLOBAL_ACKNOWLEDGMENT_TITLE,
    }];
  const requiredMxSource = locale === 'MX' && requiredTemplates.length
    ? mxRegisteredTemplateService.assertOneRegisteredSource(
      requiredTemplates,
      effectiveOrgId,
      contract.mx_contract_environment,
    )
    : null;
  const templateInstances = requiredTemplates.length
    ? await getActivationTemplateInstanceState(
      order?.id, contract.id, effectiveOrgId, contract.client_id, requiredDocumentType,
      db.query.bind(db), requiredMxSource,
    )
    : { liveTemplateIds: new Set(), signedTemplateIds: new Set() };
  const arrivalGateOpen = Boolean(
    workOrder && ['pending', 'assigned'].includes(workOrder.status),
  );
  const arrivalAuthorization = locale === 'MX' && arrivalGateOpen
    ? await getArrivalAuthorizationState(
      order?.id, effectiveOrgId, contract.id, contract.client_id,
    )
    : { unsigned: false, missingLiveInstance: false };
  const documents = includeDocuments
    ? await getDocuments(order?.id, contract.id)
    : [];

  const blockers = [];
  if (contract.status !== 'pending') blockers.push('contract_not_pending');
  if (!order) blockers.push('service_order_missing');
  else if (order.status !== 'in_process') blockers.push('service_order_not_in_process');
  if (!workOrder) blockers.push('work_order_missing');
  else {
    if (workOrder.status !== 'completed') blockers.push('work_order_not_completed');
    if (!hasAcceptanceEvidence(workOrder)) blockers.push('acceptance_missing');
  }
  const windowExpiry = contract.test_window_expires_at
    ? new Date(contract.test_window_expires_at).getTime()
    : null;
  const windowIsOpen = Number.isFinite(windowExpiry) && windowExpiry > Date.now();
  if (Number(contract.test_window_cleanup_pending) === 1
      || (contract.test_window_expires_at && !windowIsOpen)) {
    blockers.push('test_window_cleanup_pending');
  } else if (windowIsOpen) {
    blockers.push('test_window_open');
  }
  if (!speedTest) blockers.push('speed_test_missing');

  if (requiredTemplates.some(
    template => !templateInstances.signedTemplateIds.has(Number(template.id)),
  )) {
    blockers.push('signature_missing');
  }
  if (locale === 'MX' && requiredTemplates.length === 0) {
    blockers.push('activation_template_missing');
  }
  if (requiredMxSource
      && (Number(contract.contract_template_mx_id) !== requiredMxSource.contractTemplateMxId
        || contract.mx_contract_environment !== requiredMxSource.contractEnvironment)) {
    blockers.push('registered_template_mismatch');
  }

  return {
    contract_id: contract.id,
    client_id: contract.client_id,
    status: contract.status,
    contract_environment: contract.mx_contract_environment,
    connection_type: contract.connection_type,
    test_window_expires_at: contract.test_window_expires_at,
    test_window_cleanup_pending: Number(contract.test_window_cleanup_pending) === 1,
    arrival_authorization_pending: arrivalAuthorization.unsigned,
    document_sync_required: requiredTemplates.some(
      template => !templateInstances.liveTemplateIds.has(Number(template.id)),
    ) || arrivalAuthorization.missingLiveInstance,
    radius_status: radiusRows[0]?.status || null,
    // The durable first-activation marker also covers grandfathered/imported
    // live subscribers that predate service orders. Network repair therefore
    // must not require a historical completed new_install order; it is safe
    // whenever exactly one active PPPoE account has an assigned NAS.
    network_retry_available: contract.status === 'active'
      && Boolean(contract.first_activated_at)
      && ['pppoe', 'pppoe_dual'].includes(contract.connection_type)
      && activeRadiusRows.length === 1
      && Boolean(activeRadiusRows[0].nas_id),
    service_order_prepared: Boolean(order),
    service_order: includeServiceOrder ? serviceOrderView(order) : null,
    work_order_prepared: Boolean(workOrder),
    work_order: includeWorkOrder ? workOrderView(workOrder) : null,
    documents,
    speed_test_recorded: Boolean(speedTest),
    speed_test: includeSpeedTest ? speedTest : null,
    can_activate: blockers.length === 0,
    blockers,
  };
}

/**
 * Create (or reuse) the activation order for a directly-created pending
 * contract, then start it through lifecycleService so dispatch + MX document
 * generation stay identical to the ordinary service-order entry point.
 */
async function prepareActivation(contractId, {
  orgId = null, userId = null, assignedTo = null, includeDocuments = false,
  includeServiceOrder = true, includeWorkOrder = true, includeSpeedTest = true,
  canStartInstallation = false,
} = {}) {
  if (canStartInstallation !== true) {
    throw new ForbiddenError('Preparing a new installation requires installations.start');
  }
  const contract = await Contract.findById(contractId, orgId);
  if (!contract) throw new NotFoundError('Contract');
  if (contract.status !== 'pending') {
    throw new ValidationError(`Only pending contracts can be prepared for activation (this one is ${contract.status})`);
  }
  const effectiveOrgId = contract.organization_id ?? orgId ?? null;
  if (effectiveOrgId === null) {
    throw new ValidationError('An organization is required to prepare an installation work order');
  }
  // Fail before creating dispatch records when the MX legal prerequisite has
  // not been configured. The same zero-template rule is rechecked by the
  // permanent lifecycle gate; this early check avoids an operator-visible
  // order/WO that can never reach activation. Global organizations remain
  // outside the Mexican legal-document flow entirely.
  const locale = await organizationLocale(effectiveOrgId);
  if (locale === 'MX') {
    const requiredTemplates = await getRequiredActivationTemplates(
      effectiveOrgId,
      contract.mx_contract_environment,
    );
    if (requiredTemplates.length === 0) {
      throw new ValidationError(
        'Configure and activate at least one reviewed MX activation-contract template before preparing service',
      );
    }
    const registeredSource = mxRegisteredTemplateService.assertOneRegisteredSource(
      requiredTemplates,
      effectiveOrgId,
      contract.mx_contract_environment,
    );
    if (Number(contract.contract_template_mx_id) !== registeredSource.contractTemplateMxId
        || contract.mx_contract_environment !== registeredSource.contractEnvironment) {
      throw new ValidationError(
        'Select the registered MX contract template used by the active activation document before preparing service',
      );
    }
  }
  if (assignedTo) {
    const [canViewWorkOrders, canWorkOrders, canRecordSpeed] = await Promise.all([
      User.hasEffectivePermission(assignedTo, effectiveOrgId, 'work_orders.view'),
      User.hasEffectivePermission(assignedTo, effectiveOrgId, WORK_ORDER_ASSIGN_PERMISSION),
      User.hasEffectivePermission(assignedTo, effectiveOrgId, 'speed_tests.create'),
    ]);
    if (!canViewWorkOrders || !canWorkOrders || !canRecordSpeed) {
      throw new ValidationError(
        'Assigned user is not authorized for commissioning; work-order view, work-order update, and speed-test create permissions are required',
      );
    }
  }

  const conn = await db.getConnection();
  let order;
  try {
    await conn.beginTransaction();
    const [lockedContracts] = await conn.query(
      `SELECT * FROM contracts
        WHERE id = ? AND organization_id = ? AND deleted_at IS NULL
        FOR UPDATE`,
      [contract.id, effectiveOrgId],
    );
    const lockedContract = lockedContracts[0];
    if (!lockedContract) throw new NotFoundError('Contract');
    if (lockedContract.status !== 'pending') {
      throw new ValidationError(`Only pending contracts can be prepared for activation (this one is ${lockedContract.status})`);
    }

    const [orders] = await conn.query(
      `SELECT * FROM service_orders
        WHERE contract_id = ? AND organization_id = ?
          AND order_type = 'new_install' AND status IN ('new','in_process')
          AND deleted_at IS NULL
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [lockedContract.id, effectiveOrgId],
    );
    order = orders[0] || null;

    if (!order) {
      const orderNumber = await lifecycleService.nextOrderNumber(conn, effectiveOrgId);
      const [clients] = await conn.query(
        `SELECT address, city, state, zip_code FROM clients
          WHERE id = ? AND organization_id = ? AND deleted_at IS NULL LIMIT 1`,
        [lockedContract.client_id, effectiveOrgId],
      );
      if (!clients[0]) throw new ValidationError('Contract client not found in this organization');
      const address = [clients[0].address, clients[0].city, clients[0].state, clients[0].zip_code]
        .filter(Boolean).join(', ').slice(0, 500) || null;
      const [insert] = await conn.query(
        `INSERT INTO service_orders
           (organization_id, order_number, client_id, plan_id, contract_id,
            order_type, status, assigned_to, address, notes)
         VALUES (?, ?, ?, ?, ?, 'new_install', 'new', ?, ?, ?)`,
        [
          effectiveOrgId, orderNumber, lockedContract.client_id,
          lockedContract.plan_id, lockedContract.id, assignedTo || null,
          address,
          'Activation workflow created from the pending contract page.',
        ],
      );
      await lifecycleService.seedDefaultTasks(conn, insert.insertId);
      const [created] = await conn.query('SELECT * FROM service_orders WHERE id = ?', [insert.insertId]);
      order = created[0];
    } else if (assignedTo) {
      if (Number(order.assigned_to) !== Number(assignedTo)) {
        await conn.query(
          'UPDATE service_orders SET assigned_to = ? WHERE id = ?',
          [assignedTo, order.id],
        );
      }
      // Always repair the installation WO. A previous partial/manual edit can
      // leave the SO correctly assigned while its WO is unassigned/pending;
      // comparing only the SO made idempotent prepare unable to fix that drift.
      await conn.query(
        `UPDATE work_orders SET assigned_to = ?, status = IF(status = 'pending', 'assigned', status)
          WHERE service_order_id = ? AND work_type = 'installation'
            AND status NOT IN ('completed','cancelled') AND deleted_at IS NULL`,
        [assignedTo, order.id],
      );
      order = { ...order, assigned_to: assignedTo };
    }

    if (order?.status === 'in_process') {
      // A cancelled/deleted installation visit cannot be resurrected as
      // activation evidence. Nor can an historical "completed" visit that
      // predates the acceptance/commissioning requirements: it has no safe
      // way to acquire evidence after completion. Create one fresh
      // authoritative replacement, newest by id—the same selection rule used
      // by readiness and the final locked lifecycle gate. The contract lock
      // above serialises repeated Prepare clicks, so at most one replacement
      // is materialised.
      const [installationRows] = await conn.query(
        `SELECT * FROM work_orders
          WHERE service_order_id = ? AND organization_id = ? AND contract_id = ?
            AND work_type = 'installation'
          ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [order.id, effectiveOrgId, lockedContract.id],
      );
      const authoritativeWorkOrder = installationRows[0];
      let completedEvidenceMissing = false;
      if (authoritativeWorkOrder?.status === 'completed') {
        if (!hasAcceptanceEvidence(authoritativeWorkOrder) || !order.started_at) {
          completedEvidenceMissing = true;
        } else {
          const [commissioningTests] = await conn.query(
            `SELECT id FROM speed_tests
              WHERE contract_id = ? AND work_order_id = ?
                AND test_source = 'technician' AND tested_at >= ?
                AND deleted_at IS NULL
              ORDER BY tested_at DESC, id DESC LIMIT 1`,
            [lockedContract.id, authoritativeWorkOrder.id, order.started_at],
          );
          completedEvidenceMissing = !commissioningTests[0];
        }
      }
      const needsReplacement = !authoritativeWorkOrder
        || authoritativeWorkOrder.deleted_at
        || authoritativeWorkOrder.status === 'cancelled'
        || completedEvidenceMissing;
      if (needsReplacement) {
        const technicianId = order.assigned_to || null;
        await conn.query(
          `INSERT INTO work_orders
             (organization_id, client_id, contract_id, service_order_id, assigned_to,
              created_by, title, description, status, priority, work_type, address)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'medium', 'installation', ?)`,
          [
            effectiveOrgId,
            lockedContract.client_id,
            lockedContract.id,
            order.id,
            technicianId,
            userId,
            `Installation — ${order.order_number}`,
            'Replacement activation visit created after the prior installation work order was cancelled or deleted.',
            technicianId ? 'assigned' : 'pending',
            order.address || null,
          ],
        );
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  if (order.status === 'new') {
    try {
      await lifecycleService.startOrder(order.id, {
        orgId: effectiveOrgId,
        userId,
        canStartInstallation,
      });
    } catch (err) {
      // A concurrent idempotent prepare may have started the shared order
      // after our commit. Only absorb that exact success race; every genuine
      // lifecycle validation/provisioning failure remains visible.
      const current = await findActivationOrder(contract.id, effectiveOrgId);
      if (current?.status !== 'in_process') throw err;
    }
  }

  // startOrder generated the templates active at start time. Re-running
  // prepare also materialises any template enabled since then, by exact
  // template ID, so `signature_missing` always has a document the client can
  // actually open and sign. Global gets its bundled neutral acknowledgment.
  const currentOrder = await findActivationOrder(contract.id, effectiveOrgId);
  await backfillRequiredDocuments(contract, currentOrder, {
    orgId: effectiveOrgId,
    userId,
  });

  return getActivationState(contract.id, {
    orgId: effectiveOrgId,
    includeDocuments,
    includeServiceOrder,
    includeWorkOrder,
    includeSpeedTest,
  });
}

async function activate(contractId, {
  orgId = null, userId = null, billing, installationFee = null, description = null,
  includeDocuments = false, includeServiceOrder = true,
  includeWorkOrder = true, includeSpeedTest = true,
  canCreateInvoice = true,
} = {}) {
  const contract = await loadContract(contractId, orgId);
  if (contract.status !== 'pending') {
    throw new ValidationError(`Only pending contracts can be activated (this one is ${contract.status})`);
  }
  const order = await findActivationOrder(contract.id, orgId);
  if (!order || order.status !== 'in_process') {
    throw new ValidationError('Prepare and start the contract activation workflow before activating service');
  }
  const { invoice, activation: networkActivation } = await lifecycleService.completeOrder(order.id, {
    orgId,
    userId,
    billing,
    installationFee,
    description,
    canActivateContract: true,
    canCreateInvoice,
  });
  const state = await getActivationState(contract.id, {
    orgId, includeDocuments, includeServiceOrder, includeWorkOrder, includeSpeedTest,
  });
  return {
    ...state,
    invoice: invoice || null,
    network_activation: networkActivation || null,
  };
}

/**
 * Cancel a pending activation from the contract screen. Prepared activations
 * delegate to lifecycleService.cancelOrder so the SO, WO, contract, RADIUS,
 * and test-window cleanup remain canonical. An unprepared contract has no
 * order to cancel, so this method performs the equivalent fail-closed
 * contract/network shutdown under a contract lock.
 */
async function cancelActivation(contractId, {
  orgId = null, includeDocuments = false, includeServiceOrder = true,
  includeWorkOrder = true, includeSpeedTest = true,
} = {}) {
  const conn = await db.getConnection();
  let orderId;
  let cleanupRadius = null;
  let cleanupMarked = false;
  let disconnectAfterCommit = false;
  let effectiveOrgId;
  try {
    await conn.beginTransaction();
    // Match Prepare's lock order (contract, then service order). Besides
    // avoiding an inversion/deadlock, holding the contract lock before the
    // order lookup means a concurrent Prepare must either finish first (and
    // its order is visible here) or wait until this cancellation commits.
    const contractParams = [contractId];
    const contractScope = orgWhere('c', orgId, contractParams);
    const [contracts] = await conn.query(
      `SELECT c.* FROM contracts c
        WHERE c.id = ?${contractScope} AND c.deleted_at IS NULL
        FOR UPDATE`,
      contractParams,
    );
    const contract = contracts[0];
    if (!contract) throw new NotFoundError('Contract');
    if (contract.status !== 'pending') {
      throw new ValidationError(`Only pending contract activation can be cancelled (currently: ${contract.status})`);
    }
    effectiveOrgId = contract.organization_id ?? orgId ?? null;

    const orderParams = [contract.id];
    const orderScope = orgWhere('so', effectiveOrgId, orderParams);
    const [orders] = await conn.query(
      `SELECT so.id FROM service_orders so
        WHERE so.contract_id = ?${orderScope}
          AND so.order_type = 'new_install' AND so.status IN ('new','in_process')
          AND so.deleted_at IS NULL
        ORDER BY so.id DESC LIMIT 1 FOR UPDATE`,
      orderParams,
    );
    orderId = orders[0]?.id || null;
    if (!orderId) {
      const pppoe = ['pppoe', 'pppoe_dual'].includes(contract.connection_type);
      // A legacy pending PPPoE line may predate test-window markers while an
      // active local RouterOS secret still exists. Cancellation is a shutdown
      // boundary, so every PPPoE row gets durable external cleanup, not only
      // rows that previously opened a bounded window.
      cleanupMarked = pppoe;

      const [cancelled] = await conn.query(
        cleanupMarked
          ? `UPDATE contracts
                SET status = 'cancelled', test_window_cleanup_pending = 1,
                    test_window_cleanup_attempted_at = NULL
              WHERE id = ? AND status = 'pending' AND deleted_at IS NULL`
          : `UPDATE contracts
                SET status = 'cancelled', test_window_cleanup_pending = 0,
                    test_window_expires_at = NULL,
                    test_window_cleanup_attempted_at = NULL
              WHERE id = ? AND status = 'pending' AND deleted_at IS NULL`,
        [contract.id],
      );
      if (cancelled.affectedRows !== 1) {
        throw new ValidationError('Contract activation was modified concurrently — reload and retry');
      }

      if (pppoe) {
        const [radiusRows] = await conn.query(
          `SELECT * FROM radius
            WHERE contract_id = ?
            ORDER BY (deleted_at IS NULL) DESC, id DESC FOR UPDATE`,
          [contract.id],
        );
        cleanupRadius = radiusRows;
        await conn.query(
          "UPDATE radius SET status = 'inactive' WHERE contract_id = ? AND deleted_at IS NULL",
          [contract.id],
        );
        const radiusService = require('./radiusService');
        await radiusService.syncFreeradiusContract(contract.id, {
          organizationId: effectiveOrgId,
          enabled: false,
          runner: conn,
        });
        disconnectAfterCommit = !cleanupMarked;
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  let serviceOrderCancelled = false;
  if (orderId) {
    const cancellation = await lifecycleService.cancelOrder(orderId, { orgId: effectiveOrgId });
    serviceOrderCancelled = cancellation.contractCancelled === true;
    if (!serviceOrderCancelled) {
      throw new ValidationError('The linked activation order changed before its pending contract could be cancelled');
    }
  } else if (cleanupMarked) {
    try {
      const testWindowService = require('./testWindowService');
      await testWindowService.finalizeMarkedCleanup(contractId, {
        orgId: effectiveOrgId,
        radius: cleanupRadius,
        reason: 'contract_activation_cancel',
      });
    } catch (err) {
      logger.warn(
        { err: err.message, contractId },
        'Activation cancelled; test-window RouterOS cleanup remains pending',
      );
    }
  } else if (disconnectAfterCommit) {
    const suspensionService = require('./suspensionService');
    await suspensionService.sendRadiusDisconnect(Number(contractId)).catch(err => logger.warn(
      { err: err.message, contractId },
      'Activation cancelled; best-effort RADIUS disconnect failed',
    ));
  }

  const state = await getActivationState(contractId, {
    orgId: effectiveOrgId,
    includeDocuments,
    includeServiceOrder,
    includeWorkOrder,
    includeSpeedTest,
  });
  return {
    ...state,
    cancelled: true,
    cancellation: {
      contract_cancelled: state.status === 'cancelled',
      service_order_id: orderId,
      service_order_cancelled: serviceOrderCancelled,
    },
  };
}

/**
 * Reinstate a subscriber that has already crossed the first-activation gate.
 * The contract, RADIUS status, and standard FreeRADIUS SQL credentials move
 * back to the live state in one transaction. RouterOS is external I/O, so its
 * idempotent upsert happens after commit and is reported without rolling back
 * a legitimate renewal.
 */
async function renewPreviouslyActivated(contractId, {
  orgId = null, endDate, planId,
} = {}) {
  const conn = await db.getConnection();
  let contract;
  let radius = null;
  let provisioning = null;
  try {
    await conn.beginTransaction();
    const params = [contractId];
    const scope = orgWhere('c', orgId, params);
    const [contracts] = await conn.query(
      `SELECT c.* FROM contracts c
        WHERE c.id = ?${scope} AND c.deleted_at IS NULL
        FOR UPDATE`,
      params,
    );
    const locked = contracts[0];
    if (!locked) throw new NotFoundError('Contract');
    if (!['suspended', 'expired', 'cancelled', 'terminated'].includes(locked.status)) {
      throw new ValidationError(`Cannot renew a contract with status '${locked.status}'`);
    }
    if (!locked.first_activated_at) {
      throw new ValidationError('This contract still requires its first activation workflow');
    }

    await mxRegisteredTemplateService.assertSandboxContractCanResume(
      conn.query.bind(conn),
      { contract: locked, context: 'Contract renewal', lock: true },
    );

    const effectiveOrgId = locked.organization_id ?? orgId ?? null;
    const isPppoe = ['pppoe', 'pppoe_dual'].includes(locked.connection_type);
    if (isPppoe) {
      const radiusParams = [locked.id];
      const radiusScope = orgWhere('r', effectiveOrgId, radiusParams);
      const [radiusRows] = await conn.query(
        `SELECT r.* FROM radius r
          WHERE r.contract_id = ?${radiusScope} AND r.deleted_at IS NULL
          ORDER BY r.id DESC FOR UPDATE`,
        radiusParams,
      );
      if (radiusRows.length > 1) {
        throw new ValidationError('The contract has multiple RADIUS accounts and cannot be renewed safely');
      }
      radius = radiusRows[0] || null;
      if (!radius) {
        const provisioningService = require('./subscriberProvisioningService');
        provisioning = await provisioningService.provisionNewContract(conn, locked);
        radius = provisioning.pppoe
          ? {
            id: provisioning.pppoe.radius_id,
            organization_id: effectiveOrgId,
            contract_id: locked.id,
            username: provisioning.pppoe.username,
            password: provisioning.pppoe.password,
            profile: null,
            nas_id: null,
            status: 'inactive',
          }
          : null;
      }
      if (!radius) throw new ValidationError('A PPPoE renewal requires a RADIUS account');
    }

    const sets = ["status = 'active'"];
    const updateParams = [];
    if (endDate !== undefined) {
      sets.push('end_date = ?');
      updateParams.push(endDate || null);
    }
    if (planId !== undefined && planId !== null) {
      sets.push('plan_id = ?');
      updateParams.push(planId);
    }
    const updateScope = orgId === null || orgId === undefined
      ? ''
      : ' AND organization_id = ?';
    const [renewed] = await conn.query(
      `UPDATE contracts SET ${sets.join(', ')}
        WHERE id = ?${updateScope} AND status = ?
          AND first_activated_at IS NOT NULL AND deleted_at IS NULL
          AND ${mxRegisteredTemplateService.sandboxResumeSqlPredicate('contracts')}`,
      [
        ...updateParams,
        locked.id,
        ...(updateScope ? [orgId] : []),
        locked.status,
      ],
    );
    if (renewed.affectedRows !== 1) {
      throw new ValidationError('Contract renewal was modified concurrently — reload and retry');
    }

    if (radius) {
      const radiusUpdateParams = [radius.id];
      const radiusUpdateScope = orgWhere('radius', effectiveOrgId, radiusUpdateParams);
      const [restored] = await conn.query(
        `UPDATE radius SET status = 'active'
          WHERE id = ?${radiusUpdateScope} AND contract_id = ? AND deleted_at IS NULL`,
        [...radiusUpdateParams, locked.id],
      );
      if (restored.affectedRows !== 1) {
        throw new ValidationError('The RADIUS subscriber changed during renewal — reload and retry');
      }
      radius.status = 'active';
      const radiusService = require('./radiusService');
      await radiusService.syncFreeradiusContract(locked.id, {
        organizationId: effectiveOrgId,
        enabled: true,
        runner: conn,
      });
    }

    contract = await Contract.findByIdOrFail(locked.id, orgId, {
      exec: conn.query.bind(conn),
    });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  let nasPushed = false;
  let nasPushError = null;
  if (radius?.nas_id) {
    try {
      const Nas = require('../models/Nas');
      const routerProvisioningService = require('./routerProvisioningService');
      const nas = await Nas.findByIdOrFail(radius.nas_id, contract.organization_id ?? orgId);
      await routerProvisioningService.pushSubscriber(nas, {
        username: radius.username,
        password: radius.password,
        profile: radius.profile,
        comment: `FireISP renewed service contract#${contract.id}`,
      });
      nasPushed = true;
    } catch (err) {
      nasPushError = err.message;
      logger.warn(
        { err: err.message, contractId: contract.id, nasId: radius.nas_id },
        'Contract renewed but RouterOS subscriber restore failed (best-effort)',
      );
    }
  }

  return {
    contract,
    provisioning,
    network_activation: radius
      ? {
        contract_id: contract.id,
        radius_id: radius.id,
        nas_id: radius.nas_id || null,
        radius_synced: true,
        nas_pushed: nasPushed,
        ...(nasPushError ? { nas_push_error: nasPushError } : {}),
      }
      : null,
  };
}

/**
 * Idempotently restore the already-activated subscriber on its RouterOS NAS.
 * This deliberately performs no order transition, billing, or DB mutation;
 * pushSubscriber is an upsert, so repeated operator retries are safe.
 */
async function retryNetworkActivation(contractId, { orgId = null } = {}) {
  const contract = await loadContract(contractId, orgId);
  if (contract.status !== 'active') {
    throw new ValidationError('Network activation can only be retried for an active contract');
  }
  if (!contract.first_activated_at) {
    throw new ValidationError('The contract has not crossed the permanent activation boundary');
  }
  if (!['pppoe', 'pppoe_dual'].includes(contract.connection_type)) {
    throw new ValidationError('Network activation retry is available only for PPPoE contracts');
  }
  const order = await findActivationOrder(contract.id, orgId);

  const params = [contract.id];
  const effectiveOrgId = contract.organization_id ?? orgId ?? null;
  const scope = orgWhere('r', effectiveOrgId, params);
  const [radiusRows] = await db.query(
    `SELECT r.* FROM radius r
      WHERE r.contract_id = ?${scope} AND r.status = 'active'
        AND r.deleted_at IS NULL
      ORDER BY r.id DESC`,
    params,
  );
  if (radiusRows.length !== 1) {
    throw new ValidationError(
      radiusRows.length === 0
        ? 'This contract has no active RADIUS subscriber to restore'
        : 'This contract has multiple active RADIUS subscribers and cannot be restored safely',
    );
  }
  const radius = radiusRows[0];
  if (!radius.nas_id) throw new ValidationError('This RADIUS subscriber is not assigned to a NAS');

  const result = {
    contract_id: contract.id,
    service_order_id: order?.id || null,
    radius_id: radius.id,
    nas_id: radius.nas_id,
    success: false,
  };
  try {
    const Nas = require('../models/Nas');
    const routerProvisioningService = require('./routerProvisioningService');
    const nas = await Nas.findByIdOrFail(radius.nas_id, effectiveOrgId);
    await routerProvisioningService.pushSubscriber(nas, {
      username: radius.username,
      password: radius.password,
      profile: radius.profile,
      comment: `FireISP permanent activation contract#${contract.id}`,
    });
    result.success = true;
  } catch (err) {
    result.error = err.message;
    logger.warn(
      { err: err.message, contractId: contract.id, nasId: radius.nas_id },
      'Permanent network activation retry failed',
    );
  }
  return result;
}

module.exports = {
  getActivationState,
  prepareActivation,
  activate,
  cancelActivation,
  renewPreviouslyActivated,
  retryNetworkActivation,
  hasAcceptanceEvidence,
};
