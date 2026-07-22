// =============================================================================
// FireISP 5.0 — Invoice → CFDI 4.0 conversion ("stamp later")
// =============================================================================
// In an MX-locale org, every invoice starts life as a normal internal invoice
// (identical to a global-locale org). Stamping is the deliberate second step
// that formalizes it: this service converts the invoice into a cfdi_documents
// row + cfdi_conceptos (+ per-concepto IVA traslados), generates the CFDI 4.0
// XML, and submits it to the org's PAC. Once stamped (sat_status = 'vigente')
// the invoice is fiscally bound: line items freeze (assertNoLiveCfdi) and the
// void↔SAT-cancel gating from the terminal-status work takes over.
//
// Field derivation:
//   emisor     — organization_mx_profiles (via cfdiService.getEmisorProfile)
//   receptor   — client_mx_profiles (RFC, razón social, régimen, C.P.)
//   serie/folio— org profile cfdi_serie_ingreso + atomic cfdi_folio_next
//   metodo_pago— PUE when the invoice is already fully paid at stamp time
//                (forma from the settling payment's sat_forma_pago), else PPD
//                (SAT mandates forma_pago '99' Por definir for PPD)
//   conceptos  — invoice_items; per-line SAT codes (migration 408) with ISP
//                defaults 81161700 / E48; ObjetoImp 02 when the invoice
//                carries tax, else 01
//   impuestos  — IVA (002) traslado per concepto at invoices.tax_rate; the
//                last concepto's importe is adjusted so the sum equals the
//                invoice's stored tax_amount exactly (cent-rounding drift)
// =============================================================================

const db = require('../config/database');
const Invoice = require('../models/Invoice');
const { invoiceTaxFraction } = require('./billingService');
const { AppError } = require('../utils/errors');
const cfdiService = require('./cfdiService');
const auditLog = require('./auditLog');
const logger = require('../utils/logger').child({ service: 'invoiceCfdi' });

const DEFAULT_CLAVE_PROD_SERV = '81161700'; // Servicios de acceso a internet
const DEFAULT_CLAVE_UNIDAD = 'E48';         // Unidad de servicio

// Statuses that may be stamped: a real, issued receivable (or one already
// settled). Draft isn't a fiscal document yet; terminal ones never will be.
const STAMPABLE_STATUSES = ['issued', 'sent', 'overdue', 'paid'];

/**
 * Atomically allocate the next CFDI folio for an org (same LAST_INSERT_ID
 * idiom as nextInvoiceNumber — see billingService for the full rationale).
 */
async function nextCfdiFolio(conn, organizationId) {
  await conn.execute(
    'UPDATE organization_mx_profiles SET cfdi_folio_next = LAST_INSERT_ID(cfdi_folio_next) + 1 WHERE organization_id = ? AND deleted_at IS NULL',
    [organizationId],
  );
  const [[row]] = await conn.query('SELECT LAST_INSERT_ID() AS folio');
  return row.folio;
}

/**
 * Convert + stamp an invoice. Returns { cfdi_document_id, uuid, sat_status,
 * serie, folio, stamped } — `stamped: false` with `stamp_error` when the doc
 * was created (sat_status 'draft', XML stored) but the PAC call failed; the
 * operator can retry from the CFDI page without re-converting.
 *
 * @param {number|string} invoiceId
 * @param {number}        orgId
 * @param {object}        opts  { uso_cfdi?, forma_pago?, userId? }
 */
