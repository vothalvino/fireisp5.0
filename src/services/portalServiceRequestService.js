// =============================================================================
// FireISP 5.0 — Portal Service Request Service (§11.3)
// =============================================================================
// Handles self-service requests submitted via the client portal:
//   - Plan upgrade/change with proration calculation
//   - Wi-Fi password change (queued via CPE task or ONU OMCI config)
//   - PPPoE password change (synced to RADIUS immediately)
//   - Static IP request
//   - Service cancellation request
//   - Installation/visit scheduling
// =============================================================================

const crypto = require('crypto');
const db = require('../config/database');
const { calculateProration } = require('./billingService');
const { NotFoundError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger').child({ service: 'portalServiceRequest' });

// ---------------------------------------------------------------------------
// Create a new service request
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {number} opts.clientId
 * @param {number} opts.organizationId
 * @param {string} opts.requestType
 * @param {object} [opts.payload]
 * @returns {Promise<object>} The created request row
 */
async function createRequest({ clientId, organizationId, requestType, payload = {} }) {
  // Resolve the client's active contract
  const [contracts] = await db.query(
    `SELECT c.id, c.plan_id, c.status, c.start_date,
            p.name AS plan_name, p.price, p.billing_cycle_months
     FROM contracts c
     JOIN plans p ON p.id = c.plan_id
     WHERE c.client_id = ? AND c.status = 'active' AND c.deleted_at IS NULL
     LIMIT 1`,
    [clientId],
  );
  const contract = contracts[0] || null;

  let prorationCredit = null;
  let prorationCharge = null;
  let prorationNet = null;

  // For plan upgrades calculate proration up-front
  if (requestType === 'plan_upgrade') {
    const { new_plan_id } = payload;
    if (!new_plan_id) throw new ValidationError('new_plan_id is required for plan_upgrade');
    if (!contract) throw new ValidationError('No active contract found for this client');

    const [plans] = await db.query(
      'SELECT id, name, price FROM plans WHERE id = ? AND deleted_at IS NULL',
      [new_plan_id],
    );
    if (!plans[0]) throw new NotFoundError('Plan');
    if (plans[0].id === contract.plan_id) {
      throw new ValidationError('Client is already on this plan');
    }

    // Find the current billing period
    const [periods] = await db.query(
      `SELECT period_start, period_end FROM invoices
       WHERE contract_id = ? AND status IN ('issued','overdue','paid')
         AND deleted_at IS NULL
       ORDER BY period_start DESC LIMIT 1`,
      [contract.id],
    );

    if (periods[0]) {
      const proration = calculateProration({
        oldPrice: contract.price,
        newPrice: plans[0].price,
        changeDate: new Date(),
        periodStart: periods[0].period_start,
        periodEnd: periods[0].period_end,
      });
      prorationCredit = proration.credit;
      prorationCharge = proration.charge;
      prorationNet = proration.net;
    }

    payload.new_plan_name = plans[0].name;
    payload.new_plan_price = plans[0].price;
    payload.current_plan_id = contract.plan_id;
    payload.current_plan_name = contract.plan_name;
  }

  // Validate PPPoE password change has a radius account
  if (requestType === 'pppoe_password_change') {
    if (!contract) throw new ValidationError('No active contract found for this client');
    const [radRows] = await db.query(
      'SELECT id FROM radius WHERE contract_id = ? AND deleted_at IS NULL LIMIT 1',
      [contract.id],
    );
    if (!radRows[0]) {
      throw new ValidationError('No PPPoE account found for this contract');
    }
  }

  const contractId = contract ? contract.id : null;

  const [result] = await db.query(
    `INSERT INTO portal_service_requests
       (organization_id, client_id, contract_id, request_type, status, payload,
        proration_credit, proration_charge, proration_net)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    [
      organizationId,
      clientId,
      contractId,
      requestType,
      JSON.stringify(payload),
      prorationCredit,
      prorationCharge,
      prorationNet,
    ],
  );

  logger.info({ requestId: result.insertId, clientId, requestType }, 'Portal service request created');

  const [rows] = await db.query(
    'SELECT * FROM portal_service_requests WHERE id = ?',
    [result.insertId],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Get requests for a client
// ---------------------------------------------------------------------------

async function listRequests(clientId, { page = 1, limit = 20, requestType } = {}) {
  const safeLimit = Math.max(1, parseInt(limit, 10) || 20);
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeOffset = (safePage - 1) * safeLimit;
  let where = 'WHERE client_id = ? AND deleted_at IS NULL';
  const params = [clientId];

  if (requestType) {
    where += ' AND request_type = ?';
    params.push(requestType);
  }

  const [rows] = await db.query(
    `SELECT id, request_type, status, payload, notes,
            proration_credit, proration_charge, proration_net,
            approved_at, completed_at, cancelled_at, created_at, updated_at
     FROM portal_service_requests ${where}
     ORDER BY created_at DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params,
  );
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM portal_service_requests ${where}`,
    params,
  );
  return { rows, total };
}

// ---------------------------------------------------------------------------
// Cancel a pending request (client-side)
// ---------------------------------------------------------------------------

async function cancelRequest(requestId, clientId) {
  const [rows] = await db.query(
    'SELECT id, status FROM portal_service_requests WHERE id = ? AND client_id = ? AND deleted_at IS NULL',
    [requestId, clientId],
  );
  if (!rows[0]) throw new NotFoundError('Service request');
  if (rows[0].status !== 'pending') {
    throw new ValidationError('Only pending requests can be cancelled');
  }
  await db.query(
    `UPDATE portal_service_requests
     SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [requestId],
  );
  return { id: requestId, status: 'cancelled' };
}

