// =============================================================================
// FireISP 5.0 — Support Billing Module (§21.3)
// =============================================================================
// Handles billing-related intents in AI customer support.
// All functions return { response, requiresConfirmation, actionType, actionData }
// =============================================================================
'use strict';
const db = require('../config/database');
const ClientBalanceLedger = require('../models/ClientBalanceLedger');
const logger = require('../utils/logger').child({ service: 'supportBillingModule' });

// ---------------------------------------------------------------------------
// Keyword dispatch table
// ---------------------------------------------------------------------------
const DISPATCH = [
  { pattern: /saldo|balance|adeudo|cuanto debo|how much|deuda/i,           handler: _balanceQuery },
  { pattern: /proximo pago|próximo pago|next due|fecha|vencimiento|cuando pago/i, handler: _nextDueDate },
  { pattern: /cambiar plan|upgrade|cambiar servicio|mejorar/i,             handler: _planUpgrade },
  { pattern: /uso|consumo|datos|usage|bandwidth/i,                         handler: _dataUsage },
  { pattern: /cancelar|cancel|baja/i,                                      handler: _cancellationFlow },
  { pattern: /oxxo|referencia/i,                                           handler: _oxxoReference },
  { pattern: /factura|cfdi|comprobante|fiscal/i,                           handler: _cfdiReceipt },
  { pattern: /dispute|disputa|cobro incorrecto|cargo incorrecto/i,         handler: _overchargeReview },
  { pattern: /planes|lista de planes|opciones/i,                           handler: _planList },
];

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Dispatch a billing intent to the appropriate sub-handler.
 *
 * @param {string} intent          - Detected intent name (informational)
 * @param {object} context         - Conversation context (customer, billing, connection)
 * @param {string} messageContent  - Raw user message
 * @param {number|string} orgId    - Organization ID
 * @returns {Promise<{ response: string, requiresConfirmation: boolean, actionType: string, actionData: object }>}
 */
async function handle(intent, context, messageContent, orgId) {
  const text = messageContent || '';

  for (const entry of DISPATCH) {
    if (entry.pattern.test(text)) {
      return entry.handler(context, messageContent, orgId);
    }
  }

  return _generalBilling(context);
}

// ---------------------------------------------------------------------------
// Sub-handlers
// ---------------------------------------------------------------------------

async function _balanceQuery(context) {
  try {
    const balance = context?.billing?.balance ?? null;
    if (balance !== null) {
      return {
        response: `Tu saldo actual es $${balance} MXN.`,
        requiresConfirmation: false,
        actionType: 'balance_query',
        actionData: { balance },
      };
    }

    // clients has no `balance` column — the running balance is derived from
    // client_balance_ledger via ClientBalanceLedger.signedAmountSql, the
    // single source of truth also used by the statement PDF and the GraphQL
    // resolver (a second, ad-hoc computation here would risk disagreeing
    // with those — see the model's own comment on why that happened before).
    const [rows] = await db.query(
      `SELECT COALESCE(SUM(${ClientBalanceLedger.signedAmountSql}), 0) AS balance
         FROM client_balance_ledger
        WHERE client_id = ?`,
      [context?.customer?.id],
    );
    const bal = rows[0] ? parseFloat(rows[0].balance).toFixed(2) : 'N/A';
    return {
      response: `Tu saldo actual es $${bal} MXN.`,
      requiresConfirmation: false,
      actionType: 'balance_query',
      actionData: { balance: bal },
    };
  } catch (err) {
    logger.warn({ err }, 'billingModule: balance query failed');
    return {
      response: 'No pude consultar tu saldo en este momento. Por favor intenta más tarde.',
      requiresConfirmation: false,
      actionType: 'balance_query',
      actionData: {},
    };
  }
}

