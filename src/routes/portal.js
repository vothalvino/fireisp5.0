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
//   GET    /portal/invoices           list the client's own invoices
//   GET    /portal/invoices/:id       invoice detail + line items
//   POST   /portal/invoices/:id/pay   create a checkout session (online payment)
//   GET    /portal/tickets            list the client's own tickets
//   POST   /portal/tickets            open a new ticket
//   GET    /portal/tickets/:id        ticket detail with comments
//   POST   /portal/tickets/:id/comments  add a comment
//   PUT    /portal/auth/password      update portal password
// =============================================================================

const { Router } = require('express');
const { portalAuthenticate } = require('../middleware/portalAuth');
const { validate } = require('../middleware/validate');
const { authLimiter, apiLimiter } = require('../middleware/rateLimit');
const portalAuthService = require('../services/portalAuthService');
const checkoutService = require('../services/checkoutService');
const db = require('../config/database');
const config = require('../config');
const { NotFoundError, ValidationError } = require('../utils/errors');

const router = Router();

// ---------------------------------------------------------------------------
// Validation schemas (portal-specific)
// ---------------------------------------------------------------------------

const portalLoginSchema = {
  email: { type: 'email', required: true },
  password: { type: 'string', required: true, min: 1, max: 200 },
};

const portalRefreshSchema = {
  refreshToken: { type: 'string', required: false },
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

// ---------------------------------------------------------------------------
// AUTH — public endpoints
// ---------------------------------------------------------------------------

const PORTAL_COOKIE_BASE = {
  httpOnly: true,
  sameSite: 'strict',
  secure: config.env === 'production',
};

function setPortalCookies(res, accessToken, refreshToken) {
  res.cookie('fireisp_portal_access', accessToken, {
    ...PORTAL_COOKIE_BASE,
    path: '/api/v1/portal',
    maxAge: portalAuthService.ACCESS_SECONDS * 1000,
  });
  res.cookie('fireisp_portal_refresh', refreshToken, {
    ...PORTAL_COOKIE_BASE,
    path: '/api/v1/portal/auth/refresh',
    maxAge: portalAuthService.REFRESH_SECONDS * 1000,
  });
}

function clearPortalCookies(res) {
  res.clearCookie('fireisp_portal_access', { ...PORTAL_COOKIE_BASE, path: '/api/v1/portal' });
  res.clearCookie('fireisp_portal_refresh', { ...PORTAL_COOKIE_BASE, path: '/api/v1/portal/auth/refresh' });
}

// POST /portal/auth/login
router.post('/auth/login', authLimiter, validate(portalLoginSchema), async (req, res, next) => {
  try {
    const result = await portalAuthService.login(req.body);
    setPortalCookies(res, result.accessToken, result.refreshToken);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// POST /portal/auth/refresh
router.post('/auth/refresh', authLimiter, validate(portalRefreshSchema), async (req, res, next) => {
  try {
    const tokenValue = req.cookies?.fireisp_portal_refresh || req.body?.refreshToken;
    if (!tokenValue) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Refresh token required' } });
    }
    const result = await portalAuthService.refreshToken(tokenValue);
    setPortalCookies(res, result.accessToken, result.refreshToken);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// POST /portal/auth/logout
router.post('/auth/logout', async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.fireisp_portal_refresh || req.body?.refreshToken;
    await portalAuthService.logout(refreshToken);
    clearPortalCookies(res);
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
router.get('/invoices', apiLimiter, async (req, res, next) => {
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
      `SELECT id, invoice_number, subtotal, tax_amount, discount_amount, total,
              currency, period_start, period_end, due_date, paid_at, status, created_at
       FROM invoices ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    const [[{ total: count }]] = await db.query(
      `SELECT COUNT(*) AS total FROM invoices ${whereClause}`,
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
    const [rows] = await db.query(
      `SELECT id, invoice_number, subtotal, tax_amount, discount_amount, total,
              currency, period_start, period_end, due_date, paid_at, status, notes, created_at
       FROM invoices
       WHERE id = ? AND client_id = ? AND deleted_at IS NULL`,
      [req.params.id, req.client.id],
    );

    if (!rows[0]) throw new NotFoundError('Invoice');

    const [items] = await db.query(
      'SELECT id, description, quantity, unit_price, amount, tax_rate FROM invoice_items WHERE invoice_id = ? AND deleted_at IS NULL',
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
router.get('/tickets', apiLimiter, async (req, res, next) => {
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
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
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

module.exports = router;
