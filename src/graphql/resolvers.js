// =============================================================================
// FireISP 5.0 — GraphQL Resolvers (P3.3)
// =============================================================================
// Each resolver is org-scoped: it uses ctx.orgId (set by the orgScope Express
// middleware) to ensure users can only query data from their own organization.
//
// Nested field resolvers (e.g. Client.contracts) are intentionally lazy — they
// only run when the client actually requests those fields, so a `clients` query
// that only asks for `name` and `status` never executes the sub-queries.
// =============================================================================

const db = require('../config/database');
const Client = require('../models/Client');
const Contract = require('../models/Contract');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Ticket = require('../models/Ticket');
const AiPolicy = require('../models/AiPolicy');
const ClientBalanceLedger = require('../models/ClientBalanceLedger');
const aiReplyService = require('../services/aiReplyService');
const { computeClientBalance } = require('../services/clientBalanceService');
const { pubsub } = require('../services/pubsub');
const { assertGraphqlPermission, gqlForbidden } = require('./authz');

/** Clamp pagination params to safe bounds. */
function clamp(val, defaultVal, max) {
  const n = parseInt(val, 10);
  if (Number.isNaN(n) || n < 0) return defaultVal;
  return Math.min(n, max);
}

const MAX_LIMIT = 200;

/**
 * Memoize computeClientBalance's PROMISE (not just its resolved value) per
 * request on `ctx`, keyed by client id — the `balance` and `balanceCurrency`
 * field resolvers below are both requested off the same `Client` in a single
 * query and graphql-js kicks off sibling field resolvers concurrently, so a
 * "compute once, read from a cache the other resolver already populated"
 * approach has a race; caching the in-flight promise itself does not.
 *
 * @param {{id: number|string}} client
 * @param {{orgId: number}} ctx
 * @returns {Promise<{balance: number, currency: string}>}
 */
function getClientBalance(client, ctx) {
  if (!ctx._clientBalanceCache) ctx._clientBalanceCache = new Map();
  if (!ctx._clientBalanceCache.has(client.id)) {
    ctx._clientBalanceCache.set(client.id, computeClientBalance(ctx.orgId, client.id));
  }
  return ctx._clientBalanceCache.get(client.id);
}

