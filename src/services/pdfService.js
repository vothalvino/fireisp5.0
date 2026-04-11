// =============================================================================
// FireISP 5.0 — PDF Service
// =============================================================================
// Generates PDF documents for invoices, credit notes, quotes, and CFDI 4.0
// representations using pdfkit. All amounts are formatted with 2 decimal places.
// =============================================================================

const PDFDocument = require('pdfkit');
const db = require('../config/database');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PAGE_MARGIN = 50;
const COLORS = {
  primary: '#1a5276',
  secondary: '#2980b9',
  text: '#2c3e50',
  muted: '#7f8c8d',
  success: '#27ae60',
  danger: '#c0392b',
  border: '#bdc3c7',
  background: '#ecf0f1',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(amount, currency = 'USD') {
  const num = parseFloat(amount) || 0;
  return `${currency} ${num.toFixed(2)}`;
}

function fmtDate(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toISOString().slice(0, 10);
}

function statusColor(status) {
  switch (status) {
    case 'paid':
    case 'active':
    case 'vigente':
      return COLORS.success;
    case 'overdue':
    case 'cancelled':
    case 'cancelado':
    case 'suspended':
      return COLORS.danger;
    default:
      return COLORS.muted;
  }
}

/**
 * Draw a horizontal rule.
 */
function drawHR(doc, y) {
  doc.strokeColor(COLORS.border).lineWidth(0.5)
    .moveTo(PAGE_MARGIN, y).lineTo(doc.page.width - PAGE_MARGIN, y).stroke();
  return y + 10;
}

/**
 * Draw a simple table row.
 */
function drawTableRow(doc, y, columns, opts = {}) {
  const fontSize = opts.fontSize || 9;
  const fontStyle = opts.bold ? 'Helvetica-Bold' : 'Helvetica';
  const color = opts.color || COLORS.text;

  doc.font(fontStyle).fontSize(fontSize).fillColor(color);

  for (const col of columns) {
    doc.text(col.text, col.x, y, {
      width: col.width,
      align: col.align || 'left',
    });
  }

  return y + (opts.lineHeight || 16);
}

// ---------------------------------------------------------------------------
// Invoice PDF
// ---------------------------------------------------------------------------

/**
 * Generate an invoice PDF and return it as a Buffer.
 * @param {number} invoiceId
 * @returns {Promise<Buffer>}
 */
async function generateInvoicePdf(invoiceId) {
  const [invoices] = await db.query(
    `SELECT i.*, cl.first_name, cl.last_name, cl.email, cl.phone, cl.address, cl.city, cl.state, cl.country,
            o.name AS org_name, o.email AS org_email, o.phone AS org_phone,
            o.address AS org_address, o.city AS org_city, o.state AS org_state, o.country AS org_country
     FROM invoices i
     LEFT JOIN clients cl ON cl.id = i.client_id
     LEFT JOIN organizations o ON o.id = i.organization_id
     WHERE i.id = ?`,
    [invoiceId],
  );
  const invoice = invoices[0];
  if (!invoice) throw new Error('Invoice not found');

  const [items] = await db.query(
    'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id',
    [invoiceId],
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: PAGE_MARGIN });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ---- Header ----
    doc.fontSize(20).font('Helvetica-Bold').fillColor(COLORS.primary)
      .text('INVOICE', PAGE_MARGIN, PAGE_MARGIN);

    doc.fontSize(10).font('Helvetica').fillColor(COLORS.muted)
      .text(`# ${invoice.invoice_number || invoiceId}`, PAGE_MARGIN, PAGE_MARGIN + 25);

    // Organization info (top-right)
    const rightX = 350;
    doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.text)
      .text(invoice.org_name || 'FireISP', rightX, PAGE_MARGIN, { width: 200, align: 'right' });
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.muted);
    let orgY = PAGE_MARGIN + 16;
    if (invoice.org_address) { doc.text(invoice.org_address, rightX, orgY, { width: 200, align: 'right' }); orgY += 11; }
    if (invoice.org_city || invoice.org_state) { doc.text(`${invoice.org_city || ''} ${invoice.org_state || ''} ${invoice.org_country || ''}`.trim(), rightX, orgY, { width: 200, align: 'right' }); orgY += 11; }
    if (invoice.org_email) { doc.text(invoice.org_email, rightX, orgY, { width: 200, align: 'right' }); orgY += 11; }
    if (invoice.org_phone) { doc.text(invoice.org_phone, rightX, orgY, { width: 200, align: 'right' }); }

    // ---- Meta section ----
    let y = 110;
    y = drawHR(doc, y);

    // Status badge
    doc.fontSize(9).font('Helvetica-Bold').fillColor(statusColor(invoice.status))
      .text((invoice.status || 'issued').toUpperCase(), PAGE_MARGIN, y);

    doc.fontSize(9).font('Helvetica').fillColor(COLORS.text);
    doc.text(`Issue Date: ${fmtDate(invoice.created_at)}`, 200, y);
    doc.text(`Due Date: ${fmtDate(invoice.due_date)}`, 380, y);
    y += 20;

    // ---- Bill To ----
    y = drawHR(doc, y);
    doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.muted).text('BILL TO', PAGE_MARGIN, y);
    y += 14;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.text)
      .text(`${invoice.first_name || ''} ${invoice.last_name || ''}`.trim() || 'Client', PAGE_MARGIN, y);
    y += 14;
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.muted);
    if (invoice.email) { doc.text(invoice.email, PAGE_MARGIN, y); y += 11; }
    if (invoice.phone) { doc.text(invoice.phone, PAGE_MARGIN, y); y += 11; }
    if (invoice.address) { doc.text(`${invoice.address} ${invoice.city || ''} ${invoice.state || ''} ${invoice.country || ''}`.trim(), PAGE_MARGIN, y); y += 11; }
    y += 5;

    // ---- Line Items Table ----
    y = drawHR(doc, y);
    const cols = [
      { x: PAGE_MARGIN, width: 260, text: 'Description', align: 'left' },
      { x: 320, width: 60, text: 'Qty', align: 'center' },
      { x: 385, width: 80, text: 'Unit Price', align: 'right' },
      { x: 470, width: 80, text: 'Amount', align: 'right' },
    ];
    y = drawTableRow(doc, y, cols, { bold: true, color: COLORS.primary, fontSize: 8 });
    y = drawHR(doc, y);

    for (const item of items) {
      y = drawTableRow(doc, y, [
        { x: PAGE_MARGIN, width: 260, text: item.description || '', align: 'left' },
        { x: 320, width: 60, text: String(item.quantity || 1), align: 'center' },
        { x: 385, width: 80, text: fmt(item.unit_price, invoice.currency), align: 'right' },
        { x: 470, width: 80, text: fmt(item.amount, invoice.currency), align: 'right' },
      ]);

      if (y > 700) { doc.addPage(); y = PAGE_MARGIN; }
    }

    // ---- Totals ----
    y = drawHR(doc, y);
    const totalsX = 385;
    doc.fontSize(9).font('Helvetica').fillColor(COLORS.text);
    doc.text('Subtotal:', totalsX, y, { width: 80, align: 'right' });
    doc.text(fmt(invoice.subtotal, invoice.currency), 470, y, { width: 80, align: 'right' });
    y += 16;
    doc.text('Tax:', totalsX, y, { width: 80, align: 'right' });
    doc.text(fmt(invoice.tax_amount, invoice.currency), 470, y, { width: 80, align: 'right' });
    y += 16;
    y = drawHR(doc, y);
    doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.primary);
    doc.text('Total:', totalsX, y, { width: 80, align: 'right' });
    doc.text(fmt(invoice.total, invoice.currency), 470, y, { width: 80, align: 'right' });

    // ---- Footer ----
    doc.fontSize(7).font('Helvetica').fillColor(COLORS.muted)
      .text(`Generated by FireISP 5.0 — ${new Date().toISOString()}`, PAGE_MARGIN, 740, { align: 'center', width: doc.page.width - PAGE_MARGIN * 2 });

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Credit Note PDF
// ---------------------------------------------------------------------------

