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
// PDF label translations for multi-language support
// ---------------------------------------------------------------------------
const PDF_LABELS = {
  en: {
    invoice: 'INVOICE', creditNote: 'CREDIT NOTE', quote: 'QUOTE',
    cfdi: 'CFDI 4.0 — Electronic Invoice',
    receipt: 'PAYMENT RECEIPT', receiptId: 'Receipt',
    paymentDate: 'Payment Date', receivedFrom: 'RECEIVED FROM',
    paymentDetails: 'PAYMENT DETAILS', method: 'Method', reference: 'Reference',
    bank: 'Bank', clabe: 'CLABE', allocatedInvoices: 'ALLOCATED INVOICES',
    invoiceNumber: 'Invoice #', allocated: 'Allocated',
    issueDate: 'Issue Date', dueDate: 'Due Date', validUntil: 'Valid Until',
    billTo: 'BILL TO', issuedBy: 'ISSUED BY', client: 'CLIENT',
    description: 'Description', qty: 'Qty', unitPrice: 'Unit Price',
    amount: 'Amount', subtotal: 'Subtotal', tax: 'Tax', total: 'Total',
    notes: 'Notes', terms: 'Terms & Conditions',
    creditReason: 'Reason', originalInvoice: 'Original Invoice',
    uuid: 'Fiscal UUID', rfcEmitter: 'RFC Emitter', rfcReceiver: 'RFC Receiver',
    usoCfdi: 'CFDI Use', paymentMethod: 'Payment Method', paymentForm: 'Payment Form',
    certSerial: 'Certificate Serial', satSeal: 'SAT Digital Seal',
  },
  es: {
    invoice: 'FACTURA', creditNote: 'NOTA DE CRÉDITO', quote: 'COTIZACIÓN',
    cfdi: 'CFDI 4.0 — Comprobante Fiscal Digital',
    receipt: 'RECIBO DE PAGO', receiptId: 'Recibo',
    paymentDate: 'Fecha de Pago', receivedFrom: 'RECIBIDO DE',
    paymentDetails: 'DETALLES DEL PAGO', method: 'Método', reference: 'Referencia',
    bank: 'Banco', clabe: 'CLABE', allocatedInvoices: 'FACTURAS ASIGNADAS',
    invoiceNumber: 'Factura #', allocated: 'Asignado',
    issueDate: 'Fecha de Emisión', dueDate: 'Fecha de Vencimiento', validUntil: 'Válida Hasta',
    billTo: 'FACTURAR A', issuedBy: 'EMITIDO POR', client: 'CLIENTE',
    description: 'Descripción', qty: 'Cant.', unitPrice: 'Precio Unitario',
    amount: 'Importe', subtotal: 'Subtotal', tax: 'IVA', total: 'Total',
    notes: 'Notas', terms: 'Términos y Condiciones',
    creditReason: 'Motivo', originalInvoice: 'Factura Original',
    uuid: 'UUID Fiscal', rfcEmitter: 'RFC Emisor', rfcReceiver: 'RFC Receptor',
    usoCfdi: 'Uso CFDI', paymentMethod: 'Método de Pago', paymentForm: 'Forma de Pago',
    certSerial: 'No. Certificado', satSeal: 'Sello Digital SAT',
  },
};

/**
 * Get PDF labels for a given locale.
 * @param {string} [locale='en'] - 'en' or 'es'
 * @returns {object} Label dictionary
 */
function pdfLabels(locale) {
  return PDF_LABELS[locale] || PDF_LABELS.en;
}

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
async function generateInvoicePdf(invoiceId, { locale = 'en' } = {}) {
  const L = pdfLabels(locale);
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
      .text(L.invoice, PAGE_MARGIN, PAGE_MARGIN);

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
    doc.text(`${L.issueDate}: ${fmtDate(invoice.created_at)}`, 200, y);
    doc.text(`${L.dueDate}: ${fmtDate(invoice.due_date)}`, 380, y);
    y += 20;

    // ---- Bill To ----
    y = drawHR(doc, y);
    doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.muted).text(L.billTo, PAGE_MARGIN, y);
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
      { x: PAGE_MARGIN, width: 260, text: L.description, align: 'left' },
      { x: 320, width: 60, text: L.qty, align: 'center' },
      { x: 385, width: 80, text: L.unitPrice, align: 'right' },
      { x: 470, width: 80, text: L.amount, align: 'right' },
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
    doc.text(`${L.subtotal}:`, totalsX, y, { width: 80, align: 'right' });
    doc.text(fmt(invoice.subtotal, invoice.currency), 470, y, { width: 80, align: 'right' });
    y += 16;
    doc.text(`${L.tax}:`, totalsX, y, { width: 80, align: 'right' });
    doc.text(fmt(invoice.tax_amount, invoice.currency), 470, y, { width: 80, align: 'right' });
    y += 16;
    y = drawHR(doc, y);
    doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.primary);
    doc.text(`${L.total}:`, totalsX, y, { width: 80, align: 'right' });
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

