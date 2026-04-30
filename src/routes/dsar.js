// =============================================================================
// FireISP 5.0 — DSAR (Data Subject Access Request) Route (P1.7)
// =============================================================================
// Exports all personal data held for a specific client as a single JSON
// document.  Intended for use by operators processing LFPDPPP (MX) or GDPR
// (EU) data-subject access requests.
//
// Endpoint:
//   GET /api/v1/dsar/clients/:id
//
// Access control:
//   - Requires authentication (JWT)
//   - Requires the `clients.view` permission
//   - Route is mounted under the adminIpAllowlist in app.js
//
// Response:
//   {
//     "meta": { "generatedAt": "<ISO8601>", "requestedBy": "<user_email>",
//               "version": "1.1" },
//     "data": {
//       "client": { ...client row },
//       "contacts": [ ... ],
//       "mxProfile": { ... } | null,
//       "contracts": [ ... ],
//       "invoices": [ ... ],
//       "payments": [ ... ],
//       "tickets": [ ... ],
//       "connectionLogs": [ ... ],
//       "ipAssignments": [ ... ],
//       "aiReplyLogs": [ ... ]   ← draft/final text only; internal prompts redacted
//     }
//   }
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { NotFoundError } = require('../utils/errors');

const router = Router();

router.use(authenticate);
router.use(orgScope);

/**
 * GET /dsar/clients/:id
 *
 * Returns all personal data held for the given client within the
 * authenticated organisation.  The response is suitable for delivery
 * to the data subject in response to a LFPDPPP (MX) or GDPR (EU)
 * data-subject access request (DSAR).
 */
router.get('/clients/:id', requirePermission('clients.view'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const orgId  = req.orgId;

    // ---- core client row --------------------------------------------------
    const [[client]] = await db.query(
      'SELECT id, name, email, phone, client_type, locale, tax_id, address, city, state, zip_code, country, notes, status, created_at, updated_at FROM clients WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [id, orgId],
    );
    if (!client) throw new NotFoundError('Client not found');

    // ---- contacts ---------------------------------------------------------
    const [contacts] = await db.query(
      'SELECT id, name, email, phone, role, created_at FROM contacts WHERE client_id = ? AND deleted_at IS NULL ORDER BY id',
      [id],
    );

    // ---- MX profile (optional) -------------------------------------------
    const [[mxProfile = null]] = await db.query(
      'SELECT id, rfc, curp, regimen_fiscal, uso_cfdi, zip_code, created_at FROM client_mx_profiles WHERE client_id = ? AND deleted_at IS NULL LIMIT 1',
      [id],
    );

    // ---- contracts --------------------------------------------------------
    const [contracts] = await db.query(
      'SELECT id, plan_id, status, start_date, end_date, monthly_price, created_at FROM contracts WHERE client_id = ? AND organization_id = ? ORDER BY id',
      [id, orgId],
    );

    // ---- invoices (summary — no line-items to keep payload manageable) ----
    const [invoices] = await db.query(
      'SELECT id, invoice_number, total, status, due_date, issued_at, created_at FROM invoices WHERE client_id = ? AND organization_id = ? ORDER BY id',
      [id, orgId],
    );

    // ---- payments ---------------------------------------------------------
    const [payments] = await db.query(
      'SELECT id, amount, payment_method, status, paid_at, created_at FROM payments WHERE client_id = ? AND organization_id = ? ORDER BY id',
      [id, orgId],
    );

    // ---- tickets ----------------------------------------------------------
    const [tickets] = await db.query(
      'SELECT id, subject, status, priority, created_at, resolved_at FROM tickets WHERE client_id = ? AND organization_id = ? ORDER BY id',
      [id, orgId],
    );

    // ---- connection logs (most-recent 500 rows) ---------------------------
    const [connectionLogs] = await db.query(
      'SELECT id, username, ip_address, mac_address, nas_id, session_start, session_stop, bytes_in, bytes_out FROM connection_logs WHERE client_id = ? ORDER BY session_start DESC LIMIT 500',
      [id],
    );

    // ---- IP assignments ---------------------------------------------------
    const [ipAssignments] = await db.query(
      'SELECT id, ip_address, type, status, assigned_at, released_at FROM ip_assignments WHERE client_id = ? ORDER BY id',
      [id],
    );

    // ---- AI reply logs (most-recent 200 rows, internal prompts redacted) --
    // draft_text / final_text are the actual replies drafted/sent about the
    // client.  context_snapshot (topology/health data) and prompt_hash
    // (internal operational metadata) are excluded as they do not constitute
    // personal data of the data subject.
    const [aiReplyLogs] = await db.query(
      `SELECT arl.id, arl.ticket_id, arl.action, arl.confidence,
              arl.classification, arl.draft_text, arl.final_text, arl.created_at
       FROM ai_reply_logs arl
       JOIN tickets t ON t.id = arl.ticket_id
       WHERE t.client_id = ? AND arl.organization_id = ?
       ORDER BY arl.created_at DESC
       LIMIT 200`,
      [id, orgId],
    );

    res.json({
      meta: {
        generatedAt:  new Date().toISOString(),
        requestedBy:  req.user && req.user.email,
        clientId:     Number(id),
        organizationId: Number(orgId),
        version:      '1.1',
      },
      data: {
        client,
        contacts,
        mxProfile:      mxProfile || null,
        contracts,
        invoices,
        payments,
        tickets,
        connectionLogs,
        ipAssignments,
        aiReplyLogs,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
