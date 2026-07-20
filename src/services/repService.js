// =============================================================================
// FireISP 5.0 — REP (Complemento de Pago) automation
// =============================================================================
// SAT rule: every payment received against a PPD invoice CFDI must be reported
// with a Complemento de Pago (tipo-P CFDI, "REP"), due by the 5th of the month
// after the payment. This service turns a committed payment allocation into a
// stamped REP:
//
//   allocation (payment → invoice) committed
//     → invoice has a VIGENTE PPD CFDI?          (else: not REP-liable, skip)
//     → compute parcialidad #, saldo anterior/pagado/insoluto from prior REPs
//     → cfdiService.generatePaymentComplement (doc+complement+items+XML)
//     → cfdiService.stamp (simulator/PAC) — failure leaves a retryable draft
//
// Callers on the money paths invoke maybeGenerateRep() BEST-EFFORT after their
// own transaction commits: a REP failure must never roll back or fail a
// payment operation (the money already moved) — it logs and the operator can
// use the manual endpoint / retry the draft from the CFDI page.
// PUE invoices never get a REP (the invoice CFDI itself covers the payment).
// =============================================================================

const db = require('../config/database');
const { AppError } = require('../utils/errors');
const cfdiService = require('./cfdiService');
const { nextCfdiFolio } = require('./invoiceCfdiService');
const auditLog = require('./auditLog');
const logger = require('../utils/logger').child({ service: 'rep' });

// payments.payment_method → SAT c_FormaPago when sat_forma_pago isn't set.
const FORMA_PAGO_BY_METHOD = {
  cash: '01', check: '02', transfer: '03', card: '04', online: '03',
};

/**
 * Generate + stamp a REP for one (payment, invoice) allocation.
 * Returns { generated: false, reason } when the invoice is not REP-liable, or
 * { generated: true, cfdi_document_id, uuid, sat_status, stamped, num_parcialidad }.
 * Throws AppError (4xx) only for operator-actionable problems — callers on
 * automatic paths wrap with maybeGenerateRep() which never throws.
 */