async function generateCreditNotePdf(creditNoteId, { locale = 'en' } = {}) {
  const L = pdfLabels(locale);
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
      .text(L.creditNote, PAGE_MARGIN, PAGE_MARGIN);
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
    doc.text(`${L.issueDate}: ${fmtDate(note.created_at)}`, PAGE_MARGIN, y);
    doc.text(`${L.creditReason}: ${note.reason || 'N/A'}`, 250, y);
    y += 20;

    // Items
    y = drawHR(doc, y);
    y = drawTableRow(doc, y, [
      { x: PAGE_MARGIN, width: 300, text: L.description, align: 'left' },
      { x: 360, width: 60, text: L.qty, align: 'center' },
      { x: 430, width: 80, text: L.amount, align: 'right' },
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
    doc.text(`${L.total}:`, 350, y, { width: 80, align: 'right' });
    doc.text(fmt(note.total, note.currency), 435, y, { width: 80, align: 'right' });

    doc.fontSize(7).font('Helvetica').fillColor(COLORS.muted)
      .text(`Generated by FireISP 5.0 — ${new Date().toISOString()}`, PAGE_MARGIN, 740, { align: 'center', width: doc.page.width - PAGE_MARGIN * 2 });

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Quote PDF
// ---------------------------------------------------------------------------

async function generateQuotePdf(quoteId, { locale = 'en' } = {}) {
  const L = pdfLabels(locale);
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
      .text(L.quote, PAGE_MARGIN, PAGE_MARGIN);
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
    doc.text(`${L.issueDate}: ${fmtDate(quote.created_at)}`, PAGE_MARGIN, y);
    doc.text(`${L.validUntil}: ${fmtDate(quote.valid_until)}`, 250, y);
    doc.text(`Status: ${(quote.status || 'draft').toUpperCase()}`, 420, y);
    y += 20;

    y = drawHR(doc, y);
    y = drawTableRow(doc, y, [
      { x: PAGE_MARGIN, width: 260, text: L.description, align: 'left' },
      { x: 320, width: 60, text: L.qty, align: 'center' },
      { x: 385, width: 80, text: L.unitPrice, align: 'right' },
      { x: 470, width: 80, text: L.amount, align: 'right' },
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
    doc.text(`${L.subtotal}:`, 385, y, { width: 80, align: 'right' });
    doc.text(fmt(quote.subtotal, quote.currency), 470, y, { width: 80, align: 'right' });
    y += 16;
    doc.text(`${L.tax}:`, 385, y, { width: 80, align: 'right' });
    doc.text(fmt(quote.tax_amount, quote.currency), 470, y, { width: 80, align: 'right' });
    y += 16;
    y = drawHR(doc, y);
    doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.secondary);
    doc.text(`${L.total}:`, 385, y, { width: 80, align: 'right' });
    doc.text(fmt(quote.total, quote.currency), 470, y, { width: 80, align: 'right' });

    if (quote.notes) {
      y += 30;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.muted).text(`${L.notes}:`, PAGE_MARGIN, y);
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

async function generateCfdiPdf(cfdiDocumentId, { locale = 'en' } = {}) {
  const L = pdfLabels(locale);
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
      .text(L.cfdi, PAGE_MARGIN, PAGE_MARGIN);

    doc.fontSize(9).font('Helvetica').fillColor(COLORS.muted);
    doc.text(`${L.uuid}: ${cfdi.uuid || 'Pending'}`, PAGE_MARGIN, PAGE_MARGIN + 22);
    doc.text(`Serie: ${cfdi.serie || ''} Folio: ${cfdi.folio || ''}`, PAGE_MARGIN, PAGE_MARGIN + 34);

    let y = 95;
    y = drawHR(doc, y);

    // Emisor
    doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.muted).text(L.issuedBy, PAGE_MARGIN, y);
    y += 12;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.text)
      .text(cfdi.emisor_nombre || cfdi.org_name || '', PAGE_MARGIN, y);
    y += 14;
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.text);
    doc.text(`${L.rfcEmitter}: ${cfdi.emisor_rfc || ''}`, PAGE_MARGIN, y);
    doc.text(`Régimen Fiscal: ${cfdi.emisor_regimen_fiscal || ''}`, 250, y);
    y += 18;

    // Receptor
    doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.muted).text(L.client, PAGE_MARGIN, y);
    y += 12;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.text)
      .text(cfdi.receptor_nombre || '', PAGE_MARGIN, y);
    y += 14;
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.text);
    doc.text(`${L.rfcReceiver}: ${cfdi.receptor_rfc || ''}`, PAGE_MARGIN, y);
    doc.text(`${L.usoCfdi}: ${cfdi.uso_cfdi || ''}`, 200, y);
    doc.text(`Régimen: ${cfdi.receptor_regimen_fiscal || ''}`, 350, y);
    y += 18;

    // Document metadata
    y = drawHR(doc, y);
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.text);
    doc.text(`Tipo: ${cfdi.tipo_comprobante || 'I'}`, PAGE_MARGIN, y);
    doc.text(`${L.paymentMethod}: ${cfdi.metodo_pago || ''}`, 150, y);
    doc.text(`${L.paymentForm}: ${cfdi.forma_pago || ''}`, 280, y);
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
    doc.text(`${L.subtotal}:`, 365, y, { width: 80, align: 'right' });
    doc.text(String(parseFloat(cfdi.subtotal || 0).toFixed(2)), 450, y, { width: 80, align: 'right' });
    y += 16;
    doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.primary);
    doc.text(`${L.total}:`, 365, y, { width: 80, align: 'right' });
    doc.text(`${cfdi.moneda || 'MXN'} ${parseFloat(cfdi.total || 0).toFixed(2)}`, 450, y, { width: 80, align: 'right' });

    // Sello / Cadena
    y += 30;
    if (cfdi.sello_sat) {
      doc.fontSize(6).font('Helvetica').fillColor(COLORS.muted);
      doc.text(`${L.satSeal}:`, PAGE_MARGIN, y);
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

// ---------------------------------------------------------------------------
// Payment Receipt PDF
// ---------------------------------------------------------------------------

/**
 * Generate a payment receipt PDF and return it as a Buffer.
 * @param {number} paymentId
 * @param {{ locale?: string }} options
 * @returns {Promise<Buffer>}
 */
async function generatePaymentReceiptPdf(paymentId, { locale = 'en' } = {}) {
  const L = pdfLabels(locale);

  const [payments] = await db.query(
    `SELECT p.*, cl.first_name, cl.last_name, cl.email, cl.phone, cl.address,
            cl.city, cl.state, cl.country,
            o.name AS org_name, o.email AS org_email, o.phone AS org_phone,
            o.address AS org_address, o.city AS org_city, o.state AS org_state,
            o.country AS org_country
     FROM payments p
     LEFT JOIN clients cl ON cl.id = p.client_id
     LEFT JOIN organizations o ON o.id = cl.organization_id
     WHERE p.id = ? AND p.deleted_at IS NULL`,
    [paymentId],
  );
  const payment = payments[0];
  if (!payment) throw new Error('Payment not found');

  // Fetch allocations with invoice details
  const [allocations] = await db.query(
    `SELECT pa.amount AS allocated_amount, i.invoice_number, i.total AS invoice_total,
            i.currency AS invoice_currency, i.status AS invoice_status
     FROM payment_allocations pa
     LEFT JOIN invoices i ON i.id = pa.invoice_id
     WHERE pa.payment_id = ? AND pa.deleted_at IS NULL
     ORDER BY pa.id`,
    [paymentId],
  );

  const currency = payment.currency || 'MXN';

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: PAGE_MARGIN });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ---- Header ----
    doc.fontSize(20).font('Helvetica-Bold').fillColor(COLORS.success)
      .text(L.receipt, PAGE_MARGIN, PAGE_MARGIN);

    doc.fontSize(10).font('Helvetica').fillColor(COLORS.muted)
      .text(`# ${paymentId}`, PAGE_MARGIN, PAGE_MARGIN + 25);

    // Organization info (top-right)
    const rightX = 350;
    doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.text)
      .text(payment.org_name || 'FireISP', rightX, PAGE_MARGIN, { width: 200, align: 'right' });
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.muted);
    let orgY = PAGE_MARGIN + 16;
    if (payment.org_address) { doc.text(payment.org_address, rightX, orgY, { width: 200, align: 'right' }); orgY += 11; }
    if (payment.org_city || payment.org_state) { doc.text(`${payment.org_city || ''} ${payment.org_state || ''} ${payment.org_country || ''}`.trim(), rightX, orgY, { width: 200, align: 'right' }); orgY += 11; }
    if (payment.org_email) { doc.text(payment.org_email, rightX, orgY, { width: 200, align: 'right' }); orgY += 11; }
    if (payment.org_phone) { doc.text(payment.org_phone, rightX, orgY, { width: 200, align: 'right' }); }

    // ---- Meta section ----
    let y = 110;
    y = drawHR(doc, y);

    doc.fontSize(9).font('Helvetica').fillColor(COLORS.text);
    doc.text(`${L.paymentDate}: ${fmtDate(payment.payment_date || payment.created_at)}`, PAGE_MARGIN, y);
    doc.text(`${L.amount}: ${fmt(payment.amount, currency)}`, 300, y);
    y += 20;

    // ---- Received From ----
    y = drawHR(doc, y);
    doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.muted).text(L.receivedFrom, PAGE_MARGIN, y);
    y += 14;
    doc.fontSize(10).font('Helvetica-Bold').fillColor(COLORS.text)
      .text(`${payment.first_name || ''} ${payment.last_name || ''}`.trim() || 'Client', PAGE_MARGIN, y);
    y += 14;
    doc.fontSize(8).font('Helvetica').fillColor(COLORS.muted);
    if (payment.email) { doc.text(payment.email, PAGE_MARGIN, y); y += 11; }
    if (payment.phone) { doc.text(payment.phone, PAGE_MARGIN, y); y += 11; }
    if (payment.address) { doc.text(`${payment.address} ${payment.city || ''} ${payment.state || ''} ${payment.country || ''}`.trim(), PAGE_MARGIN, y); y += 11; }
    y += 5;

    // ---- Payment Details ----
    y = drawHR(doc, y);
    doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.muted).text(L.paymentDetails, PAGE_MARGIN, y);
    y += 14;

    doc.fontSize(9).font('Helvetica').fillColor(COLORS.text);
    if (payment.payment_method) {
      doc.text(`${L.method}: ${payment.payment_method.replace(/_/g, ' ')}`, PAGE_MARGIN, y);
      y += 14;
    }
    if (payment.reference_number || payment.reference) {
      doc.text(`${L.reference}: ${payment.reference_number || payment.reference}`, PAGE_MARGIN, y);
      y += 14;
    }
    if (payment.bank_name) {
      doc.text(`${L.bank}: ${payment.bank_name}`, PAGE_MARGIN, y);
      y += 14;
    }
    if (payment.clabe) {
      doc.text(`${L.clabe}: ${payment.clabe}`, PAGE_MARGIN, y);
      y += 14;
    }
    y += 5;

    // ---- Amount ----
    y = drawHR(doc, y);
    doc.fontSize(11).font('Helvetica-Bold').fillColor(COLORS.primary);
    doc.text(`${L.total}:`, 385, y, { width: 80, align: 'right' });
    doc.text(fmt(payment.amount, currency), 470, y, { width: 80, align: 'right' });
    y += 25;

    // ---- Allocations table (if any) ----
    if (allocations.length > 0) {
      y = drawHR(doc, y);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.muted).text(L.allocatedInvoices, PAGE_MARGIN, y);
      y += 14;

      const allocCols = [
        { x: PAGE_MARGIN, width: 200, text: L.invoiceNumber, align: 'left' },
        { x: 260, width: 100, text: L.total, align: 'right' },
        { x: 370, width: 80, text: L.allocated, align: 'right' },
        { x: 455, width: 95, text: 'Status', align: 'right' },
      ];
      y = drawTableRow(doc, y, allocCols, { bold: true, color: COLORS.primary, fontSize: 8 });
      y = drawHR(doc, y);

      for (const alloc of allocations) {
        y = drawTableRow(doc, y, [
          { x: PAGE_MARGIN, width: 200, text: alloc.invoice_number || 'N/A', align: 'left' },
          { x: 260, width: 100, text: fmt(alloc.invoice_total, alloc.invoice_currency || currency), align: 'right' },
          { x: 370, width: 80, text: fmt(alloc.allocated_amount, currency), align: 'right' },
          { x: 455, width: 95, text: (alloc.invoice_status || '').toUpperCase(), align: 'right' },
        ]);

        if (y > 700) { doc.addPage(); y = PAGE_MARGIN; }
      }
    }

    // ---- Notes ----
    if (payment.notes) {
      y += 10;
      y = drawHR(doc, y);
      doc.fontSize(8).font('Helvetica-Bold').fillColor(COLORS.muted).text(`${L.notes}:`, PAGE_MARGIN, y);
      y += 12;
      doc.fontSize(8).font('Helvetica').fillColor(COLORS.text).text(payment.notes, PAGE_MARGIN, y, { width: 460 });
    }

    // ---- Footer ----
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
  generatePaymentReceiptPdf,
  // Exported for testing
  fmt,
  fmtDate,
  statusColor,
  pdfLabels,
};