async function _nextDueDate(context) {
  try {
    const dueDate = context?.billing?.nextDueDate ?? null;
    if (dueDate) {
      return {
        response: `Tu próximo pago vence el ${dueDate}.`,
        requiresConfirmation: false,
        actionType: 'next_due_date',
        actionData: { nextDueDate: dueDate },
      };
    }

    // MEDIUM — item 6 of the second adversarial review: this used to answer
    // "when is my payment DUE" with billing_periods.scheduled_at — the date
    // the invoice is auto-GENERATED, not the date payment is due. Those can
    // differ by weeks, and scheduled_at can already be in the PAST (the
    // period was invoiced days ago) while still being reported to the
    // customer as their upcoming due date. An actual invoice, once
    // generated, carries its own real `due_date` — that is the only correct
    // source for "when do I need to pay". Prefer the earliest due_date among
    // this client's still-payable invoices (issued/sent/overdue — never
    // draft, paid, cancelled or void). Only when NO invoice has been
    // generated yet do we fall back to telling them when the NEXT billing
    // cycle starts, phrased as that (not as a payment being "due").
    const [invoiceRows] = await db.query(
      `SELECT due_date FROM invoices
        WHERE client_id = ? AND deleted_at IS NULL AND status IN ('issued', 'sent', 'overdue')
        ORDER BY due_date ASC LIMIT 1`,
      [context?.customer?.id],
    );

    if (invoiceRows[0]) {
      const formatted = new Date(invoiceRows[0].due_date).toLocaleDateString('es-MX');
      return {
        response: `Tu próximo pago vence el ${formatted}.`,
        requiresConfirmation: false,
        actionType: 'next_due_date',
        actionData: { nextDueDate: formatted },
      };
    }

    const [periodRows] = await db.query(
      `SELECT bp.scheduled_at AS next_billing_date
         FROM contracts c
         JOIN clients cl ON cl.id = c.client_id
         JOIN billing_periods bp ON bp.contract_id = c.id AND bp.status = 'pending'
        WHERE cl.id = ?
        ORDER BY bp.scheduled_at ASC LIMIT 1`,
      [context?.customer?.id],
    );
    const date = periodRows[0]?.next_billing_date ?? null;
    if (!date) {
      return {
        response: 'No tienes ningún pago pendiente en este momento.',
        requiresConfirmation: false,
        actionType: 'next_due_date',
        actionData: { nextDueDate: null },
      };
    }
    const formatted = new Date(date).toLocaleDateString('es-MX');
    return {
      response: `No tienes una factura pendiente todavía. Tu próximo ciclo de facturación comienza el ${formatted}.`,
      requiresConfirmation: false,
      actionType: 'next_due_date',
      actionData: { nextBillingCycle: formatted },
    };
  } catch (err) {
    logger.warn({ err }, 'billingModule: nextDueDate query failed');
    return {
      response: 'No pude consultar la fecha de vencimiento en este momento.',
      requiresConfirmation: false,
      actionType: 'next_due_date',
      actionData: {},
    };
  }
}

async function _planUpgrade(context, messageContent, orgId) {
  try {
    const [plans] = await db.query(
      // Real columns: download_speed_mbps/upload_speed_mbps and status='active'
      // (no speed_download/speed_upload/is_active columns).
      'SELECT name, price, download_speed_mbps AS speed_download, upload_speed_mbps AS speed_upload FROM plans WHERE organization_id = ? AND status = \'active\' LIMIT 10',
      [orgId || context?.customer?.orgId],
    );
    const planText = plans.length > 0
      ? plans.map(p => `• ${p.name}: $${p.price} MXN — ↓${p.speed_download}/${p.speed_upload}↑ Mbps`).join('\n')
      : 'No hay planes disponibles en este momento.';

    return {
      response: `Para cambiar tu plan, primero confirma cuál deseas. Planes disponibles:\n${planText}\n¿Deseas proceder con el cambio?`,
      requiresConfirmation: true,
      actionType: 'plan_upgrade',
      actionData: { availablePlans: plans },
    };
  } catch (err) {
    logger.warn({ err }, 'billingModule: planUpgrade failed');
    return {
      response: 'No pude cargar los planes disponibles. Por favor contacta a soporte.',
      requiresConfirmation: false,
      actionType: 'plan_upgrade',
      actionData: {},
    };
  }
}

async function _dataUsage(context) {
  try {
    const usage = context?.billing?.dataUsage ?? null;
    if (usage !== null) {
      return {
        response: `Tu consumo actual es de ${usage} GB.`,
        requiresConfirmation: false,
        actionType: 'data_usage',
        actionData: { usage },
      };
    }

    // Fall back to direct DB query on connection_logs
    const [rows] = await db.query(
      `SELECT ROUND(SUM(bytes_in + bytes_out) / 1073741824, 2) AS usage_gb
         FROM connection_logs cl
         JOIN contracts c ON c.id = cl.contract_id
         JOIN clients cli ON cli.id = c.client_id
        WHERE cli.id = ?
          AND cl.event_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`,
      [context?.customer?.id],
    );
    const usageGb = rows[0]?.usage_gb ?? 0;
    return {
      response: `Tu consumo este mes es de ${usageGb} GB.`,
      requiresConfirmation: false,
      actionType: 'data_usage',
      actionData: { usageGb },
    };
  } catch (err) {
    logger.warn({ err }, 'billingModule: dataUsage query failed');
    return {
      response: 'No pude consultar tu uso de datos. Intenta más tarde.',
      requiresConfirmation: false,
      actionType: 'data_usage',
      actionData: {},
    };
  }
}

async function _cancellationFlow(context) {
  return {
    response: 'Lamentamos que desees cancelar tu servicio. Para proceder con la baja, necesitamos tu confirmación. Un agente se pondrá en contacto contigo para gestionar la cancelación. ¿Confirmas que deseas cancelar?',
    requiresConfirmation: true,
    actionType: 'cancellation',
    actionData: { clientId: context?.customer?.id },
  };
}

// eslint-disable-next-line no-unused-vars -- kept for DISPATCH signature parity
async function _oxxoReference(context) {
  // There is no `payment_references` table, or any other store of
  // outstanding OXXO barcode references, anywhere in the schema — generating
  // and tracking a pending cash-payment reference is not yet implemented.
  // The (unconditionally reached) "no pending references" response below is
  // the honest, always-correct answer today; it used to be reached only via a
  // query that could never succeed.
  return {
    response: 'No tienes referencias OXXO pendientes. Si deseas generar una, por favor visita tu portal de cliente.',
    requiresConfirmation: false,
    actionType: 'oxxo_reference',
    actionData: {},
  };
}

