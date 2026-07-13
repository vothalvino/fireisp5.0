// =============================================================================
// FireISP 5.0 — Support Billing Module (§21.3)
// =============================================================================
// Handles billing-related intents in AI customer support.
// All functions return { response, requiresConfirmation, actionType, actionData }
// =============================================================================
'use strict';
const db = require('../config/database');
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

    const [rows] = await db.query(
      'SELECT balance FROM clients WHERE id = ?',
      [context?.customer?.id],
    );
    const bal = rows[0]?.balance ?? 'N/A';
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

    const [rows] = await db.query(
      `SELECT c.next_billing_date
         FROM contracts c
         JOIN clients cl ON cl.id = c.client_id
        WHERE cl.id = ?
        ORDER BY c.id DESC LIMIT 1`,
      [context?.customer?.id],
    );
    const date = rows[0]?.next_billing_date ?? null;
    const formatted = date ? new Date(date).toLocaleDateString('es-MX') : 'no disponible';
    return {
      response: `Tu próximo pago vence el ${formatted}.`,
      requiresConfirmation: false,
      actionType: 'next_due_date',
      actionData: { nextDueDate: formatted },
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
      'SELECT name, price, speed_download, speed_upload FROM plans WHERE organization_id = ? AND is_active = 1 LIMIT 10',
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

async function _oxxoReference(context) {
  try {
    const [rows] = await db.query(
      `SELECT reference_number, amount, expiry_date
         FROM payment_references
        WHERE client_id = ? AND status = 'pending'
        ORDER BY created_at DESC LIMIT 1`,
      [context?.customer?.id],
    );
    if (rows.length === 0) {
      return {
        response: 'No tienes referencias OXXO pendientes. Si deseas generar una, por favor visita tu portal de cliente.',
        requiresConfirmation: false,
        actionType: 'oxxo_reference',
        actionData: {},
      };
    }
    const ref = rows[0];
    return {
      response: `Tu referencia OXXO es: ${ref.reference_number}\nMonto: $${ref.amount} MXN\nVigente hasta: ${ref.expiry_date ? new Date(ref.expiry_date).toLocaleDateString('es-MX') : 'N/A'}`,
      requiresConfirmation: false,
      actionType: 'oxxo_reference',
      actionData: { reference: ref },
    };
  } catch (err) {
    logger.warn({ err }, 'billingModule: oxxoReference query failed');
    return {
      response: 'No pude recuperar tu referencia OXXO en este momento.',
      requiresConfirmation: false,
      actionType: 'oxxo_reference',
      actionData: {},
    };
  }
}

async function _cfdiReceipt(context) {
  try {
    const [rows] = await db.query(
      `SELECT uuid, folio, total, created_at
         FROM invoices
        WHERE client_id = ? AND cfdi_status = 'stamped'
        ORDER BY created_at DESC LIMIT 3`,
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
    const [rows] = await db.query(
      `SELECT id, folio, total, created_at
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
      'SELECT name, price, speed_download, speed_upload FROM plans WHERE organization_id = ? AND is_active = 1 LIMIT 10',
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