async function generateCreditNotePdf(creditNoteId) {
  const [notes] = await db.query(
    `SELECT cn.*, cl.first_name, cl.last_name, cl.email,
            o.name AS org_name
     FROM credit_notes cn
     LEFT JOIN clients cl ON cl.id = cn.client_id
     LEFT JOIN organizations o ON o.id = cn.organization_id
     WHERE cn.id = ?`,
    [creditNoteId],
  );
  const note = notes[0];
  if (!note) throw new Error('Credit note not found');

  const [items] = await db.query(
    'SELECT * FROM credit_note_items WHERE credit_note_id = ? ORDER BY id',
    [creditNoteId],
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: PAGE_MARGIN });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).font('Helvetica-Bold').fillColor(COLORS.danger)
      .text('CREDIT NOTE', PAGE_MARGIN, PAGE_MARGIN);
    doc.fontSize(10).font('Helvetica').fillColor(COLORS.muted)
      .text(`# ${note.credit_note_number || creditNoteId}`, PAGE_MARGIN, PAGE_MARGIN + 25);

    // Organization
    doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.text)
      .text(note.org_name || 'FireISP', 350, PAGE_MARGIN, { width: 200, align: 'right' });

    let y = 100;
    y = drawHR(doc, y);

    // Client
    doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.text)
      .text(`${note.first_name || ''} ${note.last_name || ''}`.trim() || 'Client', PAGE_MARGIN, y);
    if (note.email) { doc.fontSize(8).font('Helvetica').fillColor(COLORS.muted).text(note.email, PAGE_MARGIN, y + 14); }
    y += 35;

    doc.fontSize(9).font('Helvetica').fillColor(COLORS.text);
    doc.text(`Date: ${fmtDate(note.created_at)}`, PAGE_MARGIN, y);
    doc.text(`Reason: ${note.reason || 'N/A'}`, 250, y);
    y += 20;

    // Items
    y = drawHR(doc, y);
    y = drawTableRow(doc, y, [
      { x: PAGE_MARGIN, width: 300, text: 'Description', align: 'left' },
      { x: 360, width: 60, text: 'Qty', align: 'center' },
      { x: 430, width: 80, text: 'Amount', align: 'right' },
    ], { bold: true, color: COLORS.primary, fontSize: 8 });
    y = drawHR(doc, y);

    for (const item of items) {
      y = drawTableRow(doc, y, [
        { x: PAGE_MARGIN, width: 300, text: item.description || '', align: 'left' },
        { x: 360, width: 60, text: String(item.quantity || 1), align: 'center' },
        { x: 430, width: 80, text: fmt(item.amount, note.currency), align: 'right' },
      ]);
    }

    y = drawHR(doc, y);
    doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.danger);
    doc.text('Total Credit:', 350, y, { width: 80, align: 'right' });
    doc.text(fmt(note.total, note.currency), 435, y, { width: 80, align: 'right' });

    doc.fontSize(7).font('Helvetica').fillColor(COLORS.muted)
      .text(`Generated by FireISP 5.0 — ${new Date().toISOString()}`, PAGE_MARGIN, 740, { align: 'center', width: doc.page.width - PAGE_MARGIN * 2 });

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Quote PDF
// ---------------------------------------------------------------------------