async function _cfdiReceipt(context) {
  try {
    // invoices has neither `uuid` nor `folio`/`cfdi_status` — those belong to
    // the linked cfdi_documents row (invoice_number is the invoice's own
    // folio-like field; sat_status='vigente' is "successfully stamped").
    const [rows] = await db.query(
      `SELECT cd.uuid, i.invoice_number AS folio, i.total, i.created_at
         FROM invoices i
         JOIN cfdi_documents cd ON cd.invoice_id = i.id
        WHERE i.client_id = ? AND cd.sat_status = 'vigente'
        ORDER BY i.created_at DESC LIMIT 3`,
      [context?.customer?.id],
    );
    if (rows.length === 0) {
      return {
        response: 'No encontré facturas CFDI recientes en tu cuenta.',
        requiresConfirmation: false,
        actionType: 'cfdi_receipt',
        actionData: {},
      };
    }
    const list = rows.map(r => `• Folio ${r.folio} — $${r.total} MXN — ${new Date(r.created_at).toLocaleDateString('es-MX')}`).join('\n');
    return {
      response: `Tus últimas facturas CFDI:\n${list}\nPuedes descargarlas desde tu portal de cliente.`,
      requiresConfirmation: false,
      actionType: 'cfdi_receipt',
      actionData: { invoices: rows },
    };
  } catch (err) {
    logger.warn({ err }, 'billingModule: cfdiReceipt query failed');
    return {
      response: 'No pude recuperar tus facturas CFDI en este momento.',
      requiresConfirmation: false,
      actionType: 'cfdi_receipt',
      actionData: {},
    };
  }
}

async function _overchargeReview(context, messageContent) {
  try {
    // invoices has no `folio` column — invoice_number is the real one.
    const [rows] = await db.query(
      `SELECT id, invoice_number AS folio, total, created_at
         FROM invoices
        WHERE client_id = ?
        ORDER BY created_at DESC LIMIT 1`,
      [context?.customer?.id],
    );
    const lastInvoice = rows[0] ?? null;
    return {
      response: lastInvoice
        ? `Hemos registrado tu disputa de cobro. Un agente revisará tu factura (Folio: ${lastInvoice.folio}, $${lastInvoice.total} MXN) y te contactará en 24-48 horas.`
        : 'Hemos registrado tu disputa de cobro. Un agente te contactará en 24-48 horas hábiles para resolverla.',
      requiresConfirmation: false,
      actionType: 'overcharge_review',
      actionData: { invoiceId: lastInvoice?.id ?? null, message: messageContent },
    };
  } catch (err) {
    logger.warn({ err }, 'billingModule: overchargeReview failed');
    return {
      response: 'Hemos registrado tu disputa. Un agente te contactará en breve.',
      requiresConfirmation: false,
      actionType: 'overcharge_review',
      actionData: {},
    };
  }
}

async function _planList(context, messageContent, orgId) {
  try {
    const [plans] = await db.query(
      // Real columns: download_speed_mbps/upload_speed_mbps and status='active'
      // (no speed_download/speed_upload/is_active columns).
      'SELECT name, price, download_speed_mbps AS speed_download, upload_speed_mbps AS speed_upload FROM plans WHERE organization_id = ? AND status = \'active\' LIMIT 10',
      [orgId || context?.customer?.orgId],
    );
    if (plans.length === 0) {
      return {
        response: 'No hay planes disponibles en este momento.',
        requiresConfirmation: false,
        actionType: 'plan_list',
        actionData: { plans: [] },
      };
    }
    const planText = plans.map(p => `• ${p.name}: $${p.price} MXN — ↓${p.speed_download} Mbps / ↑${p.speed_upload} Mbps`).join('\n');
    return {
      response: `Nuestros planes disponibles:\n${planText}\n¿Te gustaría cambiar a alguno de ellos?`,
      requiresConfirmation: false,
      actionType: 'plan_list',
      actionData: { plans },
    };
  } catch (err) {
    logger.warn({ err }, 'billingModule: planList query failed');
    return {
      response: 'No pude cargar la lista de planes. Intenta más tarde.',
      requiresConfirmation: false,
      actionType: 'plan_list',
      actionData: {},
    };
  }
}

function _generalBilling() {
  return {
    response: 'Puedo ayudarte con consultas de saldo, fechas de pago, cambios de plan, facturas CFDI, referencias OXXO y más. ¿Qué información necesitas?',
    requiresConfirmation: false,
    actionType: 'billing_general',
    actionData: {},
  };
}

// ---------------------------------------------------------------------------
// Bind handler parameters so dispatch table works with 3-arg signature
// ---------------------------------------------------------------------------
// Rewrite dispatch to pass all args consistently
for (const entry of DISPATCH) {
  const original = entry.handler;
  entry.handler = (ctx, msg, orgId) => original(ctx, msg, orgId);
}

module.exports = { handle };
