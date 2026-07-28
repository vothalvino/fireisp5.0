// =============================================================================
// FireISP 5.0 — Credit note → CFDI de Egreso (tipo E) conversion + stamp
// =============================================================================
// A credit note against a STAMPED invoice must itself become a fiscal document:
// a CFDI de Egreso relating to the original ingreso via CfdiRelacionados
// TipoRelacion="01" (nota de crédito de los documentos relacionados). This
// service mirrors invoiceCfdiService.stampInvoice for credit_notes:
//   emisor      — organization_mx_profiles (cfdiService.getEmisorProfile)
//   receptor    — client_mx_profiles
//   serie/folio — org profile cfdi_serie_egreso + shared atomic cfdi_folio_next
//   relación    — the credited invoice's VIGENTE tipo-I CFDI uuid, persisted in
//                 cfdi_related_documents and emitted by buildCfdi40Xml
//   metodo/forma— PUE always (Guía de llenado: an egreso is settled at issue);
//                 forma from the related CFDI when concrete, else '15'
//                 (condonación — the receivable is being forgiven/credited)
//   conceptos   — credit_note_items; a refund-created note has NO items, so a
//                 single synthetic concepto is built from the header totals
//   impuestos   — IVA (002) traslado per concepto at credit_notes.tax_rate,
//                 last-line reconciled to the stored tax_amount (never recompute)
// The stamp/cancel orchestrators (cfdiService.stamp/cancel) are tipo-agnostic
// and reused as-is; sat_status lifecycle + guards apply unchanged.
// =============================================================================

const db = require('../config/database');
const { invoiceTaxFraction } = require('./billingService');
const { AppError } = require('../utils/errors');
const cfdiService = require('./cfdiService');
const { nextCfdiFolio } = require('./invoiceCfdiService');
const auditLog = require('./auditLog');
const logger = require('../utils/logger').child({ service: 'creditNoteCfdi' });

const DEFAULT_CLAVE_PROD_SERV = '81161700'; // Servicios de acceso a internet
const DEFAULT_CLAVE_UNIDAD = 'E48';         // Unidad de servicio

// Only money-real credit notes are fiscal documents: draft isn't a commitment
// yet, cancelled never will be.
const STAMPABLE_STATUSES = ['issued', 'applied'];

/**
 * Everything the egreso is built FROM, resolved through one executor.
 *
 * Mirrors resolveStampInputs in invoiceCfdiService (j48/#585) and exists for
 * the same reason: read before the lock and write after, and an edit
 * committing in that window is filed at SAT from a stale snapshot — a tipo-E
 * CFDI that disagrees with the credit note, undoable only by cancellation.
 *
 * All of it is note-derived and a concurrent edit can change any of it:
 * amounts, line items, client_id (which swaps the receptor) and invoice_id
 * (which swaps the RELATED ingreso — the entire fiscal point of the document).
 *
 * `exec` MUST be the transaction connection on the second call. db.query there
 * would acquire a second pooled connection while this one is held — the
 * nested-acquire hang fixed in #584.
 */