// ---------------------------------------------------------------------------
// Apply an approved PPPoE password change to RADIUS
// ---------------------------------------------------------------------------

async function applyPppoePasswordChange(requestId) {
  const [rows] = await db.query(
    'SELECT * FROM portal_service_requests WHERE id = ? AND deleted_at IS NULL',
    [requestId],
  );
  const req = rows[0];
  if (!req) throw new NotFoundError('Service request');

  const payload = typeof req.payload === 'string' ? JSON.parse(req.payload) : req.payload;
  const newPassword = payload.new_password;
  if (!newPassword) throw new ValidationError('No new_password in request payload');

  // Update radius account password
  await db.query(
    'UPDATE radius SET password = ?, updated_at = NOW() WHERE contract_id = ?',
    [newPassword, req.contract_id],
  );

  await db.query(
    `UPDATE portal_service_requests
     SET status = 'completed', completed_at = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [requestId],
  );

  logger.info({ requestId, contractId: req.contract_id }, 'PPPoE password updated via portal request');
}

// ---------------------------------------------------------------------------
// Admin: list requests across all clients (with filters)
// ---------------------------------------------------------------------------

/**
 * @param {number} organizationId
 * @param {{ page?, limit?, status?, requestType?, clientId? }} opts
 */
async function adminListRequests(organizationId, { page = 1, limit = 25, status, requestType, clientId } = {}) {
  const safeLimit = Math.max(1, parseInt(limit, 10) || 25);
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeOffset = (safePage - 1) * safeLimit;
  let where = 'WHERE psr.organization_id = ? AND psr.deleted_at IS NULL';
  const params = [organizationId];

  if (status) {
    where += ' AND psr.status = ?';
    params.push(status);
  }
  if (requestType) {
    where += ' AND psr.request_type = ?';
    params.push(requestType);
  }
  if (clientId) {
    where += ' AND psr.client_id = ?';
    params.push(clientId);
  }

  const [rows] = await db.query(
    `SELECT psr.id, psr.client_id, psr.contract_id, psr.request_type, psr.status,
            psr.payload, psr.notes, psr.approved_by, psr.approved_at,
            psr.completed_at, psr.cancelled_at,
            psr.proration_credit, psr.proration_charge, psr.proration_net,
            psr.created_at, psr.updated_at,
            CONCAT(cl.first_name, ' ', cl.last_name) AS client_name,
            cl.email AS client_email
     FROM portal_service_requests psr
     LEFT JOIN clients cl ON cl.id = psr.client_id
     ${where}
     ORDER BY psr.created_at DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params,
  );
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM portal_service_requests psr ${where}`,
    params,
  );
  return { rows, total };
}

/**
 * Admin: get a single request by id with org scoping.
 */
async function adminGetRequest(requestId, organizationId) {
  const [rows] = await db.query(
    `SELECT psr.*, CONCAT(cl.first_name, ' ', cl.last_name) AS client_name, cl.email AS client_email
     FROM portal_service_requests psr
     LEFT JOIN clients cl ON cl.id = psr.client_id
     WHERE psr.id = ? AND psr.organization_id = ? AND psr.deleted_at IS NULL`,
    [requestId, organizationId],
  );
  if (!rows[0]) throw new NotFoundError('Service request');
  return rows[0];
}

/**
 * Admin: approve a request and execute the corresponding action.
 * @param {number} requestId
 * @param {number} organizationId
 * @param {number} approvedByUserId
 * @param {string} [notes]
 */
async function approveRequest(requestId, organizationId, approvedByUserId, notes) {
  const [rows] = await db.query(
    'SELECT * FROM portal_service_requests WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
    [requestId, organizationId],
  );
  const req = rows[0];
  if (!req) throw new NotFoundError('Service request');
  if (req.status !== 'pending') {
    throw new ValidationError(`Request is already ${req.status}`);
  }

  // Set approved_by + approved_at immediately
  await db.query(
    `UPDATE portal_service_requests
     SET status = 'approved', approved_by = ?, approved_at = NOW(),
         notes = COALESCE(?, notes), updated_at = NOW()
     WHERE id = ?`,
    [approvedByUserId, notes || null, requestId],
  );

  const payload = typeof req.payload === 'string' ? JSON.parse(req.payload) : (req.payload || {});

  // Execute type-specific action
  if (req.request_type === 'pppoe_password_change') {
    // Apply RADIUS password change and mark completed
    await applyPppoePasswordChange(requestId);
  } else if (req.request_type === 'plan_upgrade') {
    // Update contract plan_id and mark completed
    if (req.contract_id && payload.new_plan_id) {
      await db.query(
        'UPDATE contracts SET plan_id = ?, updated_at = NOW() WHERE id = ?',
        [payload.new_plan_id, req.contract_id],
      );
    }
    await db.query(
      `UPDATE portal_service_requests
       SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [requestId],
    );
    logger.info({ requestId, contractId: req.contract_id, newPlanId: payload.new_plan_id }, 'Plan upgrade applied via portal request');
  } else if (req.request_type === 'wifi_password_change') {
    // Queue a CPE set-parameter task for Wi-Fi password if we can resolve the device.
    // If no CPE device is found, leave as approved for manual fulfillment.
    if (req.contract_id) {
      const [cpeRows] = await db.query(
        'SELECT id, organization_id FROM cpe_devices WHERE contract_id = ? AND deleted_at IS NULL LIMIT 1',
        [req.contract_id],
      );
      if (cpeRows[0]) {
        const CpeTask = require('../models/CpeTask');
        const wifiPassword = payload.new_password || null;
        if (wifiPassword) {
          await CpeTask.create({
            organization_id: cpeRows[0].organization_id,
            cpe_device_id: cpeRows[0].id,
            task_type: 'set_parameter_values',
            parameters: JSON.stringify({
              parameters: [
                {
                  name: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey',
                  value: wifiPassword,
                  type: 'xsd:string',
                },
              ],
            }),
            priority: 3,
            status: 'queued',
            created_by: approvedByUserId,
          });
          await db.query(
            `UPDATE portal_service_requests
             SET status = 'completed', completed_at = NOW(), updated_at = NOW()
             WHERE id = ?`,
            [requestId],
          );
          logger.info({ requestId, cpeDeviceId: cpeRows[0].id }, 'Wi-Fi password change queued via CPE task');
        }
      }
      // If no CPE device found, leave as 'approved' for manual fulfillment
    }
  } else {
    // static_ip_request, cancellation, visit_schedule — approved, manual fulfillment
    // Status stays 'approved'; admin calls POST /:id/complete when done
  }

  const [updated] = await db.query(
    'SELECT * FROM portal_service_requests WHERE id = ?',
    [requestId],
  );
  return updated[0];
}

