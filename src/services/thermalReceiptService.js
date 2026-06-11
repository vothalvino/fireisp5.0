// =============================================================================
// FireISP 5.0 — Thermal Receipt Service
// =============================================================================
// Generates plain-text monospaced receipts for 58mm (32 chars) or
// 80mm (48 chars) thermal printers.  No new migration needed — reads
// from the existing invoices, invoice_items, payments, and
// payment_allocations tables.
// =============================================================================

const db = require('../config/database');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Center a string within a given width, padding with spaces.
 */
function center(str, width) {
  str = String(str || '');
  if (str.length >= width) return str.slice(0, width);
  const pad = Math.floor((width - str.length) / 2);
  return ' '.repeat(pad) + str + ' '.repeat(width - pad - str.length);
}

/**
 * Left-justify label, right-justify value, total width.
 */
function labelValue(label, value, width) {
  label = String(label || '');
  value = String(value || '');
  const gap = width - label.length - value.length;
  if (gap <= 0) return (label + ' ' + value).slice(0, width);
  return label + ' '.repeat(gap) + value;
}

/**
 * Wrap long text to lines of at most `width` characters.
 */
function wrap(text, width) {
  const words = String(text || '').split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function divider(width, char = '-') {
  return char.repeat(width);
}

function fmt(amount, currency = '') {
  const num = parseFloat(amount) || 0;
  return (currency ? currency + ' ' : '') + num.toFixed(2);
}

function fmtDate(date) {
  if (!date) return '';
  return new Date(date).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Invoice Thermal Receipt
// ---------------------------------------------------------------------------

/**
 * Generate a plain-text thermal receipt for an invoice.
 * @param {number} invoiceId
 * @param {{ width?: number }} options - width: 32 (58mm) or 48 (80mm), default 48
 * @returns {Promise<string>}
 */
async function generateInvoiceThermalReceipt(invoiceId, { width = 48 } = {}) {
  const [invoices] = await db.query(
    `SELECT i.*,
            CONCAT(cl.first_name, ' ', cl.last_name) AS client_name,
            cl.email AS client_email, cl.phone AS client_phone,
            o.name AS org_name, o.phone AS org_phone, o.email AS org_email
     FROM invoices i
     LEFT JOIN clients cl ON cl.id = i.client_id
     LEFT JOIN organizations o ON o.id = i.organization_id
     WHERE i.id = ?`,
    [invoiceId],
  );
  const inv = invoices[0];
  if (!inv) throw new Error('Invoice not found');

  const [items] = await db.query(
    'SELECT description, quantity, unit_price, amount FROM invoice_items WHERE invoice_id = ? ORDER BY id',
    [invoiceId],
  );

  const lines = [];
  const D = divider(width);
  const D2 = divider(width, '=');

  lines.push(D2);
  lines.push(center(inv.org_name || 'FIREISP', width));
  if (inv.org_phone) lines.push(center(inv.org_phone, width));
  if (inv.org_email) lines.push(center(inv.org_email, width));
  lines.push(D2);
  lines.push(center('INVOICE / FACTURA', width));
  lines.push(center(`#${inv.invoice_number || invoiceId}`, width));
  lines.push(D);
  lines.push(labelValue('Date:', fmtDate(inv.created_at), width));
  lines.push(labelValue('Due:', fmtDate(inv.due_date), width));
  lines.push(labelValue('Status:', (inv.status || 'issued').toUpperCase(), width));
  lines.push(D);
  lines.push('Bill to:');
  lines.push(String(inv.client_name || '').trim() || 'Client');
  if (inv.client_email) lines.push(inv.client_email);
  if (inv.client_phone) lines.push(inv.client_phone);
  lines.push(D);

  // Items
  for (const item of items) {
    const descLines = wrap(item.description || '', width - 10);
    lines.push(descLines[0] || '');
    for (let i = 1; i < descLines.length; i++) lines.push('  ' + descLines[i]);
    const qtyPrice = `${item.quantity || 1} x ${fmt(item.unit_price)}`;
    lines.push(labelValue(qtyPrice, fmt(item.amount, inv.currency), width));
  }

  lines.push(D);
  lines.push(labelValue('Subtotal:', fmt(inv.subtotal, inv.currency), width));
  lines.push(labelValue('Tax:', fmt(inv.tax_amount, inv.currency), width));
  lines.push(D2);
  lines.push(labelValue('TOTAL:', fmt(inv.total, inv.currency), width));
  lines.push(D2);
  lines.push(center('Thank you / Gracias', width));
  lines.push(center(new Date().toISOString().slice(0, 16).replace('T', ' '), width));
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Payment Thermal Receipt
// ---------------------------------------------------------------------------

/**
 * Generate a plain-text thermal receipt for a payment.
 * @param {number} paymentId
 * @param {{ width?: number }} options
 * @returns {Promise<string>}
 */
async function generatePaymentThermalReceipt(paymentId, { width = 48 } = {}) {
  const [payments] = await db.query(
    `SELECT p.*,
            CONCAT(cl.first_name, ' ', cl.last_name) AS client_name,
            cl.email AS client_email, cl.phone AS client_phone,
            o.name AS org_name, o.phone AS org_phone, o.email AS org_email
     FROM payments p
     LEFT JOIN clients cl ON cl.id = p.client_id
     LEFT JOIN organizations o ON o.id = cl.organization_id
     WHERE p.id = ? AND p.deleted_at IS NULL`,
    [paymentId],
  );
  const pay = payments[0];
  if (!pay) throw new Error('Payment not found');

  const [allocs] = await db.query(
    `SELECT pa.amount AS allocated_amount, i.invoice_number
     FROM payment_allocations pa
     LEFT JOIN invoices i ON i.id = pa.invoice_id
     WHERE pa.payment_id = ? AND pa.deleted_at IS NULL`,
    [paymentId],
  );

  const lines = [];
  const D = divider(width);
  const D2 = divider(width, '=');

  lines.push(D2);
  lines.push(center(pay.org_name || 'FIREISP', width));
  if (pay.org_phone) lines.push(center(pay.org_phone, width));
  lines.push(D2);
  lines.push(center('PAYMENT RECEIPT / RECIBO', width));
  lines.push(center(`#${paymentId}`, width));
  lines.push(D);
  lines.push(labelValue('Date:', fmtDate(pay.payment_date || pay.created_at), width));
  lines.push(D);
  lines.push('Received from:');
  lines.push(String(pay.client_name || '').trim() || 'Client');
  if (pay.client_email) lines.push(pay.client_email);
  if (pay.client_phone) lines.push(pay.client_phone);
  lines.push(D);

  if (pay.payment_method) {
    lines.push(labelValue('Method:', pay.payment_method.replace(/_/g, ' '), width));
  }
  if (pay.reference_number || pay.reference) {
    lines.push(labelValue('Ref:', pay.reference_number || pay.reference, width));
  }
  if (pay.bank_name) {
    lines.push(labelValue('Bank:', pay.bank_name, width));
  }

  if (allocs.length > 0) {
    lines.push(D);
    lines.push('Applied to invoices:');
    for (const alloc of allocs) {
      lines.push(labelValue(
        alloc.invoice_number || 'N/A',
        fmt(alloc.allocated_amount, pay.currency),
        width,
      ));
    }
  }

  lines.push(D2);
  lines.push(labelValue('AMOUNT PAID:', fmt(pay.amount, pay.currency), width));
  lines.push(D2);
  lines.push(center('Thank you / Gracias', width));
  lines.push(center(new Date().toISOString().slice(0, 16).replace('T', ' '), width));
  lines.push('');

  return lines.join('\n');
}

module.exports = {
  generateInvoiceThermalReceipt,
  generatePaymentThermalReceipt,
};