async function generateQuotePdf(quoteId) {
  const [quotes] = await db.query(
    `SELECT q.*, cl.first_name, cl.last_name, cl.email,
            o.name AS org_name
     FROM quotes q
     LEFT JOIN clients cl ON cl.id = q.client_id
     LEFT JOIN organizations o ON o.id = q.organization_id
     WHERE q.id = ?`,
    [quoteId],
  );
  const quote = quotes[0];
  if (!quote) throw new Error('Quote not found');

  const [items] = await db.query(
    'SELECT * FROM quote_items WHERE quote_id = ? ORDER BY id',
    [quoteId],
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: PAGE_MARGIN });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).font('Helvetica-Bold').fillColor(COLORS.secondary)
      .text('QUOTE', PAGE_MARGIN, PAGE_MARGIN);
    doc.fontSize(10).font('Helvetica').fillColor(COLORS.muted)
      .text(`# ${quote.quote_number || quoteId}`, PAGE_MARGIN, PAGE_MARGIN + 25);

    doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.text)
      .text(quote.org_name || 'FireISP', 350, PAGE_MARGIN, { width: 200, align: 'right' });

    let y = 100;
    y = drawHR(doc, y);

    doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.text)
      .text(`${quote.first_name || ''} ${quote.last_name || ''}`.trim() || 'Prospect', PAGE_MARGIN, y);
    y += 14;
    if (quote.email) { doc.fontSize(8).font('Helvetica').fillColor(COLORS.muted).text(quote.email, PAGE_MARGIN, y); y += 11; }
    y += 5;

    doc.fontSize(9).font('Helvetica').fillColor(COLORS.text);
    doc.text(`Date: ${fmtDate(quote.created_at)}`, PAGE_MARGIN, y);
    doc.text(`Valid Until: ${fmtDate(quote.valid_until)}`, 250, y);
    doc.text(`Status: ${(quote.status || 'draft').toUpperCase()}`, 420, y);
    y += 20;

    y = drawHR(doc, y);
    y = drawTableRow(doc, y, [
      { x: PAGE_MARGIN, width: 260, text: 'Description', align: 'left' },
      { x: 320, width: 60, text: 'Qty', align: 'center' },
      { x: 385, width: 80, text: 'Unit Price', align: 'right' },
      { x: 470, width: 80, text: 'Amount', align: 'right' },
    ], { bold: true, color: COLORS.primary, fontSize: 8 });
    y = drawHR(doc, y);

    for (const item of items) {
      y = drawTableRow(doc, y, [
        { x: PAGE_MARGIN, width: 260, text: item.description || '', align: 'left' },
        { x: 320, width: 60, text: String(item.quantity || 1), align: 'center' },
        { x: 385, width: 80, text: fmt(item.unit_price, quote.currency), align: 'right' },
        { x: 470, width: 80, text: fmt(item.amount, quote.currency), align: 'right' },
      ]);
    }

    y = drawHR(doc, y);
    doc.fontSize(9).font('Helvetica').fillColor(COLORS.text);
    doc.text('Subtotal:', 385, y, { width: 80, align: 'right' });
    doc.text(fmt(quote.subtotal, quote.currency), 470, y, { width: 80, align: 'right' });
    y += 16;
    doc.text('Tax:', 385, y, { width: 80, align: 'right' });
    doc.text(fmt(quote.tax_amount, quote.currency), 470, y, { width: 80, align: 'right' });
    y += 16;
    y = drawHR(doc, y);
    doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.secondary);
    doc.text('Total:', 385, y, { width: 80, align: 'right' });
    doc.text(fmt(quote.total, quote.currency), 470, y, { width: 80, align: 'right' });

    if (quote.notes) {
      y += 30;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.muted).text('Notes:', PAGE_MARGIN, y);
      y += 12;
      doc.fontSize(8).font('Helvetica').fillColor(COLORS.text).text(quote.notes, PAGE_MARGIN, y, { width: 460 });
    }

    doc.fontSize(7).font('Helvetica').fillColor(COLORS.muted)
      .text(`Generated by FireISP 5.0 — ${new Date().toISOString()}`, PAGE_MARGIN, 740, { align: 'center', width: doc.page.width - PAGE_MARGIN * 2 });

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// CFDI Representation PDF
// ---------------------------------------------------------------------------