async function resolveEgresoInputs(exec, creditNoteId, orgId, opts) {
  // Resolve through the CLIENT's org: refund-created credit notes are inserted
  // without organization_id (NULL), so a direct org filter would miss them; the
  // client join is the tenant-safe path either way.
  const [cnRows] = await exec(
    `SELECT cn.*, c.tax_exempt
       FROM credit_notes cn
       JOIN clients c ON c.id = cn.client_id AND c.organization_id = ? AND c.deleted_at IS NULL
      WHERE cn.id = ? AND cn.deleted_at IS NULL`,
    [orgId, creditNoteId],
  );
  const cn = cnRows[0];
  if (!cn) throw new AppError('Credit note not found', 404, 'NOT_FOUND');

  if (!STAMPABLE_STATUSES.includes(cn.status)) {
    throw new AppError(
      `Only issued or applied credit notes can be stamped (this one is '${cn.status}').`,
      422, 'CREDIT_NOTE_NOT_STAMPABLE',
    );
  }

  // Same TipoCambio constraint as invoices — MXN only.
  if (cn.currency && cn.currency !== 'MXN') {
    throw new AppError(
      `Only MXN credit notes can be stamped (this one is ${cn.currency}) — a non-MXN CFDI requires a TipoCambio exchange rate, which is not configured.`,
      422, 'CFDI_UNSUPPORTED_CURRENCY',
    );
  }

  // One CFDI per credit note — fast-path; re-checked under lock below.
  const [existing] = await exec(
    "SELECT id, sat_status FROM cfdi_documents WHERE credit_note_id = ? AND organization_id = ? AND sat_status IN ('draft', 'vigente', 'cancel_pending') LIMIT 1",
    [creditNoteId, orgId],
  );
  if (existing[0]) {
    throw new AppError(
      existing[0].sat_status === 'draft'
        ? `A draft CFDI (#${existing[0].id}) already exists for this credit note — retry stamping it from the CFDI page instead of converting again.`
        : `This credit note already has a live CFDI (#${existing[0].id}).`,
      409, 'CFDI_EXISTS',
    );
  }

  // The egreso must RELATE to the stamped ingreso it credits (TipoRelacion 01)
  // — that relation is the entire fiscal point of the document.
  if (!cn.invoice_id) {
    throw new AppError(
      'This credit note is not linked to an invoice — a CFDI de Egreso must relate to the stamped invoice it credits. Set invoice_id first.',
      422, 'CFDI_EGRESO_NO_RELATED',
    );
  }
  const [relRows] = await exec(
    `SELECT id, uuid, forma_pago FROM cfdi_documents
      WHERE invoice_id = ? AND organization_id = ? AND sat_status = 'vigente' AND tipo_comprobante = 'I'
      LIMIT 1`,
    [cn.invoice_id, orgId],
  );
  const relatedCfdi = relRows[0];
  if (!relatedCfdi || !relatedCfdi.uuid) {
    throw new AppError(
      'The credited invoice has no vigente CFDI — stamp the invoice first, then stamp the credit note as its egreso.',
      422, 'CFDI_EGRESO_NO_RELATED',
    );
  }

  // Receptor: the client's MX fiscal profile. Re-resolved from the CURRENT
  // client_id — an edit re-pointing the note at another client changes who the
  // egreso is filed against.
  const [profiles] = await exec(
    `SELECT p.rfc, p.razon_social, p.regimen_fiscal, p.codigo_postal_fiscal, p.uso_cfdi_default
       FROM client_mx_profiles p
      WHERE p.client_id = ? AND p.deleted_at IS NULL`,
    [cn.client_id],
  );
  const receptor = profiles[0];
  if (!receptor || !receptor.rfc || !receptor.razon_social || !receptor.regimen_fiscal || !receptor.codigo_postal_fiscal) {
    throw new AppError(
      'The client has no complete MX fiscal profile (RFC, razón social, régimen fiscal, C.P.). Complete it on the client page before stamping.',
      422, 'CLIENT_MX_PROFILE_MISSING',
    );
  }

  const [items] = await exec(
    'SELECT * FROM credit_note_items WHERE credit_note_id = ? AND deleted_at IS NULL ORDER BY id',
    [creditNoteId],
  );

  const taxRate = invoiceTaxFraction(Number(cn.tax_rate || 0));
  const clientExempt = Boolean(cn.tax_exempt) && taxRate === 0;
  const taxAmount = Number(cn.tax_amount || 0);
  const total = Number(cn.total || 0);
  // Refund-created notes store subtotal = total (tax 0); a manually-entered
  // note may leave subtotal blank — derive it so SubTotal + IVA = Total.
  const subtotal = Number(cn.subtotal || 0) || Math.round((total - taxAmount) * 100) / 100;

  // Internal-consistency gate: credit_notes totals are operator-entered and
  // unvalidated. SAT enforces Total = SubTotal + traslados (CFDI40110) and
  // SubTotal = Σ concepto Importes (CFDI40108) — an inconsistent note would
  // only fail LATER at the PAC with an opaque error, after burning a folio on
  // a lingering draft. Reject up front with an actionable 422 instead.
  if (Math.abs(subtotal + taxAmount - total) > 0.01) {
    throw new AppError(
      `The credit note's amounts are inconsistent: subtotal (${subtotal.toFixed(2)}) + tax (${taxAmount.toFixed(2)}) must equal total (${total.toFixed(2)}). Fix the credit note before stamping.`,
      422, 'CREDIT_NOTE_TOTALS_INCONSISTENT',
    );
  }
  if (items.length > 0) {
    const lineSum = items.reduce(
      (sum, it) => sum + Math.round(Number(it.quantity || 1) * Number(it.unit_price || 0) * 100) / 100, 0,
    );
    if (Math.abs(lineSum - subtotal) > 0.01) {
      throw new AppError(
        `The credit note's line items sum to ${lineSum.toFixed(2)} but its subtotal is ${subtotal.toFixed(2)} — SAT requires SubTotal to equal the sum of concepto importes. Fix the items or the subtotal before stamping.`,
        422, 'CREDIT_NOTE_TOTALS_INCONSISTENT',
      );
    }
  }

  // Guía de llenado (nota de crédito): an egreso is settled the moment it is
  // issued → MetodoPago PUE with a CONCRETE forma. Prefer how the original
  // operation was paid; '99 Por definir' is invalid with PUE, so a PPD original
  // falls back to '15' (condonación — the receivable is being credited away).
  const formaPago = opts.forma_pago
    || (relatedCfdi.forma_pago && relatedCfdi.forma_pago !== '99' ? relatedCfdi.forma_pago : '15');
  const usoCfdi = opts.uso_cfdi || 'G02'; // Devoluciones, descuentos o bonificaciones

  return {
    cn, receptor, items, relatedCfdi, formaPago, usoCfdi,
    taxRate, clientExempt, subtotal, taxAmount, total,
  };
}