/**
 * Admin: mark an approved request as completed (manual fulfillment).
 */
async function completeRequest(requestId, organizationId) {
  const [rows] = await db.query(
    'SELECT id, status FROM portal_service_requests WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
    [requestId, organizationId],
  );
  if (!rows[0]) throw new NotFoundError('Service request');
  if (rows[0].status !== 'approved') {
    throw new ValidationError('Only approved requests can be marked completed');
  }
  await db.query(
    `UPDATE portal_service_requests
     SET status = 'completed', completed_at = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [requestId],
  );
  return { id: requestId, status: 'completed' };
}

/**
 * Admin: reject a pending request with notes.
 */
async function rejectRequest(requestId, organizationId, notes) {
  const [rows] = await db.query(
    'SELECT id, status FROM portal_service_requests WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
    [requestId, organizationId],
  );
  if (!rows[0]) throw new NotFoundError('Service request');
  if (rows[0].status !== 'pending') {
    throw new ValidationError(`Request is already ${rows[0].status}`);
  }
  await db.query(
    `UPDATE portal_service_requests
     SET status = 'rejected', notes = ?, updated_at = NOW()
     WHERE id = ?`,
    [notes || null, requestId],
  );
  return { id: requestId, status: 'rejected' };
}

// ---------------------------------------------------------------------------
// Create a push subscription (Web Push)
// ---------------------------------------------------------------------------

async function upsertPushSubscription({
  clientId,
  organizationId,
  endpoint,
  p256dh,
  auth,
  userAgent,
  notifyOutage,
  notifyBilling,
  notifyTicket,
}) {
  // Check if this endpoint already exists for this client
  const [existing] = await db.query(
    'SELECT id FROM portal_push_subscriptions WHERE client_id = ? AND endpoint = ? AND deleted_at IS NULL',
    [clientId, endpoint],
  );

  if (existing[0]) {
    // Build dynamic SET clause — only update notify_* when explicitly provided
    const setClauses = ['p256dh = ?', 'auth = ?', 'user_agent = ?'];
    const params = [p256dh, auth, userAgent || null];

    if (notifyOutage !== undefined && notifyOutage !== null) {
      setClauses.push('notify_outage = ?');
      params.push(notifyOutage ? 1 : 0);
    }
    if (notifyBilling !== undefined && notifyBilling !== null) {
      setClauses.push('notify_billing = ?');
      params.push(notifyBilling ? 1 : 0);
    }
    if (notifyTicket !== undefined && notifyTicket !== null) {
      setClauses.push('notify_ticket = ?');
      params.push(notifyTicket ? 1 : 0);
    }

    setClauses.push('updated_at = NOW()');
    params.push(existing[0].id);

    await db.query(
      `UPDATE portal_push_subscriptions SET ${setClauses.join(', ')} WHERE id = ?`,
      params,
    );
    return { id: existing[0].id, updated: true };
  }

  const [result] = await db.query(
    `INSERT INTO portal_push_subscriptions
       (organization_id, client_id, endpoint, p256dh, auth, user_agent,
        notify_outage, notify_billing, notify_ticket)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      organizationId,
      clientId,
      endpoint,
      p256dh,
      auth,
      userAgent || null,
      notifyOutage !== undefined && notifyOutage !== null ? (notifyOutage ? 1 : 0) : 1,
      notifyBilling !== undefined && notifyBilling !== null ? (notifyBilling ? 1 : 0) : 1,
      notifyTicket !== undefined && notifyTicket !== null ? (notifyTicket ? 1 : 0) : 1,
    ],
  );
  return { id: result.insertId, updated: false };
}