async function generateCfdiPdf(cfdiDocumentId) {
  const [docs] = await db.query(
    `SELECT cd.*, o.name AS org_name
     FROM cfdi_documents cd
     LEFT JOIN organizations o ON o.id = cd.organization_id
     WHERE cd.id = ?`,
    [cfdiDocumentId],
  );
  const cfdi = docs[0];
  if (!cfdi) throw new Error('CFDI document not found');

  const [conceptos] = await db.query(
    'SELECT * FROM cfdi_conceptos WHERE cfdi_document_id = ?',
    [cfdiDocumentId],
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: PAGE_MARGIN });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(16).font('Helvetica-Bold').fillColor(COLORS.primary)
      .text('CFDI 4.0 — Comprobante Fiscal Digital', PAGE_MARGIN, PAGE_MARGIN);

    doc.fontSize(9).font('Helvetica').fillColor(COLORS.muted);
    doc.text(`UUID: ${cfdi.uuid || 'Pending'}`, PAGE_MARGIN, PAGE_MARGIN + 22);
    doc.text(`Serie: ${cfdi.serie || ''} Folio: ${cfdi.folio || ''}`, PAGE_MARGIN, PAGE_MARGIN + 34);

    let y = 95;
    y = drawHR(doc, y);

    // Emisor
    doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.muted).text('EMISOR', PAGE_MARGIN, y);
    y += 12;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.text)
      .text(cfdi.emisor_nombre || cfdi.org_name || '', PAGE_MARGIN, y);
    y += 14;
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.text);
    doc.text(`RFC: ${cfdi.emisor_rfc || ''}`, PAGE_MARGIN, y);
    doc.text(`Régimen Fiscal: ${cfdi.emisor_regimen_fiscal || ''}`, 250, y);
    y += 18;

    // Receptor
    doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.muted).text('RECEPTOR', PAGE_MARGIN, y);
    y += 12;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.text)
      .text(cfdi.receptor_nombre || '', PAGE_MARGIN, y);
    y += 14;
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.text);
    doc.text(`RFC: ${cfdi.receptor_rfc || ''}`, PAGE_MARGIN, y);
    doc.text(`Uso CFDI: ${cfdi.uso_cfdi || ''}`, 200, y);
    doc.text(`Régimen: ${cfdi.receptor_regimen_fiscal || ''}`, 350, y);
    y += 18;

    // Document metadata
    y = drawHR(doc, y);
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.text);
    doc.text(`Tipo: ${cfdi.tipo_comprobante || 'I'}`, PAGE_MARGIN, y);
    doc.text(`Método Pago: ${cfdi.metodo_pago || ''}`, 150, y);
    doc.text(`Forma Pago: ${cfdi.forma_pago || ''}`, 280, y);
    doc.text(`Moneda: ${cfdi.moneda || 'MXN'}`, 410, y);
    y += 14;
    doc.text(`Fecha: ${fmtDate(cfdi.fecha_emision)}`, PAGE_MARGIN, y);
    doc.text(`Lugar Expedición: ${cfdi.lugar_expedicion || ''}`, 200, y);
    doc.text(`Exportación: ${cfdi.exportacion || '01'}`, 410, y);
    y += 20;

    // Conceptos
    y = drawHR(doc, y);
    y = drawTableRow(doc, y, [
      { x: PAGE_MARGIN, width: 60, text: 'ClaveProdServ', align: 'left' },
      { x: 115, width: 200, text: 'Descripción', align: 'left' },
      { x: 320, width: 40, text: 'Cant', align: 'center' },
      { x: 365, width: 80, text: 'ValorUnitario', align: 'right' },
      { x: 450, width: 80, text: 'Importe', align: 'right' },
    ], { bold: true, color: COLORS.primary, fontSize: 7 });
    y = drawHR(doc, y);

    for (const c of conceptos) {
      y = drawTableRow(doc, y, [
        { x: PAGE_MARGIN, width: 60, text: c.clave_prod_serv || '', align: 'left' },
        { x: 115, width: 200, text: c.descripcion || '', align: 'left' },
        { x: 320, width: 40, text: String(c.cantidad || 1), align: 'center' },
        { x: 365, width: 80, text: String(parseFloat(c.valor_unitario || 0).toFixed(2)), align: 'right' },
        { x: 450, width: 80, text: String(parseFloat(c.importe || 0).toFixed(2)), align: 'right' },
      ]);

      if (y > 700) { doc.addPage(); y = PAGE_MARGIN; }
    }

    // Totals
    y = drawHR(doc, y);
    doc.fontSize(9).font('Helvetica').fillColor(COLORS.text);
    doc.text('SubTotal:', 365, y, { width: 80, align: 'right' });
    doc.text(String(parseFloat(cfdi.subtotal || 0).toFixed(2)), 450, y, { width: 80, align: 'right' });
    y += 16;
    doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.primary);
    doc.text('Total:', 365, y, { width: 80, align: 'right' });
    doc.text(`${cfdi.moneda || 'MXN'} ${parseFloat(cfdi.total || 0).toFixed(2)}`, 450, y, { width: 80, align: 'right' });

    // Sello / Cadena
    y += 30;
    if (cfdi.sello_sat) {
      doc.fontSize(6).font('Helvetica').fillColor(COLORS.muted);
      doc.text('Sello SAT:', PAGE_MARGIN, y);
      y += 8;
      doc.text(cfdi.sello_sat.slice(0, 120) + '…', PAGE_MARGIN, y, { width: 500 });
      y += 10;
    }

    // SAT Status
    y += 5;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(statusColor(cfdi.sat_status))
      .text(`Estado SAT: ${(cfdi.sat_status || 'draft').toUpperCase()}`, PAGE_MARGIN, y);

    doc.fontSize(7).font('Helvetica').fillColor(COLORS.muted)
      .text(`Generated by FireISP 5.0 — ${new Date().toISOString()}`, PAGE_MARGIN, 740, { align: 'center', width: doc.page.width - PAGE_MARGIN * 2 });

    doc.end();
  });
}

module.exports = {
  generateInvoicePdf,
  generateCreditNotePdf,
  generateQuotePdf,
  generateCfdiPdf,
  // Exported for testing
  fmt,
  fmtDate,
  statusColor,
};