/**
 * Convert + stamp a credit note as a CFDI de Egreso. Returns
 * { cfdi_document_id, uuid, sat_status, serie, folio, stamped } —
 * `stamped: false` + `stamp_error` when the doc was created (draft, XML stored)
 * but the PAC call failed; retryable from the CFDI page.
 *
 * @param {number|string} creditNoteId
 * @param {number}        orgId
 * @param {object}        opts  { uso_cfdi?, forma_pago?, userId? }
 */
async function stampCreditNote(creditNoteId, orgId, opts = {}) {
  // Emisor gate FIRST (throws 422 ORG_MX_PROFILE_MISSING with guidance).
  // Org-level configuration, not note-derived, so it is not part of the
  // re-read — and checked before the note-level pre-flight so a brand-new MX
  // org with an unfilled fiscal profile is told THAT, rather than being sent
  // to fix a client profile or an invoice relation first.
  const emisor = await cfdiService.getEmisorProfile(orgId);

  // Pre-flight, on the pool: reject bad requests BEFORE a row lock is taken.
  // Its VALUES are deliberately discarded — only the post-lock read may reach
  // the INSERTs.
  await resolveEgresoInputs(db.query, creditNoteId, orgId, opts);

  const conn = await db.getConnection();
  let docId;
  // Captured from the POST-LOCK read for the audit line, so it describes what
  // was actually filed. Plain values rather than reaching into an object after
  // the try, which would become a TypeError on a fiscal path if a future catch
  // ever swallowed.
  let filedNoteNumber;
  let filedRelatedUuid;
  try {
    await conn.beginTransaction();

    // ORDERING INVARIANT — DO NOT PUT A PLAIN SELECT BETWEEN HERE AND THE
    // `FOR UPDATE` BELOW. Under REPEATABLE READ, InnoDB establishes the
    // consistent read view at the first NON-LOCKING read; FOR UPDATE is a
    // locking read and creates none, so the view is established after the lock
    // is granted. Slip a plain SELECT in and the view snaps early, the re-read
    // returns pre-edit data, and this fix silently reverts WITHOUT failing a
    // test — the suite mocks mysql2 and cannot model MVCC. Same invariant as
    // invoiceCfdiService.
    await conn.execute('SELECT id FROM credit_notes WHERE id = ? FOR UPDATE', [creditNoteId]);

    // THE re-read. Everything written below comes from here, not the
    // pre-flight: an edit that committed in between — new amounts, changed
    // items, a different client or credited invoice — is now visible, and the
    // egreso is built from what the note ACTUALLY says as it is filed.
    // It also re-runs the already-has-a-CFDI check on this connection under
    // this lock, which is what the old post-lock guard here was for, and with
    // the better draft-vs-live message.
    const exec = conn.execute.bind(conn);
    const {
      cn, receptor, items, relatedCfdi, formaPago, usoCfdi,
      taxRate, clientExempt, subtotal, taxAmount, total,
    } = await resolveEgresoInputs(exec, creditNoteId, orgId, opts);
    filedNoteNumber = cn.credit_note_number || creditNoteId;
    filedRelatedUuid = relatedCfdi.uuid;

    const folio = await nextCfdiFolio(conn, orgId);
    const serie = emisor.cfdi_serie_egreso || 'E';

    const [docResult] = await conn.execute(
      `INSERT INTO cfdi_documents
         (organization_id, client_id, credit_note_id, tipo_comprobante, serie, folio,
          uso_cfdi, metodo_pago, forma_pago, moneda, exportacion,
          receptor_rfc, receptor_nombre, receptor_regimen, receptor_cp,
          subtotal, total_impuestos, total, sat_status)
       VALUES (?, ?, ?, 'E', ?, ?, ?, 'PUE', ?, ?, '01', ?, ?, ?, ?, ?, ?, ?, 'draft')`,
      [orgId, cn.client_id, creditNoteId, serie, folio,
        usoCfdi, formaPago, cn.currency || 'MXN',
        receptor.rfc, receptor.razon_social, receptor.regimen_fiscal, receptor.codigo_postal_fiscal,
        subtotal, taxAmount, total],
    );
    docId = docResult.insertId;

    // Persist the relation — buildCfdi40Xml emits it as
    // <cfdi:CfdiRelacionados TipoRelacion="01"><cfdi:CfdiRelacionado UUID=.../>.
    await conn.execute(
      'INSERT INTO cfdi_related_documents (cfdi_document_id, related_uuid, relationship_type) VALUES (?, ?, ?)',
      [docId, relatedCfdi.uuid, '01'],
    );

    // Conceptos: real items, or ONE synthetic line from the header totals when
    // the note has none (the refund-request path creates item-less notes).
    const conceptLines = items.length > 0
      ? items.map(it => ({
        cantidad: Number(it.quantity || 1),
        descripcion: it.description || '',
        valorUnitario: Number(it.unit_price || 0),
        importe: Math.round(Number(it.quantity || 1) * Number(it.unit_price || 0) * 100) / 100,
      }))
      : [{
        cantidad: 1,
        descripcion: cn.notes || `Nota de crédito ${cn.credit_note_number || creditNoteId}`,
        valorUnitario: subtotal,
        importe: subtotal,
      }];

    // Per-line IVA with last-line reconcile so traslados sum EXACTLY to the
    // stored tax_amount (totals are the billing source of truth — never recompute).
    let taxRemaining = taxAmount;
    for (let i = 0; i < conceptLines.length; i++) {
      const line = conceptLines[i];
      const objetoImp = (taxRate > 0 || clientExempt) ? '02' : '01';
      const [cResult] = await conn.execute(
        `INSERT INTO cfdi_conceptos
           (cfdi_document_id, clave_prod_serv, clave_unidad, cantidad, descripcion, valor_unitario, importe, objeto_imp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [docId, DEFAULT_CLAVE_PROD_SERV, DEFAULT_CLAVE_UNIDAD,
          line.cantidad, line.descripcion, line.valorUnitario, line.importe, objetoImp],
      );

      if (taxRate > 0) {
        const isLast = i === conceptLines.length - 1;
        const lineTax = isLast
          ? Math.round(taxRemaining * 100) / 100
          : Math.round(line.importe * taxRate * 100) / 100;
        taxRemaining = Math.round((taxRemaining - lineTax) * 100) / 100;
        await conn.execute(
          `INSERT INTO cfdi_concepto_impuestos
             (cfdi_concepto_id, tax_type, impuesto, tipo_factor, base, tasa_o_cuota, importe)
           VALUES (?, 'traslado', '002', 'Tasa', ?, ?, ?)`,
          [cResult.insertId, line.importe, taxRate.toFixed(6), lineTax],
        );
      } else if (clientExempt) {
        await conn.execute(
          `INSERT INTO cfdi_concepto_impuestos
             (cfdi_concepto_id, tax_type, impuesto, tipo_factor, base, tasa_o_cuota, importe)
           VALUES (?, 'traslado', '002', 'Exento', ?, NULL, NULL)`,
          [cResult.insertId, line.importe],
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
    summary: `Credit note ${filedNoteNumber} converted to CFDI de Egreso #${docId} (rel ${filedRelatedUuid})`,
  });

  // Generate XML, then stamp via the org's PAC. A PAC failure leaves the doc
  // in 'draft' with its XML stored — retryable, never a lost conversion.
  await cfdiService.generateXml(docId);
  try {
    const stampResult = await cfdiService.stamp(docId);
    return {
      cfdi_document_id: docId, serie: emisor.cfdi_serie_egreso || 'E',
      uuid: stampResult.uuid, sat_status: stampResult.status || 'vigente', stamped: true,
      pac_provider: stampResult.provider || null,
    };
  } catch (err) {
    logger.warn({ creditNoteId, docId, err: err.message }, 'Egreso CFDI created but PAC stamping failed — retry from the CFDI page');
    return {
      cfdi_document_id: docId, serie: emisor.cfdi_serie_egreso || 'E',
      uuid: null, sat_status: 'draft', stamped: false, stamp_error: err.message,
    };
  }
}

module.exports = { stampCreditNote, STAMPABLE_STATUSES };
