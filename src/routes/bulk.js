// =============================================================================
// FireISP 5.0 — Bulk Operations Routes
// =============================================================================
// Endpoints for mass operations on clients, invoices, and contracts.
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { bulkEmailLimiter, checkBulkEmailDailyBudget } = require('../middleware/rateLimit');
const bulkSchemas = require('../middleware/schemas/bulk');
const logger = require('../utils/logger');
const eventBus = require('../services/eventBus');
const billingService = require('../services/billingService');
const suspensionService = require('../services/suspensionService');
const emailTransport = require('../services/emailTransport');
const { customMessageEmail } = require('../views/emailTemplates');

const router = Router();

// All bulk routes require authentication AND an org context. `orgScope` was
// missing here entirely — every `req.orgId` reference below was `undefined`,
// so any org-scoped query bound `undefined` as a parameter, which mysql2
// rejects at the driver level ("Bind parameters must not contain undefined").
// That only surfaces against a real MySQL connection — this test suite mocks
// db.query, which happily returns whatever value is queued regardless of the
// (broken) params it was called with, so the bug was invisible to `pnpm test`.
router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// POST /bulk/invoices/void — Mass-void invoices
// ---------------------------------------------------------------------------
router.post('/invoices/void', requirePermission('invoices.update'), validate(bulkSchemas.voidInvoices), async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { invoice_ids } = req.body;

    if (!Array.isArray(invoice_ids) || invoice_ids.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'invoice_ids array is required' } });
    }

    if (invoice_ids.length > 500) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Maximum 500 invoices per batch' } });
    }

    const results = { success: 0, failed: 0, errors: [] };

    for (const invoiceId of invoice_ids) {
      try {
        await billingService.voidInvoiceById(invoiceId, orgId, req.user?.id);
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push({ invoice_id: invoiceId, error: err.message });
      }
    }

    logger.info({ orgId, ...results }, 'Bulk invoice void completed');
    res.json({ data: results });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /bulk/invoices/generate — Mass-generate invoices
// ---------------------------------------------------------------------------
router.post('/invoices/generate', requirePermission('invoices.create'), validate(bulkSchemas.generateInvoices), async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { contract_ids } = req.body;

    if (!Array.isArray(contract_ids) || contract_ids.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'contract_ids array is required' } });
    }

    if (contract_ids.length > 500) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Maximum 500 contracts per batch' } });
    }

    const results = { success: 0, failed: 0, errors: [] };

    for (const contractId of contract_ids) {
      try {
        await db.query(
          `INSERT INTO billing_periods (contract_id, period_start, period_end, status, scheduled_at)
           SELECT ?, DATE_FORMAT(NOW(), '%Y-%m-01'), LAST_DAY(NOW()), 'pending', NOW()
           FROM dual WHERE NOT EXISTS (
             SELECT 1 FROM billing_periods WHERE contract_id = ? AND status = 'pending'
           )`,
          [contractId, contractId],
        );
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push({ contract_id: contractId, error: err.message });
      }
    }

    logger.info({ orgId, ...results }, 'Bulk invoice generation completed');
    eventBus.emit('bulk.invoices.generated', { organizationId: orgId, ...results });

    res.json({ data: results });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /bulk/suspend — Mass-suspend contracts
// ---------------------------------------------------------------------------
router.post('/suspend', requirePermission('contracts.update'), validate(bulkSchemas.suspend), async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { contract_ids, reason } = req.body;

    if (!Array.isArray(contract_ids) || contract_ids.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'contract_ids array is required' } });
    }

    if (contract_ids.length > 500) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Maximum 500 contracts per batch' } });
    }

    const results = { success: 0, failed: 0, errors: [] };

    for (const contractId of contract_ids) {
      try {
        const [rows] = await db.query(
          'SELECT id, status FROM contracts WHERE id = ? AND organization_id = ?',
          [contractId, orgId],
        );
        const contract = rows[0];
        if (!contract) {
          results.failed++;
          results.errors.push({ contract_id: contractId, error: 'Not found' });
          continue;
        }
        // Only an 'active' contract is suspendable — the FSM trigger
        // (trg_contracts_status_fsm_bu) only permits active -> suspended.
        // Attempting suspendContract on a pending/cancelled/terminated/
        // expired/already-suspended row would fail with the trigger's raw
        // 'Invalid contract status transition' SQLSTATE 45000 error instead
        // of a clear per-row message, so filter those out here.
        if (contract.status !== 'active') {
          results.failed++;
          results.errors.push({ contract_id: contractId, error: `Cannot suspend a '${contract.status}' contract` });
          continue;
        }

        // Route through suspensionService.suspendContract — same as
        // POST /contracts/:id/suspend — so a bulk suspension gets the same
        // suspension-exemption check, RADIUS Disconnect-Request, and
        // radius.status flip (fix/network-authz-hardening, PR #388). The
        // previous raw UPDATE here silently skipped all three: exempt
        // clients could be bulk-suspended, no session was kicked, and the
        // subscriber's PPPoE credentials kept authenticating.
        const result = await suspensionService.suspendContract(contractId, null, req.user?.id, null);
        if (result && result.skipped) {
          results.failed++;
          results.errors.push({ contract_id: contractId, error: `Suspension-exempt client: ${result.reason || 'exempt'}` });
          continue;
        }

        results.success++;
        eventBus.emit('contract.suspended', { organizationId: orgId, contractId, reason });
      } catch (err) {
        results.failed++;
        results.errors.push({ contract_id: contractId, error: err.message });
      }
    }

    logger.info({ orgId, ...results }, 'Bulk suspension completed');
    res.json({ data: results });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /bulk/email — Mass-send emails to clients