async function deletePushSubscription(clientId, endpoint) {
  await db.query(
    `UPDATE portal_push_subscriptions
     SET deleted_at = NOW()
     WHERE client_id = ? AND endpoint = ? AND deleted_at IS NULL`,
    [clientId, endpoint],
  );
}

// ---------------------------------------------------------------------------
// Generate a portal chat session token
// ---------------------------------------------------------------------------

function generateChatToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------------------
// Knowledge base helpers (public read + portal search)
// ---------------------------------------------------------------------------

async function listKbArticles(organizationId, { category, search, page = 1, limit = 20 } = {}) {
  const safeLimit = Math.max(1, parseInt(limit, 10) || 20);
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeOffset = (safePage - 1) * safeLimit;
  let where = 'WHERE (organization_id = ? OR organization_id IS NULL) AND is_published = 1 AND deleted_at IS NULL';
  const params = [organizationId];

  if (category) {
    where += ' AND category = ?';
    params.push(category);
  }
  if (search) {
    where += ' AND (title LIKE ? OR body LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  const [rows] = await db.query(
    `SELECT id, category, title, slug, view_count, helpful_yes, helpful_no, created_at, updated_at
     FROM portal_kb_articles ${where}
     ORDER BY view_count DESC, updated_at DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params,
  );
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM portal_kb_articles ${where}`,
    params,
  );
  return { rows, total };
}