const resolvers = {
  // ---------------------------------------------------------------------------
  // Root Query resolvers
  // ---------------------------------------------------------------------------
  Query: {
    client: (_parent, { id }, ctx) => Client.findById(id, ctx.orgId),

    clients: (_parent, { limit, offset }, ctx) =>
      Client.findAll({
        orgId: ctx.orgId,
        limit: clamp(limit, 50, MAX_LIMIT),
        offset: clamp(offset, 0, 1e6),
      }),

    contract: (_parent, { id }, ctx) => Contract.findById(id, ctx.orgId),

    invoice: (_parent, { id }, ctx) => Invoice.findById(id, ctx.orgId),

    invoices: (_parent, { limit, offset, clientId }, ctx) =>
      Invoice.findAll({
        where: clientId ? { client_id: clientId } : {},
        orgId: ctx.orgId,
        limit: clamp(limit, 50, MAX_LIMIT),
        offset: clamp(offset, 0, 1e6),
      }),

    payment: (_parent, { id }, ctx) => Payment.findById(id, ctx.orgId),

    ticket: (_parent, { id }, ctx) => Ticket.findById(id, ctx.orgId),

    tickets: (_parent, { limit, offset, clientId }, ctx) =>
      Ticket.findAll({
        where: clientId ? { client_id: clientId } : {},
        orgId: ctx.orgId,
        limit: clamp(limit, 50, MAX_LIMIT),
        offset: clamp(offset, 0, 1e6),
      }),

    // ---- AI Reply Assistant queries (§5.2) ---------------------------------

    aiPolicy: (_parent, _args, ctx) =>
      AiPolicy.findByOrgId(ctx.orgId),

    aiProviders: async (_parent, _args, ctx) => {
      const [rows] = await db.query(
        `SELECT id, organization_id, name, kind, model, endpoint_url,
                temperature, max_tokens, timeout_ms, enabled, priority,
                created_at, updated_at
         FROM ai_providers
         WHERE organization_id = ? AND deleted_at IS NULL
         ORDER BY priority ASC, id ASC`,
        [ctx.orgId],
      );
      return rows;
    },

    aiPhrases: async (_parent, { locale, category, limit, offset }, ctx) => {
      const safeLimit  = clamp(limit,  50, MAX_LIMIT);
      const safeOffset = clamp(offset, 0, 1e6);

      const conditions = ['organization_id = ?', 'deleted_at IS NULL'];
      const params = [ctx.orgId];

      if (locale)   { conditions.push('locale = ?');   params.push(locale); }
      if (category) { conditions.push('category = ?'); params.push(category); }

      const [rows] = await db.query(
        `SELECT * FROM ai_phrase_library WHERE ${conditions.join(' AND ')}
         ORDER BY id ASC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
        params,
      );
      return rows;
    },

    aiReplyLogs: async (_parent, { ticketId, limit, offset }, ctx) => {
      const safeLimit  = clamp(limit,  50, MAX_LIMIT);
      const safeOffset = clamp(offset, 0, 1e6);

      const [rows] = await db.query(
        `SELECT id, ticket_id, provider_id, classification, confidence,
                draft_text, final_text, action, reviewer_user_id,
                prompt_tokens, completion_tokens, cost_usd, duration_ms,
                error, created_at
         FROM ai_reply_logs
         WHERE organization_id = ? AND ticket_id = ?
         ORDER BY created_at DESC
         LIMIT ${safeLimit} OFFSET ${safeOffset}`,
        [ctx.orgId, ticketId],
      );
      return rows;
    },
  },

  // ---------------------------------------------------------------------------
  // Mutation resolvers (§5.2 — aiDraftReply)
  // ---------------------------------------------------------------------------
  Mutation: {
    aiDraftReply: async (_parent, { ticketId, inboundText, channel = 'portal', contractId }, ctx) => {
      const result = await aiReplyService.generate({
        orgId:       ctx.orgId,
        ticketId:    Number(ticketId),
        channel,
        inboundText,
        contractId:  contractId ? Number(contractId) : null,
      });
      return result;
    },
  },

  // ---------------------------------------------------------------------------
  // Client field resolvers
  // ---------------------------------------------------------------------------
  Client: {
    clientType: (c) => c.client_type,
    zipCode: (c) => c.zip_code,
    taxId: (c) => c.tax_id,
    createdAt: (c) => c.created_at,

    contracts: async (client, _args, ctx) => {
      const [rows] = await db.query(
        'SELECT * FROM contracts WHERE client_id = ? AND organization_id = ? AND deleted_at IS NULL ORDER BY id',
        [client.id, ctx.orgId],
      );
      return rows;
    },

    invoices: async (client, _args, ctx) => {
      const [rows] = await db.query(
        'SELECT * FROM invoices WHERE client_id = ? AND organization_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
        [client.id, ctx.orgId],
      );
      return rows;
    },

    payments: async (client, _args, ctx) => {
      const [rows] = await db.query(
        'SELECT * FROM payments WHERE client_id = ? AND organization_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100',
        [client.id, ctx.orgId],
      );
      return rows;
    },

    devices: async (client, _args, ctx) => {
      const [rows] = await db.query(
        `SELECT d.* FROM devices d
         INNER JOIN contracts c ON c.id = d.contract_id
         WHERE c.client_id = ? AND c.organization_id = ? AND d.deleted_at IS NULL`,
        [client.id, ctx.orgId],
      );
      return rows;
    },

    // Current account balance — COMPUTED from invoices + payments, not from
    // the ledger (client_balance_ledger drifts: not every money path writes
    // it — see clientBalanceService's module doc). Postpaid semantics:
    // positive = the client owes us, negative = the client is in credit.
    balance: async (client, _args, ctx) => {
      const { balance } = await getClientBalance(client, ctx);
      return balance.toFixed(2);
    },

    // The currency the computed balance above is denominated in — see
    // clientBalanceService for how it's chosen when a client's payable
    // invoices/payments don't all agree on one currency.
    balanceCurrency: async (client, _args, ctx) => {
      const { currency } = await getClientBalance(client, ctx);
      return currency;
    },

    ledger: async (client, _args, ctx) => {
      // Ledger HISTORY — kept exactly as it was. This is the audit trail
      // (every entry ever written), not the balance source; the headline
      // `balance` field above no longer reads from here. running_balance is
      // still computed on read here (the stored column is unreliable) so
      // each entry's own "Balance After" is internally consistent within the
      // ledger's own bookkeeping — it does NOT necessarily equal `balance`
      // above when the ledger is missing entries for a payable invoice (the
      // exact drift this PR fixes for the headline figure).
      const [rows] = await db.query(
        `SELECT id, organization_id, client_id, entry_type, amount, currency,
                reference_type, reference_id, description, created_at,
                SUM(${ClientBalanceLedger.signedAmountSql}) OVER (ORDER BY created_at, id) AS running_balance
           FROM client_balance_ledger
          WHERE client_id = ? AND organization_id = ?
          ORDER BY created_at DESC, id DESC`,
        [client.id, ctx.orgId],
      );
      return rows;
    },

    contacts: (client) => Client.getContacts(client.id),
  },

  // ---------------------------------------------------------------------------
  // Contact field resolvers
  // ---------------------------------------------------------------------------
  // The contacts table stores first_name/last_name, but GraphQL Contact.name is
  // a single NON-NULL field. Without this mapping `name` resolved to undefined →
  // null, which (via the non-null chain Contact.name! → [Contact!]! →
  // Client.contacts!) errored the whole `client` query and showed
  // "Client not found" for any client that HAS contacts. Same bug class as the
  // LedgerEntry column mismatch fixed earlier — see tests/contactResolver.test.js.
  Contact: {
    name: (c) => {
      const full = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
      // Guarantee a non-null value so a contact can never blank ClientDetail.
      return full || c.name || '(unnamed contact)';
    },
  },

  // ---------------------------------------------------------------------------
  // Contract field resolvers (snake_case → camelCase mapping + nested)
  // ---------------------------------------------------------------------------
  Contract: {
    clientId: (c) => c.client_id,
    planId: (c) => c.plan_id,
    connectionType: (c) => c.connection_type,
    startDate: (c) => c.start_date,
    endDate: (c) => c.end_date,
    billingDay: (c) => c.billing_day,
    ipAddress: (c) => c.ip_address,
    priceOverride: (c) => c.price_override,
    createdAt: (c) => c.created_at,

    client: (contract, _args, ctx) =>
      contract.client_id ? Client.findById(contract.client_id, ctx.orgId) : null,

    invoices: async (contract, _args, ctx) => {
      const [rows] = await db.query(
        'SELECT * FROM invoices WHERE contract_id = ? AND organization_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
        [contract.id, ctx.orgId],
      );
      return rows;
    },

    devices: async (contract, _args, ctx) => {
      const [rows] = await db.query(
        'SELECT * FROM devices WHERE contract_id = ? AND organization_id = ? AND deleted_at IS NULL ORDER BY id',
        [contract.id, ctx.orgId],
      );
      return rows;
    },

    addons: (contract) => Contract.getAddons(contract.id),
  },

  // ---------------------------------------------------------------------------
  // ContractAddon field resolvers (snake_case → camelCase mapping)
  // ---------------------------------------------------------------------------
  ContractAddon: {
    contractId: (a) => a.contract_id,
    planAddonId: (a) => a.plan_addon_id,
    addonName: (a) => a.addon_name || null,
    addonType: (a) => a.addon_type || null,
    quantity: (a) => a.quantity !== null && a.quantity !== undefined ? String(a.quantity) : null,
    unitPrice: (a) => a.unit_price !== null && a.unit_price !== undefined ? String(a.unit_price) : null,
    startDate: (a) => a.start_date || null,
    endDate: (a) => a.end_date || null,
    status: (a) => a.status || 'active',
  },

  // ---------------------------------------------------------------------------
  // Invoice field resolvers
  // ---------------------------------------------------------------------------
  Invoice: {
    clientId: (inv) => inv.client_id,
    contractId: (inv) => inv.contract_id,
    invoiceNumber: (inv) => inv.invoice_number,
    taxAmount: (inv) => inv.tax_amount,
    dueDate: (inv) => inv.due_date,
    paidAt: (inv) => inv.paid_at,
    createdAt: (inv) => inv.created_at,

    client: (inv, _args, ctx) =>
      inv.client_id ? Client.findById(inv.client_id, ctx.orgId) : null,

    items: (inv) => Invoice.getItems(inv.id),

    appliedPayments: async (inv) => {
      const [rows] = await db.query(
        `SELECT pa.*, p.amount AS payment_amount, p.payment_method, p.payment_date
         FROM payment_allocations pa
         JOIN payments p ON p.id = pa.payment_id
         WHERE pa.invoice_id = ? AND pa.deleted_at IS NULL`,
        [inv.id],
      );
      return rows;
    },
  },

  // ---------------------------------------------------------------------------
  // InvoiceItem field resolvers
  // ---------------------------------------------------------------------------
  InvoiceItem: {
    unitPrice: (item) => item.unit_price,
    taxRate: (item) => item.tax_rate,
  },

  // ---------------------------------------------------------------------------
  // AppliedPayment field resolvers
  // ---------------------------------------------------------------------------
  AppliedPayment: {
    paymentId: (ap) => ap.payment_id,
    invoiceId: (ap) => ap.invoice_id,
    paymentAmount: (ap) => ap.payment_amount,
    paymentMethod: (ap) => ap.payment_method,
    paymentDate: (ap) => ap.payment_date,
  },

  // ---------------------------------------------------------------------------
  // Payment field resolvers
  // ---------------------------------------------------------------------------
  Payment: {
    clientId: (p) => p.client_id,
    paymentMethod: (p) => p.payment_method,
    // DB column is reference_number; the GraphQL field is `reference`.
    reference: (p) => p.reference_number || p.reference || null,
    paymentDate: (p) => p.payment_date || null,
    createdAt: (p) => p.created_at,

    client: (payment, _args, ctx) =>
      payment.client_id ? Client.findById(payment.client_id, ctx.orgId) : null,

    allocations: async (payment, _args, ctx) => {
      const [rows] = await db.query(
        `SELECT pa.id, pa.payment_id, pa.invoice_id, pa.amount, pa.deleted_at
         FROM payment_allocations pa
         JOIN invoices i ON i.id = pa.invoice_id
         WHERE pa.payment_id = ? AND pa.deleted_at IS NULL AND i.organization_id = ?`,
        [payment.id, ctx.orgId],
      );
      return rows;
    },
  },

  // ---------------------------------------------------------------------------
  // PaymentAllocation field resolvers
  // ---------------------------------------------------------------------------
  PaymentAllocation: {
    paymentId: (a) => a.payment_id,
    invoiceId: (a) => a.invoice_id,
    amount: (a) => String(a.amount),

    invoice: (alloc, _args, ctx) =>
      alloc.invoice_id ? Invoice.findById(alloc.invoice_id, ctx.orgId) : null,
  },

  // ---------------------------------------------------------------------------
  // Device field resolvers
  // ---------------------------------------------------------------------------
  Device: {
    macAddress: (d) => d.mac_address,
    ipAddress: (d) => d.ip_address,
    contractId: (d) => d.contract_id,
  },

  // ---------------------------------------------------------------------------
  // LedgerEntry field resolvers
  // ---------------------------------------------------------------------------
  LedgerEntry: {
    entryType: (e) => e.entry_type,
    referenceType: (e) => e.reference_type,
    referenceId: (e) => e.reference_id,
    // Column is running_balance (migration 045), not balance_after. The wrong
    // mapping returned undefined for a non-null GraphQL field, which errored the
    // whole client query and broke the ClientDetail page.
    balanceAfter: (e) => e.running_balance,
    // Ledger note column is `description`, not `notes`.
    notes: (e) => e.description,
    // currency is a non-null GraphQL field but the column is nullable (some legacy
    // inserts, e.g. credit-balance refunds, leave it NULL). Fall back so a NULL
    // never errors the whole client query and blanks ClientDetail.
    currency: (e) => e.currency || 'MXN',
    createdAt: (e) => e.created_at,
  },

  // ---------------------------------------------------------------------------
  // Ticket field resolvers
  // ---------------------------------------------------------------------------
  Ticket: {
    clientId: (t) => t.client_id,
    contractId: (t) => t.contract_id,
    assignedTo: (t) => t.assigned_to,
    createdAt: (t) => t.created_at,
    updatedAt: (t) => t.updated_at,

    client: (ticket, _args, ctx) =>
      ticket.client_id ? Client.findById(ticket.client_id, ctx.orgId) : null,

    comments: (ticket) => Ticket.getComments(ticket.id),
  },

  // ---------------------------------------------------------------------------
  // TicketComment field resolvers
  // ---------------------------------------------------------------------------
  TicketComment: {
    ticketId: (c) => c.ticket_id,
    userId: (c) => c.user_id,
    isInternal: (c) => Boolean(c.is_internal),
    createdAt: (c) => c.created_at,
  },

  // ---------------------------------------------------------------------------
  // AI field resolvers (§5.2)
  // ---------------------------------------------------------------------------

  AiPolicy: {
    organizationId: (p) => p.organization_id,
    enabled: (p) => Boolean(p.enabled),
    enabledChannels: (p) => {
      const ch = typeof p.enabled_channels === 'string'
        ? JSON.parse(p.enabled_channels)
        : (p.enabled_channels || {});
      return {
        portal:   Boolean(ch.portal),
        email:    Boolean(ch.email),
        whatsapp: Boolean(ch.whatsapp),
        sms:      Boolean(ch.sms),
      };
    },
    mode: (p) => p.mode,
    autoSendConfidence: (p) => String(p.auto_send_confidence),
    defaultLocale: (p) => p.default_locale,
    tone: (p) => p.tone,
    redactPiiBeforeLlm: (p) => Boolean(p.redact_pii_before_llm),
    activeProviderId: (p) => p.active_provider_id || null,
  },

  AiProvider: {
    organizationId: (p) => p.organization_id,
    endpointUrl: (p) => p.endpoint_url || null,
    maxTokens: (p) => p.max_tokens || null,
    timeoutMs: (p) => p.timeout_ms || null,
    temperature: (p) => p.temperature !== null && p.temperature !== undefined ? String(p.temperature) : null,
    enabled: (p) => Boolean(p.enabled),
    priority: (p) => p.priority ?? 100,
    createdAt: (p) => p.created_at,
    updatedAt: (p) => p.updated_at,
  },

  AiPhrase: {
    organizationId: (p) => p.organization_id,
    isRequired: (p) => Boolean(p.is_required),
    createdAt: (p) => p.created_at || null,
    updatedAt: (p) => p.updated_at || null,
  },

  AiReplyLog: {
    ticketId: (l) => l.ticket_id,
    providerId: (l) => l.provider_id || null,
    reviewerUserId: (l) => l.reviewer_user_id || null,
    draftText: (l) => l.draft_text || null,
    finalText: (l) => l.final_text || null,
    promptTokens: (l) => l.prompt_tokens || null,
    completionTokens: (l) => l.completion_tokens || null,
    costUsd: (l) => l.cost_usd !== null && l.cost_usd !== undefined ? String(l.cost_usd) : null,
    durationMs: (l) => l.duration_ms || null,
    createdAt: (l) => l.created_at,
  },

  AiDraftReplyResult: {
    skipped: (r) => Boolean(r.skipped),
    reason: (r) => r.reason || null,
    logId: (r) => r.logId || null,
    draftText: (r) => r.draftText || null,
    action: (r) => r.action || null,
  },

  // ---------------------------------------------------------------------------
  // Subscription resolvers (P3.9)
  // ---------------------------------------------------------------------------
  Subscription: {
    // Real-time event streams are mounted under authenticate + orgScope, but the
    // GraphQL permission/scope layer and org ownership must be enforced HERE too —
    // otherwise any authenticated org user, or a scope-limited API token, could
    // tap ticket comments (including internal notes) or device-status events they
    // have no RBAC permission to see (parity with the query/mutation guard).
    ticketCommentAdded: {
      subscribe: async function* (_parent, { ticketId }, ctx) {
        await assertGraphqlPermission(ctx, ['tickets.view']);
        // Authorise the ticket against the caller's org — never trust the
        // client-supplied ticketId to belong to them.
        const [rows] = await db.query(
          'SELECT id FROM tickets WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
          [ticketId, ctx.orgId],
        );
        if (!rows[0]) throw gqlForbidden('Ticket not found in your organization');
        for await (const event of pubsub.subscribe('TICKET_COMMENT_ADDED')) {
          if (String(event.ticketId) === String(ticketId)) {
            yield event;
          }
        }
      },
      resolve: (payload) => payload.ticketCommentAdded,
    },

    deviceStatusChanged: {
      subscribe: async function* (_parent, _args, ctx) {
        await assertGraphqlPermission(ctx, ['devices.view']);
        // Scope strictly to the caller's org (ctx.orgId), ignoring any
        // client-supplied orgId argument (which would otherwise let a user tap
        // another organisation's device events under a multi-tenant deployment).
        for await (const event of pubsub.subscribe('DEVICE_STATUS_CHANGED')) {
          if (String(event.orgId) === String(ctx.orgId)) {
            yield event;
          }
        }
      },
      resolve: (payload) => payload.deviceStatusChanged,
    },
  },
};

module.exports = resolvers;