// ---------------------------------------------------------------------------
// Gated by campaigns.create (communication module), NOT clients.view — a
// mass-send action is a write, not a read, and clients.view is granted
// nearly org-wide (every seeded role, including technician and readonly).
// Before this fix, ANY role that could merely view the client list — even
// readonly, whose whole persona contract is "change nothing" — could
// trigger a free-form, up-to-1000-recipient email blast with zero rate
// limiting. campaigns.create is already correctly scoped to admin/support/
// billing (migration 199) and withheld from technician/readonly.
//
// Two independent rate-limit layers on top of that RBAC gate:
//   1. bulkEmailLimiter — per-IP request-count budget (RATE_LIMIT_BULK_EMAIL,
//      default 10/window), guards against scripted-retry abuse. Runs before
//      requirePermission (matches authLimiter's placement on POST
//      /auth/login) so a caller lacking campaigns.create still consumes
//      budget on a 403 attempt.
//   2. checkBulkEmailDailyBudget — per-organization rolling-24h RECIPIENT
//      count budget (RATE_LIMIT_BULK_EMAIL_DAILY_RECIPIENTS, default
//      5000/day), keyed by req.orgId (no user component — multiple staff in
//      one org share one budget, since request-count alone would still allow
//      up to 10,000 send-attempts/window at 1000 recipients/request). This
//      is the layer that actually caps mail-bombing volume; the per-request
//      hard cap of 1000 clients below is unchanged.
router.post('/email', bulkEmailLimiter, requirePermission('campaigns.create'), validate(bulkSchemas.email), async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { client_ids, subject, body } = req.body;

    if (!Array.isArray(client_ids) || client_ids.length === 0) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'client_ids array is required' } });
    }

    if (client_ids.length > 1000) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Maximum 1000 clients per batch' } });
    }

    // Fetch client emails
    const placeholders = client_ids.map(() => '?').join(',');
    const [clients] = await db.query(
      `SELECT id, email, name FROM clients WHERE id IN (${placeholders}) AND organization_id = ? AND deleted_at IS NULL`,
      [...client_ids, orgId],
    );

    if (clients.length > 0) {
      const budget = await checkBulkEmailDailyBudget(orgId, clients.length);
      if (!budget.allowed) {
        return res.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message: `Daily bulk-email recipient budget exceeded for this organization (${budget.remaining} of the daily budget remaining)`,
          },
        });
      }
    }

    const results = { queued: clients.length, not_found: client_ids.length - clients.length };

    logger.info({ orgId, ...results }, 'Bulk email accepted');
    res.json({ data: results });

    // Detached — do NOT await. Sends with bounded concurrency so up to 1000
    // recipients never sit on the request/response path (mirrors auth.js's
    // fire-and-forget password-reset email). Per-recipient failures are
    // logged, never thrown — one bad address must not abort the batch.
    // KNOWN LIMITATION: a server restart mid-batch drops any not-yet-sent
    // recipients with no automatic retry — acceptable for a first cut (an
    // admin can re-run the same/failed subset).
    const CONCURRENCY = 5;
    let idx = 0;
    async function worker() {
      while (idx < clients.length) {
        const client = clients[idx++];
        try {
          await emailTransport.sendEmail({
            organizationId: orgId,
            clientId: client.id,
            to: client.email,
            subject,
            html: customMessageEmail({ recipientName: client.name, bodyText: body }),
            text: body,
          });
        } catch (err) {
          logger.error({ orgId, clientId: client.id, err: err.message }, 'Bulk email send failed');
        }
      }
    }
    Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, clients.length) }, worker),
    ).catch((err) => {
      logger.error({ orgId, err: err.message }, 'Bulk email detached send loop failed');
    });
  } catch (err) { next(err); }
});

module.exports = router;