async function stampInvoice(invoiceId, orgId, opts = {}) {
  const invoice = await Invoice.findByIdOrFail(invoiceId, orgId);

  if (!STAMPABLE_STATUSES.includes(invoice.status)) {
    throw new AppError(
      `Only issued, sent, overdue or paid invoices can be stamped (this one is '${invoice.status}').`,
      422, 'INVOICE_NOT_STAMPABLE',
    );
  }

  // A CFDI with Moneda != MXN requires TipoCambio (SAT CFDI40113) and this
  // system has no exchange-rate source — refuse rather than emit invalid XML.
  // (Currency is one-per-org and MX orgs bill MXN; this guards legacy data.)
  if (invoice.currency && invoice.currency !== 'MXN') {
    throw new AppError(
      `Only MXN invoices can be stamped (this one is ${invoice.currency}) — a non-MXN CFDI requires a TipoCambio exchange rate, which is not configured.`,
      422, 'CFDI_UNSUPPORTED_CURRENCY',
    );
  }

  // One CFDI per invoice — fast-path check with the actionable draft-vs-live
  // message. NOT authoritative: the same guard re-runs inside the transaction
  // under a row lock (below) to close the concurrent-stamp race.
  const [existing] = await db.query(
    "SELECT id, sat_status FROM cfdi_documents WHERE invoice_id = ? AND organization_id = ? AND sat_status IN ('draft', 'vigente', 'cancel_pending') LIMIT 1",
    [invoiceId, orgId],
  );
  if (existing[0]) {
    throw new AppError(
      existing[0].sat_status === 'draft'
        ? `A draft CFDI (#${existing[0].id}) already exists for this invoice — retry stamping it from the CFDI page instead of converting again.`
        : `This invoice already has a live CFDI (#${existing[0].id}).`,
      409, 'CFDI_EXISTS',
    );
  }

  // Emisor gate (throws 422 ORG_MX_PROFILE_MISSING with guidance).
  const emisor = await cfdiService.getEmisorProfile(orgId);

  // Receptor: the client's MX fiscal profile.
  const [profiles] = await db.query(
    `SELECT p.rfc, p.razon_social, p.regimen_fiscal, p.codigo_postal_fiscal, p.uso_cfdi_default
       FROM client_mx_profiles p
       JOIN clients c ON c.id = p.client_id AND c.organization_id = ? AND c.deleted_at IS NULL
      WHERE p.client_id = ? AND p.deleted_at IS NULL`,
    [orgId, invoice.client_id],
  );
  const receptor = profiles[0];
  if (!receptor || !receptor.rfc || !receptor.razon_social || !receptor.regimen_fiscal || !receptor.codigo_postal_fiscal) {
    throw new AppError(
      'The client has no complete MX fiscal profile (RFC, razón social, régimen fiscal, C.P.). Complete it on the client page before stamping.',
      422, 'CLIENT_MX_PROFILE_MISSING',
    );
  }

  const [items] = await db.query(
    'SELECT * FROM invoice_items WHERE invoice_id = ? AND deleted_at IS NULL ORDER BY id',
    [invoiceId],
  );
  if (items.length === 0) {
    throw new AppError('The invoice has no line items to convert.', 422, 'NO_LINE_ITEMS');
  }

  // Público en general (XAXX010101000) is a factura global — it must be PUE
  // with a concrete forma de pago (SAT rejects PPD/99 for público), never a
  // deferred-payment invoice with a REP tail.
  const isPublico = receptor.rfc === 'XAXX010101000';

  // PUE (paid in full at stamp time) vs PPD (payment(s) pending → the future
  // payments get REP complements). SAT: PPD must carry forma_pago '99'.
  const isPaid = invoice.status === 'paid';
  let formaPago;
  if (isPaid || isPublico) {
    const [payRows] = await db.query(
      `SELECT p.sat_forma_pago
         FROM payment_allocations pa
         JOIN payments p ON p.id = pa.payment_id AND p.deleted_at IS NULL
        WHERE pa.invoice_id = ? AND pa.deleted_at IS NULL
        ORDER BY pa.id DESC LIMIT 1`,
      [invoiceId],
    );
    formaPago = opts.forma_pago || payRows[0]?.sat_forma_pago || (isPublico ? '01' : '03'); // 01 efectivo / 03 transferencia
  } else {
    formaPago = '99';
  }
  const metodoPago = (isPaid || isPublico) ? 'PUE' : 'PPD';

  const usoCfdi = opts.uso_cfdi || receptor.uso_cfdi_default || 'G03';
  // invoices.tax_rate can carry percent-style values on manually-created
  // invoices (a stored '8' means 8%) — normalize to a fraction exactly like
  // every other totals path (billingService.invoiceTaxFraction), otherwise the
  // per-line IVA math explodes and tasa_o_cuota stores a non-catalog rate.
  const taxRate = invoiceTaxFraction(Number(invoice.tax_rate || 0));
  const subtotal = Number(invoice.subtotal || 0);
  const taxAmount = Number(invoice.tax_amount || 0);
  const total = Number(invoice.total || 0);

  const conn = await db.getConnection();
  let docId;
  try {
    await conn.beginTransaction();

    // Serialize concurrent stampers of the same invoice: the row lock makes
    // the second request wait, and its re-checked guard then sees the first
    // request's committed CFDI (the pre-transaction check above is only a
    // fast-path for the common case — this one is authoritative).
    await conn.execute(
      'SELECT id FROM invoices WHERE id = ? AND organization_id = ? FOR UPDATE',
      [invoiceId, orgId],
    );
    const [locked] = await conn.execute(
      "SELECT id FROM cfdi_documents WHERE invoice_id = ? AND organization_id = ? AND sat_status IN ('draft', 'vigente', 'cancel_pending') LIMIT 1",
      [invoiceId, orgId],
    );
    if (locked[0]) {
      throw new AppError(`This invoice already has a CFDI (#${locked[0].id}).`, 409, 'CFDI_EXISTS');
    }

    const folio = await nextCfdiFolio(conn, orgId);
    const serie = emisor.cfdi_serie_ingreso || 'A';

    const [docResult] = await conn.execute(
      `INSERT INTO cfdi_documents
         (organization_id, client_id, invoice_id, tipo_comprobante, serie, folio,
          uso_cfdi, metodo_pago, forma_pago, moneda, exportacion,
          receptor_rfc, receptor_nombre, receptor_regimen, receptor_cp,
          subtotal, total_impuestos, total, sat_status)
       VALUES (?, ?, ?, 'I', ?, ?, ?, ?, ?, ?, '01', ?, ?, ?, ?, ?, ?, ?, 'draft')`,
      [orgId, invoice.client_id, invoiceId, serie, folio,
        usoCfdi, metodoPago, formaPago, invoice.currency || 'MXN',
        receptor.rfc, receptor.razon_social, receptor.regimen_fiscal, receptor.codigo_postal_fiscal,
        subtotal, taxAmount, total],
    );
    docId = docResult.insertId;

    // Conceptos + per-line IVA. Reconcile rounding on the LAST line so the
    // traslado importes sum exactly to the invoice's stored tax_amount —
    // never recompute invoice totals (they are the billing source of truth).
    let taxRemaining = taxAmount;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const importe = Number(item.amount || 0);
      const objetoImp = taxRate > 0 ? '02' : '01';
      const [cResult] = await conn.execute(
        `INSERT INTO cfdi_conceptos
           (cfdi_document_id, clave_prod_serv, clave_unidad, cantidad, descripcion, valor_unitario, importe, objeto_imp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [docId,
          item.clave_prod_serv || DEFAULT_CLAVE_PROD_SERV,
          item.clave_unidad || DEFAULT_CLAVE_UNIDAD,
          Number(item.quantity || 1), item.description || '',
          Number(item.unit_price || 0), importe, objetoImp],
      );

      if (taxRate > 0) {
        const isLast = i === items.length - 1;
        const lineTax = isLast
          ? Math.round(taxRemaining * 100) / 100
          : Math.round(importe * taxRate * 100) / 100;
        taxRemaining = Math.round((taxRemaining - lineTax) * 100) / 100;
        await conn.execute(
          `INSERT INTO cfdi_concepto_impuestos
             (cfdi_concepto_id, tax_type, impuesto, tipo_factor, base, tasa_o_cuota, importe)
           VALUES (?, 'traslado', '002', 'Tasa', ?, ?, ?)`,
          [cResult.insertId, importe, taxRate.toFixed(6), lineTax],
        );
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }

  await auditLog.log({
    userId: opts.userId ?? null, organizationId: orgId, action: 'stamp_request',
    tableName: 'cfdi_documents', recordId: docId,
    summary: `Invoice ${invoice.invoice_number || invoiceId} converted to CFDI #${docId} (${metodoPago})`,
  });

  // Generate XML, then stamp via the org's PAC. A PAC failure leaves the doc
  // in 'draft' with its XML stored — retryable, never a lost conversion.
  await cfdiService.generateXml(docId);
  try {
    const stampResult = await cfdiService.stamp(docId);
    return {
      cfdi_document_id: docId, serie: emisor.cfdi_serie_ingreso || 'A',
      uuid: stampResult.uuid, sat_status: stampResult.status || 'vigente', stamped: true,
    };
  } catch (err) {
    logger.warn({ invoiceId, docId, err: err.message }, 'CFDI created but PAC stamping failed — retry from the CFDI page');
    return {
      cfdi_document_id: docId, serie: emisor.cfdi_serie_ingreso || 'A',
      uuid: null, sat_status: 'draft', stamped: false, stamp_error: err.message,
    };
  }
}

module.exports = { stampInvoice, nextCfdiFolio, STAMPABLE_STATUSES };