async function getKbArticle(organizationId, slugOrId) {
  const field = isNaN(Number(slugOrId)) ? 'slug' : 'id';
  const [rows] = await db.query(
    `SELECT id, category, title, slug, body, view_count, helpful_yes, helpful_no, created_at, updated_at
     FROM portal_kb_articles
     WHERE ${field} = ?
       AND (organization_id = ? OR organization_id IS NULL)
       AND is_published = 1
       AND deleted_at IS NULL`,
    [slugOrId, organizationId],
  );
  if (!rows[0]) throw new NotFoundError('KB article');
  // Increment view count (fire-and-forget)
  db.query('UPDATE portal_kb_articles SET view_count = view_count + 1 WHERE id = ?', [rows[0].id]);
  return rows[0];
}

async function rateKbArticle(organizationId, slugOrId, helpful) {
  const field = isNaN(Number(slugOrId)) ? 'slug' : 'id';
  const col = helpful ? 'helpful_yes' : 'helpful_no';
  const [rows] = await db.query(
    `SELECT id FROM portal_kb_articles
     WHERE ${field} = ?
       AND (organization_id = ? OR organization_id IS NULL)
       AND is_published = 1
       AND deleted_at IS NULL`,
    [slugOrId, organizationId],
  );
  if (!rows[0]) throw new NotFoundError('KB article');
  await db.query(
    `UPDATE portal_kb_articles SET ${col} = ${col} + 1 WHERE id = ?`,
    [rows[0].id],
  );
  return { id: rows[0].id, rated: helpful ? 'yes' : 'no' };
}

module.exports = {
  createRequest,
  listRequests,
  cancelRequest,
  applyPppoePasswordChange,
  adminListRequests,
  adminGetRequest,
  approveRequest,
  rejectRequest,
  completeRequest,
  upsertPushSubscription,
  deletePushSubscription,
  generateChatToken,
  listKbArticles,
  getKbArticle,
  rateKbArticle,
};
