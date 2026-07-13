// =============================================================================
// FireISP 5.0 — Client Self-Service Portal Routes
// =============================================================================
// All routes are prefixed /api/v1/portal.
//
// Public (unauthenticated):
//   POST   /portal/auth/login
//   POST   /portal/auth/refresh
//   POST   /portal/auth/logout
//
// Authenticated (requires portal JWT):
//   GET    /portal/auth/me
//   PUT    /portal/auth/password
//
//   --- §11.1 Dashboard ---
//   GET    /portal/dashboard            account overview (plan, balance, session)
//   GET    /portal/usage/current-month  daily usage data for current billing month
//
//   --- §11.2 Billing & Payments ---
//   GET    /portal/invoices             list own invoices
//   GET    /portal/invoices/:id         invoice detail + line items
//   GET    /portal/invoices/:id/pdf     download invoice PDF
//   GET    /portal/invoices/:id/cfdi    download CFDI XML for invoice
//   POST   /portal/invoices/:id/pay     create a checkout session
//   GET    /portal/payments             payment history
//
//   --- §11.3 Self-Service Actions ---
//   GET    /portal/service-requests          list own requests
//   POST   /portal/service-requests          create a request
//   POST   /portal/service-requests/:id/cancel  cancel pending request
//
//   --- §11.4 Support ---
//   GET    /portal/tickets              list own tickets
//   POST   /portal/tickets             open a new ticket
//   GET    /portal/tickets/:id          ticket detail + comments
//   POST   /portal/tickets/:id/comments add a comment
//   GET    /portal/kb                   list knowledge-base articles
//   GET    /portal/kb/:slugOrId         get KB article detail
//   POST   /portal/kb/:slugOrId/rate    rate a KB article helpful/unhelpful
//   POST   /portal/speed-test           queue a speed test job
//   GET    /portal/speed-test/results   list speed test results
//   POST   /portal/chat/start           start an AI chat session
//   POST   /portal/chat/:token/message  send a chat message, get AI reply
//   GET    /portal/callback-request     submit a callback request (creates ticket)
//
//   --- §11.5 Mobile / PWA ---
//   POST   /portal/push/subscribe       register Web Push subscription
//   DELETE /portal/push/subscribe       remove Web Push subscription
//
//   --- §10.3 Data Packs (pre-existing) ---
//   GET    /portal/data-packs
//   POST   /portal/data-packs/:packId/purchase
//   GET    /portal/data-packs/my-purchases
//   GET    /portal/usage/allowance
// =============================================================================

const { Router } = require('express');
const { portalAuthenticate } = require('../middleware/portalAuth');
const { validate } = require('../middleware/validate');
// authLimiter guards the credential endpoint (/auth/login) only. Route-level
// apiLimiter was REMOVED everywhere else: app.js already applies apiLimiter to
// all of /api/, so a second router-level pass double-counted every portal
// request against the same per-IP bucket (and /auth/refresh + /auth/me now
// live in the dedicated sessionLimiter carve-out — see middleware/rateLimit.js).
const { authLimiter } = require('../middleware/rateLimit');
const portalAuthService = require('../services/portalAuthService');
const checkoutService = require('../services/checkoutService');
const db = require('../config/database');
const { NotFoundError, ValidationError } = require('../utils/errors');
const dataPackService = require('../services/dataPackService');
const portalServiceRequestService = require('../services/portalServiceRequestService');
const pdfService = require('../services/pdfService');
const aiReplyService = require('../services/aiReplyService');

const router = Router();

// ---------------------------------------------------------------------------
// Validation schemas (portal-specific)
// ---------------------------------------------------------------------------

const portalLoginSchema = {
  email: { type: 'email', required: true },
  password: { type: 'string', required: true, min: 1, max: 200 },
};

const portalRefreshSchema = {
  refreshToken: { type: 'string', required: true },
};

const portalPasswordSchema = {
  currentPassword: { type: 'string', required: true, min: 1 },
  newPassword: { type: 'string', required: true, min: 8, max: 200 },
};

const createTicketSchema = {
  subject: { type: 'string', required: true, min: 1, max: 300 },
  description: { type: 'string', max: 5000 },
  priority: { type: 'string', enum: ['low', 'medium', 'high'] },
  category: { type: 'string', max: 100 },
};

const createCommentSchema = {
  body: { type: 'string', required: true, min: 1, max: 5000 },
};