async function generateRepForAllocation(paymentId, invoiceId, allocatedAmount, orgId, userId = null) {
  // REP-liable = the invoice has a live PPD CFDI. (draft = not at SAT yet;
  // PUE = covered by the invoice CFDI; cancelado = nothing to report against.)
  const [cfdis] = await db.query(
    `SELECT id, uuid, serie, folio, total FROM cfdi_documents
      WHERE invoice_id = ? AND organization_id = ? AND sat_status = 'vigente' AND metodo_pago = 'PPD' AND tipo_comprobante = 'I'
      LIMIT 1`,
    [invoiceId, orgId],
  );
  const invoiceCfdi = cfdis[0];
  if (!invoiceCfdi) return { generated: false, reason: 'NO_PPD_CFDI' };

  const [payRows] = await db.query(
    'SELECT * FROM payments WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
    [paymentId, orgId],
  );
  const payment = payRows[0];
  if (!payment) throw new AppError('Payment not found.', 404, 'NOT_FOUND');
  if (payment.currency && payment.currency !== 'MXN') {
    return { generated: false, reason: 'NON_MXN' };
  }

  const [invRows] = await db.query(
    'SELECT id, client_id, total, currency FROM invoices WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
    [invoiceId, orgId],
  );
  const invoice = invRows[0];
  if (!invoice) throw new AppError('Invoice not found.', 404, 'NOT_FOUND');

  const emisor = await cfdiService.getEmisorProfile(orgId);

  const [profRows] = await db.query(
    `SELECT p.rfc, p.razon_social, p.regimen_fiscal, p.codigo_postal_fiscal
       FROM client_mx_profiles p WHERE p.client_id = ? AND p.deleted_at IS NULL`,
    [invoice.client_id],
  );
  const receptor = profRows[0];
  if (!receptor || !receptor.rfc) {
    throw new AppError(
      'The client has no MX fiscal profile (RFC) — required for the payment complement (REP).',
      422, 'CLIENT_MX_PROFILE_MISSING',
    );
  }

  // Parcialidad chain: prior non-cancelled REP items against this CFDI UUID.
  // saldo_ant = invoice CFDI total minus everything already REP-reported.
  const [[prior]] = await db.query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(pci.imp_pagado), 0) AS pagado
       FROM cfdi_payment_complement_items pci
       JOIN cfdi_payment_complements pc ON pc.id = pci.complement_id
       JOIN cfdi_documents d ON d.id = pc.cfdi_document_id
      WHERE pci.related_cfdi_uuid = ? AND d.sat_status IN ('draft', 'vigente', 'cancel_pending')`,
    [invoiceCfdi.uuid],
  );
  const numParcialidad = Number(prior.n) + 1;
  const saldoAnt = Math.round((Number(invoiceCfdi.total) - Number(prior.pagado)) * 100) / 100;
  const impPagado = Math.round(Number(allocatedAmount) * 100) / 100;
  const saldoInsoluto = Math.max(0, Math.round((saldoAnt - impPagado) * 100) / 100);

  // Serie/folio from the org profile (serie Pago + shared atomic folio).
  const conn = await db.getConnection();
  let folio;
  try {
    folio = await nextCfdiFolio(conn, orgId);
  } finally {
    conn.release();
  }

  const formaPago = payment.sat_forma_pago || FORMA_PAGO_BY_METHOD[payment.payment_method] || '03';
  // payments.payment_date is a DATE (mysql2 → Date object); the XML builder
  // and the complement INSERT both want the plain day.
  const paymentDate = payment.payment_date
    ? new Date(payment.payment_date).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const result = await cfdiService.generatePaymentComplement({
    organization_id: orgId,
    client_id: invoice.client_id,
    payment_id: paymentId,
    serie: emisor.cfdi_serie_pago || 'P',
    folio,
    fecha_emision: cfdiService.cfdiExpeditionTime(),
    lugar_expedicion: emisor.codigo_postal_fiscal,
    emisor_rfc: emisor.rfc,
    emisor_nombre: emisor.razon_social,
    emisor_regimen_fiscal: emisor.regimen_fiscal,
    receptor_rfc: receptor.rfc,
    receptor_nombre: receptor.razon_social,
    receptor_domicilio_fiscal: receptor.codigo_postal_fiscal,
    receptor_regimen_fiscal: receptor.regimen_fiscal,
    payment_date: paymentDate,
    forma_pago: formaPago,
    moneda: 'MXN',
    amount: impPagado,
    operation_number: payment.reference_number || null,
    related_documents: [{
      related_cfdi_uuid: invoiceCfdi.uuid,
      serie: invoiceCfdi.serie,
      folio: invoiceCfdi.folio,
      moneda_dr: 'MXN',
      equivalencia_dr: 1.0,
      num_parcialidad: numParcialidad,
      imp_saldo_ant: saldoAnt,
      imp_pagado: impPagado,
      imp_saldo_insoluto: saldoInsoluto,
    }],
  });

  await auditLog.log({
    userId, organizationId: orgId, action: 'rep_generated',
    tableName: 'cfdi_documents', recordId: result.cfdi_document_id,
    summary: `REP for payment #${paymentId} → CFDI ${invoiceCfdi.uuid} (parcialidad ${numParcialidad}, $${impPagado})`,
  });

  // Stamp — a PAC failure leaves the tipo-P doc as a retryable draft.
  try {
    const stamped = await cfdiService.stamp(result.cfdi_document_id);
    return {
      generated: true, cfdi_document_id: result.cfdi_document_id,
      uuid: stamped.uuid, sat_status: stamped.status || 'vigente',
      stamped: true, num_parcialidad: numParcialidad,
    };
  } catch (err) {
    logger.warn({ paymentId, invoiceId, cfdiDocumentId: result.cfdi_document_id, err: err.message },
      'REP created but PAC stamping failed — retry from the CFDI page');
    return {
      generated: true, cfdi_document_id: result.cfdi_document_id,
      uuid: null, sat_status: 'draft', stamped: false,
      stamp_error: err.message, num_parcialidad: numParcialidad,
    };
  }
}

/**
 * Best-effort wrapper for the automatic money paths: never throws, never
 * blocks the payment operation. Call AFTER the allocation transaction commits.
 */
async function maybeGenerateRep(paymentId, invoiceId, allocatedAmount, orgId, userId = null) {
  try {
    const res = await generateRepForAllocation(paymentId, invoiceId, allocatedAmount, orgId, userId);
    if (res.generated) {
      logger.info({ paymentId, invoiceId, cfdiDocumentId: res.cfdi_document_id, stamped: res.stamped }, 'REP generated for allocation');
    }
    return res;
  } catch (err) {
    logger.warn({ paymentId, invoiceId, err: err.message }, 'REP auto-generation skipped (non-fatal) — use the manual Generate REP action');
    return { generated: false, reason: 'ERROR', error: err.message };
  }
}

module.exports = { generateRepForAllocation, maybeGenerateRep };