const createServiceRequestSchema = {
  request_type: {
    type: 'string',
    required: true,
    enum: ['plan_upgrade', 'wifi_password_change', 'pppoe_password_change',
      'static_ip_request', 'cancellation', 'visit_schedule'],
  },
  payload: { type: 'object' },
};

const chatMessageSchema = {
  message: { type: 'string', required: true, min: 1, max: 2000 },
};

const pushSubscribeSchema = {
  endpoint: { type: 'string', required: true, min: 10, max: 2048 },
  p256dh: { type: 'string', required: true },
  auth: { type: 'string', required: true },
  notify_outage: { type: 'boolean' },
  notify_billing: { type: 'boolean' },
  notify_ticket: { type: 'boolean' },
};

const kbRateSchema = {
  helpful: { type: 'boolean', required: true },
};

// ---------------------------------------------------------------------------
// AUTH — public endpoints
// ---------------------------------------------------------------------------

// POST /portal/auth/login
router.post('/auth/login', authLimiter, validate(portalLoginSchema), async (req, res, next) => {
  try {
    const result = await portalAuthService.login(req.body);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// POST /portal/auth/refresh
// Uses the general NOT the strict authLimiter: the portal SPA keeps its
// access token in memory and re-exchanges the (localStorage) refresh token on every
// page load, so the strict 20/window limiter would 429 a frequently-reloaded session
// and bounce the customer to the login screen. /auth/login stays on authLimiter.
router.post('/auth/refresh', validate(portalRefreshSchema), async (req, res, next) => {
  try {
    const result = await portalAuthService.refreshToken(req.body.refreshToken);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// POST /portal/auth/logout
router.post('/auth/logout', async (req, res, next) => {
  try {
    const { refreshToken } = req.body || {};
    await portalAuthService.logout(refreshToken);
    res.json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// All routes below require a valid portal JWT
// ---------------------------------------------------------------------------
router.use(portalAuthenticate);

// GET /portal/auth/me
router.get('/auth/me', (req, res) => {
  res.json({ data: req.client });
});

// PUT /portal/auth/password — update portal password
router.put('/auth/password', validate(portalPasswordSchema), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Verify current password before allowing change
    const [rows] = await db.query(
      'SELECT portal_password_hash FROM clients WHERE id = ? AND deleted_at IS NULL',
      [req.client.id],
    );
    if (!rows[0] || !rows[0].portal_password_hash) {
      throw new ValidationError('Portal password is not set for this account');
    }
    const bcrypt = require('bcryptjs');
    const valid = await bcrypt.compare(currentPassword, rows[0].portal_password_hash);
    if (!valid) {
      throw new ValidationError('Current password is incorrect');
    }

    await portalAuthService.setPassword(req.client.id, newPassword);
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// INVOICES
// ---------------------------------------------------------------------------

// GET /portal/invoices — list own invoices (paginated)
router.get('/invoices', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset = (page - 1) * limit;
    const status = req.query.status;

    // invoices has no discount_amount/period_start/period_end columns — there
    // is no discount concept anywhere on invoices (dropped; the frontend
    // already renders it conditionally), and the billing period dates live on
    // billing_periods, linked via invoice_id.
    let whereClause = 'WHERE i.client_id = ? AND i.deleted_at IS NULL';
    const params = [req.client.id];

    if (status) {
      whereClause += ' AND i.status = ?';
      params.push(status);
    }

    // HIGH — item 5 of the second adversarial review: billing_periods has no
    // UNIQUE constraint on invoice_id alone (only on contract_id +
    // period_start), so a plain LEFT JOIN could return MORE THAN ONE row per
    // invoice — the customer would see the same invoice duplicated in the
    // list, and the separate COUNT (which never joined) would disagree with
    // how many rows actually rendered, breaking pagination. Dedup to at most
    // one billing_periods row per invoice (the most recent period) before
    // joining, so list and count are always consistent.
    const [rows] = await db.query(
      `SELECT i.id, i.invoice_number, i.subtotal, i.tax_amount, i.total,
              i.currency, bp.period_start, bp.period_end, i.due_date, i.paid_at, i.status, i.created_at
       FROM invoices i
       LEFT JOIN (
         SELECT invoice_id, period_start, period_end,
                ROW_NUMBER() OVER (PARTITION BY invoice_id ORDER BY period_start DESC) AS rn
         FROM billing_periods
         WHERE invoice_id IS NOT NULL
       ) bp ON bp.invoice_id = i.id AND bp.rn = 1
       ${whereClause}
       ORDER BY i.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    const [[{ total: count }]] = await db.query(
      `SELECT COUNT(*) AS total FROM invoices i ${whereClause}`,
      params,
    );

    res.json({
      data: rows,
      meta: { page, limit, total: count, pages: Math.ceil(count / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /portal/invoices/:id — invoice detail + items
router.get('/invoices/:id', async (req, res, next) => {
  try {
    // See the /invoices list route above for why discount_amount is dropped,
    // period_start/period_end come from a join to billing_periods, and that
    // join is deduped to one row per invoice (billing_periods.invoice_id has
    // no UNIQUE constraint of its own).
    const [rows] = await db.query(
      `SELECT i.id, i.invoice_number, i.subtotal, i.tax_amount, i.total,
              i.currency, bp.period_start, bp.period_end, i.due_date, i.paid_at, i.status, i.notes, i.created_at
       FROM invoices i
       LEFT JOIN (
         SELECT invoice_id, period_start, period_end,
                ROW_NUMBER() OVER (PARTITION BY invoice_id ORDER BY period_start DESC) AS rn
         FROM billing_periods
         WHERE invoice_id IS NOT NULL
       ) bp ON bp.invoice_id = i.id AND bp.rn = 1
       WHERE i.id = ? AND i.client_id = ? AND i.deleted_at IS NULL`,
      [req.params.id, req.client.id],
    );

    if (!rows[0]) throw new NotFoundError('Invoice');

    // invoice_items has tax_rate_id (an FK), not a tax_rate value — join
    // tax_rates for the actual rate.
    const [items] = await db.query(
      `SELECT ii.id, ii.description, ii.quantity, ii.unit_price, ii.amount, tr.rate AS tax_rate
       FROM invoice_items ii
       LEFT JOIN tax_rates tr ON tr.id = ii.tax_rate_id
       WHERE ii.invoice_id = ? AND ii.deleted_at IS NULL`,
      [req.params.id],
    );

    const [payments] = await db.query(
      `SELECT pa.amount AS allocated_amount, p.payment_method, p.payment_date
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
       WHERE pa.invoice_id = ? AND pa.deleted_at IS NULL`,
      [req.params.id],
    );

    res.json({ data: { ...rows[0], items, payments } });
  } catch (err) {
    next(err);
  }
});

// POST /portal/invoices/:id/pay — create a checkout session (online payment)
router.post('/invoices/:id/pay', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT id, organization_id FROM invoices WHERE id = ? AND client_id = ? AND deleted_at IS NULL',
      [req.params.id, req.client.id],
    );
    if (!rows[0]) throw new NotFoundError('Invoice');

    const session = await checkoutService.createCheckoutSession({
      organizationId: rows[0].organization_id,
      invoiceId: rows[0].id,
      clientId: req.client.id,
      returnUrl: req.body.return_url || null,
    });

    res.status(201).json({ data: session });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// TICKETS
// ---------------------------------------------------------------------------

// GET /portal/tickets — list own tickets (paginated)
router.get('/tickets', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset = (page - 1) * limit;
    const status = req.query.status;

    let whereClause = 'WHERE client_id = ? AND deleted_at IS NULL';
    const params = [req.client.id];

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    const [rows] = await db.query(
      `SELECT id, subject, priority, category, status, created_at, updated_at
       FROM tickets ${whereClause}
       ORDER BY created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    const [[{ total: count }]] = await db.query(
      `SELECT COUNT(*) AS total FROM tickets ${whereClause}`,
      params,
    );

    res.json({
      data: rows,
      meta: { page, limit, total: count, pages: Math.ceil(count / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// POST /portal/tickets — open a new ticket
router.post('/tickets', validate(createTicketSchema), async (req, res, next) => {
  try {
    const { subject, description, priority, category } = req.body;
    const [result] = await db.query(
      `INSERT INTO tickets
         (organization_id, client_id, subject, description, priority, category, status)
       VALUES (?, ?, ?, ?, ?, ?, 'open')`,
      [
        req.client.organizationId,
        req.client.id,
        subject,
        description || null,
        priority || 'medium',
        category || null,
      ],
    );

    const [rows] = await db.query(
      'SELECT id, subject, priority, category, status, created_at FROM tickets WHERE id = ?',
      [result.insertId],
    );

    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /portal/tickets/:id — ticket detail + comments
router.get('/tickets/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT id, subject, description, priority, category, status, created_at, updated_at
       FROM tickets
       WHERE id = ? AND client_id = ? AND deleted_at IS NULL`,
      [req.params.id, req.client.id],
    );
    if (!rows[0]) throw new NotFoundError('Ticket');

    const [comments] = await db.query(
      `SELECT tc.id, tc.body, tc.created_at
       FROM ticket_comments tc
       WHERE tc.ticket_id = ? AND tc.deleted_at IS NULL AND tc.is_internal = 0
       ORDER BY tc.created_at ASC`,
      [req.params.id],
    );

    res.json({ data: { ...rows[0], comments } });
  } catch (err) {
    next(err);
  }
});

// POST /portal/tickets/:id/comments — add a comment
router.post('/tickets/:id/comments', validate(createCommentSchema), async (req, res, next) => {
  try {
    const [ticketRows] = await db.query(
      'SELECT id FROM tickets WHERE id = ? AND client_id = ? AND deleted_at IS NULL',
      [req.params.id, req.client.id],
    );
    if (!ticketRows[0]) throw new NotFoundError('Ticket');

    const [result] = await db.query(
      'INSERT INTO ticket_comments (ticket_id, body, is_internal) VALUES (?, ?, 0)',
      [req.params.id, req.body.body],
    );

    const [rows] = await db.query(
      'SELECT id, ticket_id, body, is_internal, created_at FROM ticket_comments WHERE id = ?',
      [result.insertId],
    );

    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DATA PACKS (§10.3 — portal self-service)
// ---------------------------------------------------------------------------

// GET /portal/data-packs — list available packs for this org
router.get('/data-packs', async (req, res, next) => {
  try {
    const packs = await dataPackService.listPacks(req.client.organizationId);
    res.json({ data: packs });
  } catch (err) {
    next(err);
  }
});

// POST /portal/data-packs/:packId/purchase — self-service purchase
router.post('/data-packs/:packId/purchase', async (req, res, next) => {
  try {
    // Resolve the subscriber's active contract
    const [contracts] = await db.query(
      `SELECT id FROM contracts
       WHERE client_id = ? AND status = 'active' AND deleted_at IS NULL
       LIMIT 1`,
      [req.client.id],
    );
    if (!contracts[0]) throw new NotFoundError('Active contract');

    const purchase = await dataPackService.purchasePack(
      req.client.organizationId,
      contracts[0].id,
      req.params.packId,
      { purchasedBy: 'client_portal' },
    );
    res.status(201).json({ data: purchase });
  } catch (err) {
    next(err);
  }
});

// GET /portal/data-packs/my-purchases — list this client's purchases
router.get('/data-packs/my-purchases', async (req, res, next) => {
  try {
    const [contracts] = await db.query(
      `SELECT id FROM contracts
       WHERE client_id = ? AND status = 'active' AND deleted_at IS NULL
       LIMIT 1`,
      [req.client.id],
    );
    if (!contracts[0]) return res.json({ data: [] });

    const purchases = await dataPackService.listPurchases(
      req.client.organizationId,
      contracts[0].id,
    );
    res.json({ data: purchases });
  } catch (err) {
    next(err);
  }
});

// GET /portal/usage/allowance — effective total data allowance
router.get('/usage/allowance', async (req, res, next) => {
  try {
    const [contracts] = await db.query(
      `SELECT id FROM contracts
       WHERE client_id = ? AND status = 'active' AND deleted_at IS NULL
       LIMIT 1`,
      [req.client.id],
    );
    if (!contracts[0]) return res.json({ data: null });

    const allowance = await dataPackService.getEffectiveAllowance(contracts[0].id);
    res.json({ data: allowance });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// §11.1 DASHBOARD
// ---------------------------------------------------------------------------

// GET /portal/dashboard — account overview (plan, balance, session, speed tier)
router.get('/dashboard', async (req, res, next) => {
  try {
    const clientId = req.client.id;

    // Contract + plan info
    const [contracts] = await db.query(
      `SELECT c.id AS contract_id, c.status AS contract_status, c.start_date,
              c.connection_type, c.ip_address,
              p.id AS plan_id, p.name AS plan_name, p.price,
              p.download_speed_mbps, p.upload_speed_mbps,
              p.billing_cycle, p.data_cap_gb
       FROM contracts c
       JOIN plans p ON p.id = c.plan_id
       WHERE c.client_id = ? AND c.status = 'active' AND c.deleted_at IS NULL
       LIMIT 1`,
      [clientId],
    );
    const contract = contracts[0] || null;

    // Outstanding balance (sum of unpaid invoices)
    const [[{ balance }]] = await db.query(
      `SELECT COALESCE(SUM(total), 0) AS balance
       FROM invoices
       WHERE client_id = ? AND status IN ('issued','overdue') AND deleted_at IS NULL`,
      [clientId],
    );

    // Next due date
    const [[{ next_due }]] = await db.query(
      `SELECT MIN(due_date) AS next_due
       FROM invoices
       WHERE client_id = ? AND status IN ('issued','overdue') AND deleted_at IS NULL`,
      [clientId],
    );

    // Current RADIUS session status
    let session = null;
    if (contract) {
      const [sessions] = await db.query(
        `SELECT r.username, r.status AS radius_status,
                ra.acct_session_id, ra.framed_ip, ra.calling_station_id,
                ra.acctsessiontime AS session_seconds,
                ra.acctinputoctets AS bytes_in, ra.acctoutputoctets AS bytes_out
         FROM radius r
         LEFT JOIN radacct ra ON ra.username = r.username
           AND ra.acctstoptime IS NULL
         WHERE r.contract_id = ?
         LIMIT 1`,
        [contract.contract_id],
      );
      if (sessions[0]) {
        const s = sessions[0];
        session = {
          status: s.radius_status === 'active' ? 'connected' : 'disconnected',
          username: s.username,
          ip: s.framed_ip || null,
          mac: s.calling_station_id || null,
          session_seconds: s.session_seconds || 0,
          bytes_in: s.bytes_in || 0,
          bytes_out: s.bytes_out || 0,
        };
      }
    }

    // Current month usage summary
    let usage = null;
    if (contract) {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const [[usageRow]] = await db.query(
        `SELECT COALESCE(SUM(bytes_in), 0) AS bytes_in,
                COALESCE(SUM(bytes_out), 0) AS bytes_out
         FROM connection_logs
         WHERE contract_id = ? AND event_type IN ('stop','interim-update')
           AND event_at >= ?`,
        [contract.contract_id, monthStart],
      );
      usage = {
        download_bytes: usageRow.bytes_in,
        upload_bytes: usageRow.bytes_out,
        total_bytes: usageRow.bytes_in + usageRow.bytes_out,
        download_gb: parseFloat((usageRow.bytes_in / 1073741824).toFixed(3)),
        upload_gb: parseFloat((usageRow.bytes_out / 1073741824).toFixed(3)),
        total_gb: parseFloat(((usageRow.bytes_in + usageRow.bytes_out) / 1073741824).toFixed(3)),
      };
    }

    res.json({
      data: {
        client: {
          id: req.client.id,
          name: req.client.name,
          email: req.client.email,
        },
        contract: contract ? {
          id: contract.contract_id,
          status: contract.contract_status,
          connection_type: contract.connection_type,
          ip_address: contract.ip_address,
          plan: {
            id: contract.plan_id,
            name: contract.plan_name,
            price: parseFloat(contract.price),
            download_speed_mbps: contract.download_speed_mbps,
            upload_speed_mbps: contract.upload_speed_mbps,
            billing_cycle_months: contract.billing_cycle_months,
            data_cap_gb: contract.data_cap_gb,
          },
        } : null,
        balance: parseFloat(balance),
        next_due_date: next_due || null,
        session,
        usage_this_month: usage,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /portal/usage/current-month — daily usage breakdown for chart
router.get('/usage/current-month', async (req, res, next) => {
  try {
    const [contracts] = await db.query(
      `SELECT id FROM contracts
       WHERE client_id = ? AND status = 'active' AND deleted_at IS NULL
       LIMIT 1`,
      [req.client.id],
    );
    if (!contracts[0]) return res.json({ data: [] });

    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const [rows] = await db.query(
      `SELECT DATE(event_at) AS date,
              COALESCE(SUM(bytes_in), 0) AS download_bytes,
              COALESCE(SUM(bytes_out), 0) AS upload_bytes,
              COALESCE(SUM(bytes_in + bytes_out), 0) AS total_bytes
       FROM connection_logs
       WHERE contract_id = ? AND event_type IN ('stop','interim-update')
         AND event_at >= ?
       GROUP BY DATE(event_at)
       ORDER BY date ASC`,
      [contracts[0].id, monthStart],
    );

    res.json({
      data: rows.map(r => ({
        date: r.date,
        download_gb: parseFloat((r.download_bytes / 1073741824).toFixed(3)),
        upload_gb: parseFloat((r.upload_bytes / 1073741824).toFixed(3)),
        total_gb: parseFloat((r.total_bytes / 1073741824).toFixed(3)),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// §11.2 BILLING — additional endpoints
// ---------------------------------------------------------------------------

// GET /portal/invoices/:id/pdf — download invoice as PDF
router.get('/invoices/:id/pdf', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT id, invoice_number, organization_id FROM invoices WHERE id = ? AND client_id = ? AND deleted_at IS NULL',
      [req.params.id, req.client.id],
    );
    if (!rows[0]) throw new NotFoundError('Invoice');

    const pdfBuffer = await pdfService.generateInvoicePdf(rows[0].id, { locale: 'es' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${rows[0].invoice_number}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

// GET /portal/invoices/:id/cfdi — download CFDI XML for an invoice
router.get('/invoices/:id/cfdi', async (req, res, next) => {
  try {
    const [invoiceRows] = await db.query(
      'SELECT id, client_id FROM invoices WHERE id = ? AND client_id = ? AND deleted_at IS NULL',
      [req.params.id, req.client.id],
    );
    if (!invoiceRows[0]) throw new NotFoundError('Invoice');

    const [cfdiRows] = await db.query(
      // cfdi_documents has no deleted_at (not soft-deleted) and the status
      // column is sat_status ENUM('draft','vigente','cancelado',
      // 'cancel_pending') — 'stamped' was never a legal value; 'vigente' is
      // "successfully stamped and valid".
      `SELECT cd.id, cd.uuid, cd.xml_content, cd.sat_status
       FROM cfdi_documents cd
       WHERE cd.invoice_id = ?
         AND cd.sat_status = 'vigente'
       ORDER BY cd.created_at DESC
       LIMIT 1`,
      [req.params.id],
    );
    if (!cfdiRows[0]) {
      throw new NotFoundError('CFDI document');
    }

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="cfdi-${cfdiRows[0].uuid || cfdiRows[0].id}.xml"`);
    res.send(cfdiRows[0].xml_content || '');
  } catch (err) {
    next(err);
  }
});

// GET /portal/payments — payment history
router.get('/payments', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset = (page - 1) * limit;

    const [rows] = await db.query(
      `SELECT p.id, p.amount, p.currency, p.payment_method, p.payment_date,
              p.reference_number, p.status, p.notes, p.created_at
       FROM payments p
       WHERE p.client_id = ? AND p.deleted_at IS NULL
       ORDER BY p.payment_date DESC, p.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [req.client.id],
    );

    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) AS total FROM payments WHERE client_id = ? AND deleted_at IS NULL',
      [req.client.id],
    );

    res.json({
      data: rows,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// §11.3 SELF-SERVICE REQUESTS
// ---------------------------------------------------------------------------

// GET /portal/service-requests — list own requests
router.get('/service-requests', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const requestType = req.query.request_type || null;

    const { rows, total } = await portalServiceRequestService.listRequests(
      req.client.id,
      { page, limit, requestType },
    );
    res.json({
      data: rows,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// POST /portal/service-requests — create a new request
router.post('/service-requests', validate(createServiceRequestSchema), async (req, res, next) => {
  try {
    const { request_type, payload } = req.body;
    const request = await portalServiceRequestService.createRequest({
      clientId: req.client.id,
      organizationId: req.client.organizationId,
      requestType: request_type,
      payload: payload || {},
    });
    res.status(201).json({ data: request });
  } catch (err) {
    next(err);
  }
});

// POST /portal/service-requests/:id/cancel — cancel a pending request
router.post('/service-requests/:id/cancel', async (req, res, next) => {
  try {
    const result = await portalServiceRequestService.cancelRequest(
      req.params.id,
      req.client.id,
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// §11.4 SUPPORT — knowledge base, speed test, AI chatbot, callback
// ---------------------------------------------------------------------------

// GET /portal/kb — list KB articles (public within portal)
router.get('/kb', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const { category, search } = req.query;

    const { rows, total } = await portalServiceRequestService.listKbArticles(
      req.client.organizationId,
      { category, search, page, limit },
    );
    res.json({
      data: rows,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /portal/kb/:slugOrId — get KB article detail
router.get('/kb/:slugOrId', async (req, res, next) => {
  try {
    const article = await portalServiceRequestService.getKbArticle(
      req.client.organizationId,
      req.params.slugOrId,
    );
    res.json({ data: article });
  } catch (err) {
    next(err);
  }
});

// POST /portal/kb/:slugOrId/rate — rate a KB article
router.post('/kb/:slugOrId/rate', validate(kbRateSchema), async (req, res, next) => {
  try {
    const result = await portalServiceRequestService.rateKbArticle(
      req.client.organizationId,
      req.params.slugOrId,
      req.body.helpful,
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// POST /portal/speed-test — queue a speed test job for this client
router.post('/speed-test', async (req, res, next) => {
  try {
    const [contracts] = await db.query(
      `SELECT id, organization_id FROM contracts
       WHERE client_id = ? AND status = 'active' AND deleted_at IS NULL
       LIMIT 1`,
      [req.client.id],
    );
    if (!contracts[0]) throw new ValidationError('No active contract found');

    // Pick an available test server for this org (or any global one)
    const [servers] = await db.query(
      `SELECT id FROM bandwidth_test_servers
       WHERE (organization_id = ? OR organization_id IS NULL)
         AND is_active = 1 AND deleted_at IS NULL
       LIMIT 1`,
      [req.client.organizationId],
    );

    const [result] = await db.query(
      `INSERT INTO subscriber_speed_test_jobs
         (organization_id, contract_id, test_server_id, requested_by, scheduled_at, status)
       VALUES (?, ?, ?, 'client_portal', NOW(), 'queued')`,
      [
        contracts[0].organization_id,
        contracts[0].id,
        servers[0] ? servers[0].id : null,
      ],
    );

    res.status(201).json({
      data: {
        job_id: result.insertId,
        status: 'queued',
        message: 'Speed test has been queued. Results will be available shortly.',
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /portal/speed-test/results — list speed test results for this client
router.get('/speed-test/results', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset = (page - 1) * limit;

    const [contracts] = await db.query(
      `SELECT id FROM contracts
       WHERE client_id = ? AND status = 'active' AND deleted_at IS NULL
       LIMIT 1`,
      [req.client.id],
    );
    if (!contracts[0]) return res.json({ data: [], meta: { page, limit, total: 0, pages: 0 } });

    const [rows] = await db.query(
      `SELECT id, status, scheduled_at, completed_at, requested_by,
              download_mbps, upload_mbps, latency_ms, jitter_ms, packet_loss_pct,
              protocol, error_message, created_at
       FROM subscriber_speed_test_jobs
       WHERE contract_id = ?
       ORDER BY created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      [contracts[0].id],
    );

    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) AS total FROM subscriber_speed_test_jobs WHERE contract_id = ?',
      [contracts[0].id],
    );

    res.json({
      data: rows,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// POST /portal/chat/start — start a new AI chat session
router.post('/chat/start', async (req, res, next) => {
  try {
    const token = portalServiceRequestService.generateChatToken();
    const [result] = await db.query(
      `INSERT INTO portal_chat_sessions
         (organization_id, client_id, session_token, messages, status, turn_count)
       VALUES (?, ?, ?, ?, 'active', 0)`,
      [req.client.organizationId, req.client.id, token, JSON.stringify([])],
    );
    res.status(201).json({
      data: {
        session_id: result.insertId,
        session_token: token,
        status: 'active',
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /portal/chat/:token/message — send a chat message, get AI reply
router.post('/chat/:token/message', validate(chatMessageSchema), async (req, res, next) => {
  try {
    const { token } = req.params;
    const { message } = req.body;

    // Verify session belongs to this client
    const [sessions] = await db.query(
      `SELECT id, messages, status, turn_count, ticket_id
       FROM portal_chat_sessions
       WHERE session_token = ? AND client_id = ?`,
      [token, req.client.id],
    );
    const session = sessions[0];
    if (!session) throw new NotFoundError('Chat session');
    if (session.status !== 'active') {
      throw new ValidationError(`Chat session is ${session.status}`);
    }

    const messages = Array.isArray(session.messages)
      ? session.messages
      : (typeof session.messages === 'string' ? JSON.parse(session.messages) : []);

    // Append client message
    messages.push({ role: 'client', content: message, ts: new Date().toISOString() });

    // Try AI reply — uses existing aiReplyService via a synthetic inbound text
    let aiText = null;
    let escalated = false;
    let newTicketId = null;

    try {
      // Build a minimal ticket context for aiReplyService
      // We create a temporary ticket and use aiReplyService to generate a draft
      const [ticketResult] = await db.query(
        `INSERT INTO tickets
           (organization_id, client_id, subject, description, priority, category, status)
         VALUES (?, ?, ?, ?, 'medium', 'chat', 'open')`,
        [
          req.client.organizationId,
          req.client.id,
          `Chat session ${token.slice(0, 8)}`,
          messages.map(m => `${m.role}: ${m.content}`).join('\n'),
        ],
      );
      const tempTicketId = ticketResult.insertId;

      const aiResult = await aiReplyService.generate({
        orgId: req.client.organizationId,
        ticketId: tempTicketId,
        channel: 'portal',
        inboundText: message,
      });

      if (aiResult.skipped) {
        // AI not configured or disabled — respond with a helpful fallback
        aiText = 'I\'m here to help! Our support team will follow up shortly. You can also open a support ticket for faster assistance.';
      } else {
        aiText = aiResult.draftText || 'Thank you for your message. A support agent will be with you soon.';

        if (aiResult.action === 'escalate') {
          escalated = true;
          newTicketId = tempTicketId;
        } else {
          // Clean up temp ticket if not escalated
          await db.query('UPDATE tickets SET status = \'closed\' WHERE id = ?', [tempTicketId]);
        }
      }
    } catch (_aiErr) {
      aiText = 'Thank you for your message. Our team will get back to you soon.';
    }

    messages.push({ role: 'ai', content: aiText, ts: new Date().toISOString() });

    const newTurnCount = (session.turn_count || 0) + 1;
    const newStatus = escalated ? 'escalated' : 'active';

    await db.query(
      `UPDATE portal_chat_sessions
       SET messages = ?, turn_count = ?, status = ?, ticket_id = ?, updated_at = NOW()
       WHERE id = ?`,
      [JSON.stringify(messages), newTurnCount, newStatus, newTicketId || session.ticket_id, session.id],
    );

    res.json({
      data: {
        reply: aiText,
        session_status: newStatus,
        turn_count: newTurnCount,
        ticket_id: escalated ? newTicketId : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /portal/callback-request — create a callback request ticket
router.post('/callback-request', async (req, res, next) => {
  try {
    const { preferred_time, phone, notes } = req.body || {};
    const description = [
      'Callback request from client portal.',
      phone ? `Phone: ${phone}` : null,
      preferred_time ? `Preferred time: ${preferred_time}` : null,
      notes ? `Notes: ${notes}` : null,
    ].filter(Boolean).join('\n');

    const [result] = await db.query(
      `INSERT INTO tickets
         (organization_id, client_id, subject, description, priority, category, status)
       VALUES (?, ?, 'Callback Request', ?, 'medium', 'callback', 'open')`,
      [req.client.organizationId, req.client.id, description],
    );

    const [rows] = await db.query(
      'SELECT id, subject, priority, status, created_at FROM tickets WHERE id = ?',
      [result.insertId],
    );

    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// §11.5 WEB PUSH SUBSCRIPTIONS
// ---------------------------------------------------------------------------

// POST /portal/push/subscribe — register / update Web Push subscription
router.post('/push/subscribe', validate(pushSubscribeSchema), async (req, res, next) => {
  try {
    const { endpoint, p256dh, auth, notify_outage, notify_billing, notify_ticket } = req.body;
    const result = await portalServiceRequestService.upsertPushSubscription({
      clientId: req.client.id,
      organizationId: req.client.organizationId,
      endpoint,
      p256dh,
      auth,
      userAgent: req.headers['user-agent'] || null,
      notifyOutage: notify_outage !== undefined ? notify_outage : null,
      notifyBilling: notify_billing !== undefined ? notify_billing : null,
      notifyTicket: notify_ticket !== undefined ? notify_ticket : null,
    });
    res.status(result.updated ? 200 : 201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

// DELETE /portal/push/subscribe — remove a Web Push subscription
router.delete('/push/subscribe', async (req, res, next) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) throw new ValidationError('endpoint is required');
    await portalServiceRequestService.deletePushSubscription(req.client.id, endpoint);
    res.json({ message: 'Push subscription removed' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
