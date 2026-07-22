// =============================================================================
// FireISP 5.0 — CFDI Service
// =============================================================================
// Generates CFDI 4.0 XML documents, submits to PAC for stamping,
// and handles cancellation flows.
// =============================================================================

const crypto = require('crypto');
const cfdiSealService = require('./cfdiSealService');
const encryption = require('../utils/encryption');
const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'cfdi' });
const { CfdiStampingError, CfdiCancellationError, AppError } = require('../utils/errors');

// ---------------------------------------------------------------------------
// Simple circuit breaker for PAC stamping calls
// ---------------------------------------------------------------------------
function makeBreaker() {
  return {
    failures: 0,
    lastFailure: 0,
    threshold: 5,       // Open after 5 consecutive failures
    resetMs: 60000,     // Try again after 60 seconds
    isOpen() {
      if (this.failures < this.threshold) return false;
      // Allow a probe after resetMs
      if (Date.now() - this.lastFailure > this.resetMs) return false;
      return true;
    },
    recordSuccess() {
      this.failures = 0;
    },
    recordFailure() {
      this.failures++;
      this.lastFailure = Date.now();
    },
  };
}

// Global aggregate breaker (stamping health across all providers) + a
// per-provider breaker so one down PAC is skipped fast without blocking a
// healthy sibling in a failover setup.
const circuitBreaker = makeBreaker();
const providerBreakers = new Map();
function providerBreaker(pacId) {
  if (!providerBreakers.has(pacId)) providerBreakers.set(pacId, makeBreaker());
  return providerBreakers.get(pacId);
}

// A provider is FAILOVER-ELIGIBLE only when the request provably never reached
// it — connection refused / DNS failure / reset before any response. A TIMEOUT
// or any PAC RESPONSE (even an error) is ambiguous: the document may have been
// registered, so failing over to a different PAC could double-stamp. Those
// stop the loop and leave a retryable draft instead.
// ECONNRESET is deliberately EXCLUDED: a reset over a connection we already
// wrote the full document to may arrive AFTER the PAC registered the CFDI —
// indistinguishable from a pre-send reset — so failing over on it could
// double-stamp. These codes all mean the connection was never established.
const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);
function isUnreachable(err) {
  return !!err && (UNREACHABLE_CODES.has(err.code) || err.pacUnreachable === true);
}

/**
 * Generate CFDI XML for an invoice.
 * Builds the XML structure from cfdi_documents and cfdi_conceptos rows.
 */
/**
 * The expedition timestamp for a CFDI: current moment in Mexico local time,
 * "AAAA-MM-DDThh:mm:ss" (Anexo 20 — no offset, no milliseconds). Uses
 * Intl/America/Mexico_City so the value is correct regardless of server TZ.
 */
function cfdiExpeditionTime(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  // hourCycle quirk: some ICU versions render midnight as "24" with h23 defaults
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}`;
}

/**
 * Bearer token for SW Sapien calls. Two SW auth modes:
 *  - token_encrypted set on the pac row = the portal's long-lived "infinite
 *    token" → used directly, no authenticate round-trip.
 *  - else username/password → POST /security/authenticate → temporary token.
 * NOTE: the credential columns are username_encrypted/password_encrypted —
 * the old code read pac.username (nonexistent), silently authenticating with
 * user: undefined on real rows.
 */
async function swAuthToken(pac, baseUrl) {
  if (pac.token_encrypted) return pac.token_encrypted;
  const authResponse = await httpRequest(`${baseUrl}/security/authenticate`, 'POST',
    JSON.stringify({ user: pac.username_encrypted || pac.username, password: pac.password_encrypted }),
    { 'Content-Type': 'application/json' },
  );
  const authData = JSON.parse(authResponse.body);
  if (!authData.data?.token) {
    throw new Error('SW Sapien authentication failed');
  }
  return authData.data.token;
}

/**
 * Load the issuing organization's fiscal identity (emisor) for a CFDI.
 * Emisor data is deliberately NOT stored per-document — it lives once per org
 * in organization_mx_profiles and is joined at XML-generation time, so a
 * razón-social or régimen correction applies to every future document.
 * Throws a clear 422 when the profile is missing/incomplete rather than
 * emitting XML with blank Emisor attributes (which PACs reject cryptically).
 */
async function getEmisorProfile(organizationId) {
  const [rows] = await db.query(
    `SELECT rfc, razon_social, regimen_fiscal, codigo_postal_fiscal,
            cfdi_serie_ingreso, cfdi_serie_egreso, cfdi_serie_pago
       FROM organization_mx_profiles
      WHERE organization_id = ? AND deleted_at IS NULL`,
    [organizationId],
  );
  const emisor = rows[0];
  if (!emisor || !emisor.rfc || !emisor.razon_social || !emisor.regimen_fiscal || !emisor.codigo_postal_fiscal) {
    throw new AppError(
      'The organization has no complete MX fiscal profile (RFC, razón social, régimen fiscal, C.P.). Configure it under Organization → Fiscal (SAT) before generating CFDIs.',
      422, 'ORG_MX_PROFILE_MISSING',
    );
  }
  return emisor;
}

/**
 * The org's active fiscal environment (organization_mx_profiles.pac_environment:
 * 'sandbox' | 'production'). This is the SINGLE switch that decides which PAC
 * rows are eligible for stamping/cancellation: sandbox and production
 * credentials/endpoints differ per PAC, so each lives on its own pac_providers
 * row (unique key is org+provider+environment) and only the rows matching this
 * value are used. Defaults to 'sandbox' when no profile exists yet — a brand-new
 * org must never accidentally stamp against a production account.
 */
async function orgPacEnvironment(organizationId) {
  const [rows] = await db.query(
    'SELECT pac_environment FROM organization_mx_profiles WHERE organization_id = ? AND deleted_at IS NULL',
    [organizationId],
  );
  return rows[0]?.pac_environment || 'sandbox';
}

async function generateXml(cfdiDocumentId) {
  logger.info({ cfdiDocumentId }, 'Generating CFDI XML');
  const [docs] = await db.query('SELECT * FROM cfdi_documents WHERE id = ?', [cfdiDocumentId]);
  const doc = docs[0];
  if (!doc) throw new Error('CFDI document not found');

  // Only drafts may be (re)generated. Without this gate, generate-xml on a
  // VIGENTE document overwrote its XML and reset sat_status to 'draft' —
  // demoting a stamped CFDI and re-opening it for a second stamp (duplicate
  // at SAT). sat_status must remain writable only by the stamp/cancel flows.
  if (doc.sat_status !== 'draft') {
    throw new AppError(
      `Only draft CFDIs can be regenerated — this document is '${doc.sat_status}'.`,
      422, 'CFDI_NOT_DRAFT',
    );
  }

  const emisor = await getEmisorProfile(doc.organization_id);

  // Tipo P (payment complement / REP): rebuild from the stored complement
  // rows through the Pagos 2.0 builder. Before this branch, generate-xml ran
  // every doc through the INVOICE builder — corrupting a REP draft's XML —
  // which made the "retry a PAC-rejected REP draft after fixing the builder"
  // path (its whole reason to exist) a dead end: xml_content is deliberately
  // not fillable and stamp() sends the stored XML verbatim.
  if (doc.tipo_comprobante === 'P') {
    const [comps] = await db.query(
      'SELECT * FROM cfdi_payment_complements WHERE cfdi_document_id = ?',
      [cfdiDocumentId],
    );
    const complement = comps[0];
    if (!complement) {
      throw new AppError(
        'This tipo-P CFDI has no payment complement record — it cannot be rebuilt.',
        422, 'COMPLEMENT_MISSING',
      );
    }
    const [items] = await db.query(
      'SELECT * FROM cfdi_payment_complement_items WHERE complement_id = ?',
      [complement.id],
    );
    if (items.length === 0) {
      throw new AppError(
        'This payment complement has no related documents — it cannot be rebuilt.',
        422, 'COMPLEMENT_MISSING',
      );
    }
    // Attach the persisted desglose (cfdi_payment_complement_item_taxes).
    // Items with a stored traslado pass through enrichment untouched; legacy
    // items whose objeto_imp_dr is only the column default '02' (no tax rows)
    // get their desglose re-derived from the original CFDI.
    const itemIds = items.map(it => it.id);
    const [taxRows] = await db.query(
      `SELECT * FROM cfdi_payment_complement_item_taxes
        WHERE complement_item_id IN (${itemIds.map(() => '?').join(',')})
          AND tax_type = 'traslado'`,
      itemIds,
    );
    const taxByItem = new Map(taxRows.map(t => [t.complement_item_id, t]));
    const itemsWithTaxes = items.map(it => {
      const t = taxByItem.get(it.id);
      return t
        ? { ...it, traslado_dr: { base: Number(t.base), tasa: t.tasa_o_cuota, importe: Number(t.importe) } }
        : it;
    });
    // payment_date is a DATE column (mysql2 → Date object); the builder wants
    // the plain day string.
    const paymentDate = complement.payment_date instanceof Date
      ? complement.payment_date.toISOString().slice(0, 10)
      : complement.payment_date;
    const enriched = await enrichRelatedDocumentsWithTaxes(itemsWithTaxes, doc.organization_id);
    const xml = buildPaymentComplementXml(
      {
        serie: doc.serie, folio: doc.folio,
        fecha_emision: cfdiExpeditionTime(),
        lugar_expedicion: emisor.codigo_postal_fiscal,
        emisor_rfc: emisor.rfc, emisor_nombre: emisor.razon_social,
        emisor_regimen_fiscal: emisor.regimen_fiscal,
        receptor_rfc: doc.receptor_rfc, receptor_nombre: doc.receptor_nombre,
        receptor_domicilio_fiscal: doc.receptor_cp, receptor_regimen_fiscal: doc.receptor_regimen,
      },
      { ...complement, payment_date: paymentDate },
      enriched,
    );
    await db.query('UPDATE cfdi_documents SET xml_content = ? WHERE id = ?', [xml, cfdiDocumentId]);
    return { cfdi_document_id: cfdiDocumentId, xml };
  }

  // Receptor completeness gate — mirrors the emisor gate. A CFDI with a blank
  // receptor RFC/nombre/régimen/CP is rejected by every PAC with an opaque
  // error; fail fast with an actionable message instead.
  if (!doc.receptor_rfc || !doc.receptor_nombre || !doc.receptor_regimen || !doc.receptor_cp) {
    throw new AppError(
      'The CFDI is missing receptor fiscal data (RFC, nombre, régimen fiscal, C.P.). Complete the client\'s MX fiscal profile and set the receptor fields before generating XML.',
      422, 'RECEPTOR_INCOMPLETE',
    );
  }

  // Fetch related conceptos
  const [conceptos] = await db.query(
    'SELECT * FROM cfdi_conceptos WHERE cfdi_document_id = ?',
    [cfdiDocumentId],
  );

  // Fetch concepto taxes
  const conceptoIds = conceptos.map(c => c.id);
  let impuestos = [];
  if (conceptoIds.length > 0) {
    const placeholders = conceptoIds.map(() => '?').join(',');
    const [rows] = await db.query(
      `SELECT * FROM cfdi_concepto_impuestos WHERE cfdi_concepto_id IN (${placeholders})`,
      conceptoIds,
    );
    impuestos = rows;
  }

  // Build minimal CFDI 4.0 XML structure
  const xml = buildCfdi40Xml(doc, emisor, conceptos, impuestos);

  // Store the generated XML
  await db.query(
    'UPDATE cfdi_documents SET xml_content = ?, sat_status = ? WHERE id = ?',
    [xml, 'draft', cfdiDocumentId],
  );

  return { cfdi_document_id: cfdiDocumentId, xml };
}

/**
 * Build CFDI 4.0 XML string from REAL cfdi_documents columns + the org's
 * emisor profile. (The previous version read seven columns that never existed
 * on the table — fecha_emision, lugar_expedicion, emisor_*, receptor_
 * domicilio_fiscal/regimen_fiscal — silently emitting blank attributes.)
 */
// Público en general (receptor RFC XAXX010101000) requires the
// InformacionGlobal node as the FIRST Comprobante child (Anexo 20 / CFDI40157):
// a factura global covering the period. Periodicidad 01 = daily; Meses/Año
// come from the CFDI date. The receptor rules (Nombre "PUBLICO EN GENERAL",
// RegimenFiscalReceptor 616, DomicilioFiscalReceptor = LugarExpedicion,
// UsoCFDI S01) are supplied by the client's MX profile / stamp options.
function informacionGlobalXml(doc, fecha) {
  if (doc.receptor_rfc !== 'XAXX010101000') return '';
  const anio = String(fecha || '').slice(0, 4) || String(new Date().getFullYear());
  const mes = String(fecha || '').slice(5, 7) || '01';
  return `\n  <cfdi:InformacionGlobal Periodicidad="01" Meses="${mes}" Año="${anio}" />`;
}

function buildCfdi40Xml(doc, emisor, conceptos, impuestos) {
  const conceptosXml = conceptos.map(c => {
    const taxes = impuestos.filter(i => i.cfdi_concepto_id === c.id);
    const taxesXml = taxes.length > 0 ? `
      <cfdi:Impuestos>
        <cfdi:Traslados>
          ${taxes.filter(t => t.tax_type === 'traslado').map(t =>
    `<cfdi:Traslado Base="${t.base}" Impuesto="${t.impuesto}" TipoFactor="${t.tipo_factor}" TasaOCuota="${t.tasa_o_cuota}" Importe="${t.importe}" />`,
  ).join('\n          ')}
        </cfdi:Traslados>
      </cfdi:Impuestos>` : '';

    // Optional attributes must be OMITTED when empty — an empty string
    // violates the XSD pattern (live SW reject: "The 'NoIdentificacion'
    // attribute is invalid ... The Pattern constraint failed").
    const noIdent = c.no_identificacion ? ` NoIdentificacion="${escapeXml(c.no_identificacion)}"` : '';
    return `    <cfdi:Concepto ClaveProdServ="${c.clave_prod_serv || ''}"${noIdent} Cantidad="${c.cantidad}" ClaveUnidad="${c.clave_unidad || ''}" Descripcion="${escapeXml(c.descripcion || '')}" ValorUnitario="${c.valor_unitario}" Importe="${c.importe}" ObjetoImp="${c.objeto_imp || '02'}">${taxesXml}
    </cfdi:Concepto>`;
  }).join('\n');

  // Fecha = the moment of expedition in MEXICO LOCAL time, per Anexo 20
  // ("AAAA-MM-DDThh:mm:ss", no timezone suffix, no milliseconds). A bare
  // toISOString() would be UTC — ~6h ahead of Mexico wall-clock, which PACs
  // reject as a future expedition date after ~18:00 local. America/Mexico_City
  // covers the CST bulk of the country (Mexico abolished DST in 2022); the few
  // border/Sonora/Quintana Roo zones are an accepted approximation until the
  // emisor profile carries an explicit zone.
  const fecha = cfdiExpeditionTime();

  // Comprobante-level tax summary — Anexo 20 requires that when conceptos
  // carry traslados, the Comprobante-level cfdi:Impuestos node repeats them
  // grouped by (Impuesto, TipoFactor, TasaOCuota) with summed Base/Importe,
  // and TotalImpuestosTrasladados equal to the summed Importes (CFDI40110).
  // A bare total attribute with no nested Traslados is rejected by PACs.
  // Exento rows appear as groups without TasaOCuota/Importe and do not count
  // toward the total.
  const traslados = impuestos.filter(i => i.tax_type === 'traslado');
  const groups = new Map();
  for (const t of traslados) {
    const exento = t.tipo_factor === 'Exento';
    const key = `${t.impuesto}|${t.tipo_factor}|${exento ? '' : t.tasa_o_cuota}`;
    const g = groups.get(key) || { impuesto: t.impuesto, tipo_factor: t.tipo_factor, tasa_o_cuota: t.tasa_o_cuota, exento, base: 0, importe: 0 };
    g.base += Number(t.base || 0);
    g.importe += Number(t.importe || 0);
    groups.set(key, g);
  }
  const totalTraslados = [...groups.values()].filter(g => !g.exento)
    .reduce((sum, g) => sum + g.importe, 0);
  const impuestosXml = groups.size > 0 ? `
  <cfdi:Impuestos TotalImpuestosTrasladados="${totalTraslados.toFixed(2)}">
    <cfdi:Traslados>
      ${[...groups.values()].map(g => g.exento
    ? `<cfdi:Traslado Base="${g.base.toFixed(2)}" Impuesto="${g.impuesto}" TipoFactor="Exento" />`
    : `<cfdi:Traslado Base="${g.base.toFixed(2)}" Impuesto="${g.impuesto}" TipoFactor="${g.tipo_factor}" TasaOCuota="${g.tasa_o_cuota}" Importe="${g.importe.toFixed(2)}" />`,
  ).join('\n      ')}
    </cfdi:Traslados>
  </cfdi:Impuestos>` : '';

  // Optional Comprobante attributes are omitted when empty (XSD patterns
  // reject empty strings); xsi:schemaLocation is REQUIRED by PAC validation
  // (live SW reject CC3001 without it).
  const optAttrs = [
    doc.serie ? `  Serie="${escapeXml(doc.serie)}"` : null,
    doc.folio ? `  Folio="${escapeXml(doc.folio)}"` : null,
    doc.forma_pago ? `  FormaPago="${doc.forma_pago}"` : null,
    doc.metodo_pago ? `  MetodoPago="${doc.metodo_pago}"` : null,
  ].filter(Boolean).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd"
  Version="4.0"
${optAttrs}
  Fecha="${fecha}"
  TipoDeComprobante="${doc.tipo_comprobante || 'I'}"
  Exportacion="${doc.exportacion || '01'}"
  LugarExpedicion="${escapeXml(emisor.codigo_postal_fiscal)}"
  Moneda="${doc.moneda || 'MXN'}"
  SubTotal="${doc.subtotal || 0}"
  Total="${doc.total || 0}">${informacionGlobalXml(doc, fecha)}
  <cfdi:Emisor Rfc="${escapeXml(emisor.rfc)}" Nombre="${escapeXml(emisor.razon_social)}" RegimenFiscal="${escapeXml(emisor.regimen_fiscal)}" />
  <cfdi:Receptor Rfc="${escapeXml(doc.receptor_rfc || '')}" Nombre="${escapeXml(doc.receptor_nombre || '')}" DomicilioFiscalReceptor="${escapeXml(doc.receptor_cp || '')}" RegimenFiscalReceptor="${escapeXml(doc.receptor_regimen || '')}" UsoCFDI="${doc.uso_cfdi || ''}" />
  <cfdi:Conceptos>
${conceptosXml}
  </cfdi:Conceptos>${impuestosXml}
</cfdi:Comprobante>`;
}

/**
 * Escape XML special characters.
 */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Submit a CFDI document to the PAC for stamping.
 * Supports Finkok and SW Sapien via REST APIs.
 * Falls back to placeholder UUID if no PAC integration module is configured.
 */
/**
 * Load the organization's ACTIVE signing CSD (csd_certificates) as a seal
 * handle. Actionable 422s: no active cert, or the active cert lapsed between
 * expiry-monitor runs.
 */
async function loadActiveOrgCsd(orgId) {
  const [rows] = await db.query(
    `SELECT * FROM csd_certificates
      WHERE organization_id = ? AND is_active = 1 AND status = 'active' AND deleted_at IS NULL
      LIMIT 1`,
    [orgId],
  );
  const row = rows[0];
  if (!row) {
    throw new AppError(
      'No active CSD certificate — upload the organization\'s .cer/.key under Facturación → Certificados CSD and activate it.',
      422, 'CSD_MISSING',
    );
  }
  if (new Date(row.valid_to).getTime() <= Date.now()) {
    throw new AppError(
      `The active CSD expired on ${new Date(row.valid_to).toISOString().slice(0, 10)} — upload and activate its replacement (CertiSAT).`,
      422, 'CSD_EXPIRED',
    );
  }
  const keyPem = encryption.decrypt(row.key_pem_encrypted);
  const passphrase = row.passphrase_encrypted ? encryption.decrypt(row.passphrase_encrypted) : '';
  return cfdiSealService.loadCredential(row.cer_pem, keyPem, passphrase);
}

// Produce the XML to send to a given PAC: sealed with the org's active CSD
// for local-sealing providers (finkok always; sw_sapien when seal_mode=local),
// or the unsealed builder XML for a seal-for-you (seal_mode=pac) provider.
// Throws deterministic AppErrors (config problems) that must NOT trigger
// failover.
const LOCAL_SEAL_PROVIDERS = ['sw_sapien', 'finkok'];
async function sealXmlForProvider(pac, doc) {
  const localSeal = pac.seal_mode === 'local' || pac.provider_name === 'finkok';
  if (!localSeal) return doc.xml_content;
  if (!LOCAL_SEAL_PROVIDERS.includes(pac.provider_name)) {
    throw new AppError(
      `seal_mode='local' is supported for ${LOCAL_SEAL_PROVIDERS.join('/')} only (this row is '${pac.provider_name}').`,
      422, 'SEAL_MODE_UNSUPPORTED',
    );
  }
  const csd = await loadActiveOrgCsd(doc.organization_id);
  const info = cfdiSealService.certificateInfo(csd);
  // A SAT test CSD chains to the "pruebas"/UAT CA — every production PAC
  // rejects it, and an install that got this far would ship legally-void
  // invoices. Refuse loudly (production-real constraint).
  if (pac.environment === 'production' && info.is_test_certificate) {
    throw new AppError(
      `The active CSD (${info.certificate_number}) is a SAT TEST certificate — it cannot stamp against a production PAC. Upload the organization's real CSD.`,
      422, 'CSD_TEST_IN_PRODUCTION',
    );
  }
  return cfdiSealService.sealXml(doc.xml_content, csd).xml;
}

async function stamp(cfdiDocumentId) {
  logger.info({ cfdiDocumentId }, 'Stamping CFDI document');

  if (circuitBreaker.isOpen()) {
    throw new CfdiStampingError(
      'PAC circuit breaker is open — too many consecutive failures',
      { cfdiDocumentId },
    );
  }

  const [docs] = await db.query('SELECT * FROM cfdi_documents WHERE id = ?', [cfdiDocumentId]);
  const doc = docs[0];
  if (!doc) throw new CfdiStampingError('CFDI document not found', { cfdiDocumentId });
  if (!doc.xml_content) throw new CfdiStampingError('XML not generated yet — call generateXml first', { cfdiDocumentId });

  // Backstop: never register a CFDI at SAT for an invoice that was voided or
  // cancelled after this draft was created (the void guard blocks the common
  // path; this closes the race and any direct /cfdi/stamp call).
  if (doc.invoice_id) {
    const [invRows] = await db.query(
      'SELECT status FROM invoices WHERE id = ?',
      [doc.invoice_id],
    );
    const invStatus = invRows[0]?.status;
    if (invStatus === 'void' || invStatus === 'cancelled') {
      throw new AppError(
        `The linked invoice is ${invStatus} — a terminal invoice must not be stamped. Delete this draft CFDI instead.`,
        422, 'INVOICE_TERMINAL',
      );
    }
  }

  // All active PACs FOR THE ORG'S CURRENT FISCAL ENVIRONMENT, in failover order
  // (lower priority first). Scoping by environment keeps sandbox rows (test
  // credentials/endpoints) from ever stamping a live invoice and vice versa —
  // the org's pac_environment switch selects the correct set, credentials and
  // all. A single-PAC org has exactly one matching row and behaves as before.
  const pacEnv = await orgPacEnvironment(doc.organization_id);
  const [pacs] = await db.query(
    'SELECT * FROM pac_providers WHERE organization_id = ? AND status = \'active\' AND environment = ? AND deleted_at IS NULL ORDER BY priority ASC, id DESC',
    [doc.organization_id, pacEnv],
  );
  if (pacs.length === 0) {
    throw new CfdiStampingError(
      `No active PAC provider configured for this organization in ${pacEnv} mode — add or activate a ${pacEnv} PAC, or change the fiscal environment under Organization → Fiscal (SAT).`,
      { cfdiDocumentId, orgId: doc.organization_id },
    );
  }

  // NOTE: callPacStamp also returns cadenaOriginal, but cfdi_documents has no
  // column for it (database/schema.sql) — it is reproducible from signed_xml.
  let uuid, signedXml, selloSat, stampedProvider;
  const MAX_RETRIES = 3;
  let lastErr;

  for (const pac of pacs) {
    const breaker = providerBreaker(pac.id);
    if (breaker.isOpen()) {
      lastErr = new Error(`PAC ${pac.provider_name} (#${pac.id}) circuit is open`);
      lastErr.pacUnreachable = true;
      logger.warn({ cfdiDocumentId, pacId: pac.id }, 'PAC circuit open — skipping to next provider');
      continue;
    }

    // Seal per-provider: finkok + sw_sapien(local) get the sealed XML; a
    // seal_mode='pac' SW row gets the unsealed XML. Config errors (missing/
    // expired CSD, test-cert-in-prod, unsupported seal_mode) are deterministic
    // and identical for every provider — abort immediately, no failover.
    let xmlToStamp;
    try {
      xmlToStamp = await sealXmlForProvider(pac, doc);
    } catch (sealErr) {
      if (sealErr instanceof AppError) throw sealErr;
      throw sealErr;
    }

    // Up to MAX_RETRIES against THIS provider. Retrying the same provider with
    // the identical sealed XML is double-stamp-safe (SW/Finkok dedupe an
    // identical resubmission). Only after it stays UNREACHABLE do we fail over.
    let providerErr;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await callPacStamp(pac, xmlToStamp);
        uuid = result.uuid;
        signedXml = result.signedXml || xmlToStamp;
        selloSat = result.selloSat || null;
        stampedProvider = pac;
        breaker.recordSuccess();
        circuitBreaker.recordSuccess();
        providerErr = null;
        break;
      } catch (pacErr) {
        providerErr = pacErr;
        logger.warn({ cfdiDocumentId, pacId: pac.id, attempt, err: pacErr.message }, 'PAC stamping attempt failed');
        // A PAC RESPONSE-derived error or a TIMEOUT is ambiguous (the doc may
        // be registered) — stop retrying this provider immediately.
        if (!isUnreachable(pacErr)) break;
        if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
    if (uuid) break; // stamped

    lastErr = providerErr;
    breaker.recordFailure();
    // Fail over to the next PAC ONLY when this one was unreachable. Any other
    // outcome (timeout / PAC error) must not risk a second stamp elsewhere.
    if (isUnreachable(providerErr) && pac !== pacs[pacs.length - 1]) {
      logger.warn({ cfdiDocumentId, from: pac.provider_name }, 'Primary PAC unreachable — failing over');
      continue;
    }
    break;
  }

  if (!uuid) {
    circuitBreaker.recordFailure();
    // sat_status is ENUM('draft','vigente','cancelado','cancel_pending') — there is
    // no 'stamp_error' value (database/schema.sql), so the doc stays 'draft'
    // (not fiscally valid) and the caller gets the actual PAC error.
    throw new CfdiStampingError(
      `PAC stamping failed: ${lastErr ? lastErr.message : 'no provider succeeded'}`,
      { cfdiDocumentId, providersTried: pacs.length, cause: lastErr && lastErr.message },
    );
  }

  // Real columns: stamp_date (not stamped_at) and sat_seal (not sello_sat). There
  // is no cadena_original column — the original chain is reproducible from
  // signed_xml, which is stored (database/schema.sql).
  await db.query(
    `UPDATE cfdi_documents
     SET uuid = ?, sat_status = ?, stamp_date = NOW(),
         signed_xml = ?, sat_seal = ?
     WHERE id = ?`,
    [uuid, 'vigente', signedXml, selloSat, cfdiDocumentId],
  );

  if (stampedProvider) {
    try { await db.query('UPDATE pac_providers SET last_stamp_at = NOW() WHERE id = ?', [stampedProvider.id]); } catch (_) { /* best-effort */ }
  }
  logger.info({ cfdiDocumentId, uuid, provider: stampedProvider && stampedProvider.provider_name }, 'CFDI document stamped successfully');
  return { cfdi_document_id: cfdiDocumentId, uuid, status: 'vigente', provider: stampedProvider && stampedProvider.provider_name };
}

/**
 * Call the PAC stamping API based on the provider name.
 * Supported: finkok, sw_sapien.
 * Other providers fall back to a placeholder UUID (development mode).
 */
// --- Finkok SOAP helpers -----------------------------------------------------
// Finkok is a document/literal SOAP service; the repo hand-builds XML over
// httpRequest rather than pulling in a SOAP client. Namespaces/SOAPAction are
// taken verbatim from the WSDLs.

function finkokBaseUrl(pac) {
  const configured = (pac.api_url || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  return pac.environment === 'production'
    ? 'https://facturacion.finkok.com/servicios/soap'
    : 'https://demo-facturacion.finkok.com/servicios/soap';
}

// PAC account credentials (username/password), decrypted. Finkok stores them
// in the username_encrypted/password_encrypted columns like every other PAC.
async function pacUserPass(pac) {
  const username = pac.username_encrypted ? encryption.decrypt(pac.username_encrypted) : (pac.username || '');
  const password = pac.password_encrypted ? encryption.decrypt(pac.password_encrypted) : '';
  return { username, password };
}

async function finkokSoapCall(url, soapAction, namespace, innerBody) {
  // xmlns:apps is only consumed by the cancel op's <apps:UUID> element (Finkok's
  // own example puts UUID in apps.services.soap.core.views, NOT the cancel op
  // namespace); it is a harmless unused declaration on stamp/get_sat_status.
  const envelope = '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"'
    + ` xmlns:fin="${namespace}" xmlns:apps="apps.services.soap.core.views">`
    + `<soapenv:Body>${innerBody}</soapenv:Body></soapenv:Envelope>`;
  const response = await httpRequest(url, 'POST', envelope, {
    'Content-Type': 'text/xml; charset=utf-8',
    'SOAPAction': soapAction,
  });
  // A SOAP fault (HTTP 500 with a <Fault>) or any non-2xx must be an ERROR,
  // not parsed as a normal response — otherwise a fault body silently reads as
  // "no UUID / status pending". httpRequest never rejects on HTTP status.
  const fault = finkokTag(response.body, 'faultstring');
  if ((response.statusCode && response.statusCode >= 400) || fault) {
    throw new Error(fault || `Finkok SOAP ${soapAction} returned HTTP ${response.statusCode}`);
  }
  return response.body;
}

// First value of a local-name element (namespace-prefix agnostic).
function finkokTag(xml, name) {
  const m = xml.match(new RegExp(`<(?:[a-zA-Z0-9]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${name}>`));
  return m ? m[1].trim() : null;
}

// Best incidencia message from a Finkok fault/incidencia response.
function finkokIncidencia(xml) {
  return finkokTag(xml, 'MensajeIncidencia') || finkokTag(xml, 'faultstring') || finkokTag(xml, 'CodEstatus');
}

function decodeXmlEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

async function callPacStamp(pac, xmlContent) {
  if (pac.provider_name === 'finkok') {
    // Finkok SOAP (the old branch POSTed JSON at a SOAP URL — never worked).
    // Contract from the WSDL (demo-facturacion.../stamp.wsdl): element
    // {http://facturacion.finkok.com/stamp}stamp with base64Binary xml +
    // username/password; SOAPAction "stamp"; response stampResult
    // (AcuseRecepcionCFDI: xml, UUID, CodEstatus, SatSeal, Incidencias).
    // Finkok stamps PRE-SEALED XML, so xmlContent is already sealed here.
    const baseUrl = finkokBaseUrl(pac);
    const { username, password } = await pacUserPass(pac);
    const soapBody = '<fin:stamp>'
      + `<fin:xml>${Buffer.from(xmlContent).toString('base64')}</fin:xml>`
      + `<fin:username>${escapeXml(username)}</fin:username>`
      + `<fin:password>${escapeXml(password)}</fin:password>`
      + '</fin:stamp>';
    const resp = await finkokSoapCall(`${baseUrl}/stamp`, 'stamp', 'http://facturacion.finkok.com/stamp', soapBody);
    const uuid = finkokTag(resp, 'UUID');
    if (!uuid) {
      throw new Error(finkokIncidencia(resp) || 'Finkok stamping returned no UUID');
    }
    return {
      uuid,
      signedXml: finkokTag(resp, 'xml') ? decodeXmlEntities(finkokTag(resp, 'xml')) : null,
      selloSat: finkokTag(resp, 'SatSeal') || null,
      cadenaOriginal: null,
    };
  }

  if (pac.provider_name === 'sw_sapien') {
    // SW Sapien REST API
    // Honor the configured api_url (the schema REQUIRES it, but it was
    // silently ignored here) — fall back to SW's canonical hosts.
    const baseUrl = (pac.api_url || '').trim().replace(/\/+$/, '')
      || (pac.environment === 'production'
        ? 'https://services.sw.com.mx'
        : 'https://services.test.sw.com.mx');

    // Token: direct (portal infinite token) or via authenticate.
    const swToken = await swAuthToken(pac, baseUrl);

    if (pac.seal_mode === 'local') {
      // Timbrado (stamp-only): the XML arrives ALREADY SEALED by our engine.
      // Probe-verified transport: multipart/form-data file field named "xml"
      // — every JSON body shape is rejected with "Xml CFDI no proporcionado".
      const boundary = crypto.randomUUID().replace(/-/g, '');
      const body = `--${boundary}\r\n`
        + 'Content-Disposition: form-data; name="xml"; filename="cfdi.xml"\r\n'
        + 'Content-Type: text/xml\r\n\r\n'
        + `${xmlContent}\r\n--${boundary}--\r\n`;
      const stampResponse = await httpRequest(`${baseUrl}/cfdi33/stamp/v4`, 'POST', body, {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Authorization': `Bearer ${swToken}`,
      });
      const stampData = JSON.parse(stampResponse.body);
      if (!stampData.data?.uuid) {
        const detail = [stampData.message, stampData.messageDetail].filter(Boolean).join(' — ');
        throw new Error(detail || 'SW Sapien timbrado (stamp) failed');
      }
      return {
        uuid: stampData.data.uuid,
        signedXml: stampData.data.cfdi || null,
        selloSat: stampData.data.selloSAT || null,
        cadenaOriginal: stampData.data.cadenaOriginalSAT || null,
      };
    }

    // Emisión Timbrado (issue): SW SEALS AND STAMPS our unsealed XML using
    // the CSD registered in the SW account. This is the correct service for
    // FireISP's builder, which emits no Sello/Certificado — SW's 'stamp'
    // endpoint family (Timbrado corporativo) expects PRE-SEALED XML and
    // rejects ours. The /cfdi33/ prefix is historical: the endpoint accepts
    // CFDI 4.0 (SW docs, "nuevo inicio rápido"). JSON variant, base64 body.
    // Probe-verified against the live sandbox: the json/v4 endpoint expects
    // the PLAIN XML string in `data` — a base64 body is parsed as-is and
    // rejected with 301 "Data at the root level is invalid".
    const issueResponse = await httpRequest(`${baseUrl}/cfdi33/issue/json/v4`, 'POST',
      JSON.stringify({ data: xmlContent }),
      {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${swToken}`,
      },
    );
    const stampData = JSON.parse(issueResponse.body);
    // SW error shape: { message, messageDetail } with status != 'success'.
    if (!stampData.data?.uuid) {
      const detail = [stampData.message, stampData.messageDetail].filter(Boolean).join(' — ');
      throw new Error(detail || 'SW Sapien emisión (issue) failed');
    }

    return {
      uuid: stampData.data.uuid,
      signedXml: stampData.data.cfdi || null,
      selloSat: stampData.data.selloSAT || null,
      cadenaOriginal: stampData.data.cadenaOriginalSAT || null,
    };
  }

  // First-class SIMULATOR provider — for demo/dev/test installs. Unlike the
  // dev fallback below it is ALLOWED in production, but only with
  // environment='sandbox', and its UUIDs are unmistakably fake: the first
  // UUID block is the literal 'SIMULADO' (not valid hex — no real SAT folio
  // fiscal can ever look like this), keeping the value exactly 36 chars so it
  // fits cfdi_documents.uuid CHAR(36) and every downstream uuid column
  // (cfdi_cancellations, payment-complement DoctoRelacionado).
  // A 'simulator' row with environment='production' is a misconfiguration.
  if (pac.provider_name === 'simulator') {
    if (pac.environment !== 'sandbox') {
      throw new Error("The 'simulator' PAC only runs with environment='sandbox' — it never produces fiscally valid CFDIs.");
    }
    logger.warn({ provider: 'simulator' }, 'SIMULATED stamping — NOT a fiscally valid CFDI');
    return {
      uuid: `SIMULADO-${crypto.randomUUID().slice(9)}`,
      signedXml: null,
      selloSat: null,
      cadenaOriginal: null,
    };
  }

  // Fallback for development / unknown providers — generate placeholder UUID
  // In production, refuse to issue unsigned documents.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `PAC provider "${pac.provider_name}" is not a supported stamping service — ` +
      'configure a supported PAC (finkok, sw_sapien) for production use',
    );
  }
  logger.warn({ provider: pac.provider_name }, 'Using placeholder UUID — not valid for production CFDI');
  return {
    uuid: crypto.randomUUID(),
    signedXml: null,
    selloSat: null,
    cadenaOriginal: null,
  };
}

/**
 * Simple HTTP/HTTPS request helper.
 */
function httpRequest(url, method, body, headers) {
  const http = require('http');
  const https = require('https');
  const { URL } = require('url');

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body || '') },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('PAC request timed out')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Once SAT ACCEPTS a CFDI cancellation (sat_status = 'cancelado'), the invoice
 * behind it is no longer fiscally valid — it must drop out of receivables and
 * every tax/financial report. Mark it 'cancelled' and release its money via the
 * same path a void uses. Best-effort and non-fatal: the SAT cancellation has
 * already succeeded, so a bookkeeping-sync failure here must not surface as a
 * cancellation failure — it is logged for follow-up instead. Lazy-requires
 * billingService to avoid a service-load cycle.
 */
async function syncInvoiceCancelled(cfdiDocumentId) {
  try {
    const [rows] = await db.query(
      'SELECT invoice_id, organization_id FROM cfdi_documents WHERE id = ?',
      [cfdiDocumentId],
    );
    const doc = rows[0];
    if (!doc || !doc.invoice_id) return;
    const billingService = require('./billingService');
    await billingService.cancelInvoiceForSat(doc.invoice_id, doc.organization_id, null);
  } catch (err) {
    logger.error(
      { cfdiDocumentId, err: err.message },
      'CFDI cancelled at SAT but failed to sync the invoice to cancelled — reconcile manually',
    );
  }
}

/**
 * Cancel a stamped CFDI document via the PAC → SAT flow.
 *
 * SAT cancellation reasons (motivo):
 *   01 = CFDI emitido con errores CON relación (requires folio_sustitucion)
 *   02 = CFDI emitido con errores SIN relación
 *   03 = No se llevó a cabo la operación
 *   04 = Operación nominativa relacionada en CFDI global
 */
async function cancel(cfdiDocumentId, reason, replacementUuid = null) {
  logger.info({ cfdiDocumentId, reason, replacementUuid }, 'Cancelling CFDI document');

  const VALID_MOTIVOS = ['01', '02', '03', '04'];
  if (!VALID_MOTIVOS.includes(reason)) {
    throw new CfdiCancellationError(`Invalid cancellation reason "${reason}" — must be one of: ${VALID_MOTIVOS.join(', ')}`, { cfdiDocumentId, reason });
  }

  const [docs] = await db.query('SELECT * FROM cfdi_documents WHERE id = ?', [cfdiDocumentId]);
  const doc = docs[0];
  if (!doc) throw new CfdiCancellationError('CFDI document not found', { cfdiDocumentId });
  if (doc.sat_status !== 'vigente') {
    throw new CfdiCancellationError('Can only cancel vigente documents', { cfdiDocumentId, currentStatus: doc.sat_status });
  }
  if (!doc.uuid) {
    throw new CfdiCancellationError('CFDI document has no UUID — it must be stamped before cancellation', { cfdiDocumentId });
  }
  if (reason === '01' && !replacementUuid) {
    throw new CfdiCancellationError('Motivo 01 requires a replacement UUID (folio_sustitucion)', { cfdiDocumentId });
  }

  // SAT rule: a CFDI cannot be cancelled while a vigente payment complement
  // (REP / Complemento de Pago) still references it as a DoctoRelacionado —
  // SAT would reject the request. The correct order for a paid+stamped invoice
  // is: cancel the REP first, then cancel the invoice CFDI. Enforcing it here
  // gives the operator a clear instruction instead of an opaque PAC rejection.
  const [liveReps] = await db.query(
    `SELECT d.id, d.uuid
       FROM cfdi_payment_complement_items pci
       JOIN cfdi_payment_complements pc ON pc.id = pci.complement_id
       JOIN cfdi_documents d ON d.id = pc.cfdi_document_id
      WHERE pci.related_cfdi_uuid = ?
        AND d.sat_status IN ('vigente', 'cancel_pending')
      LIMIT 1`,
    [doc.uuid],
  );
  if (liveReps.length > 0) {
    throw new AppError(
      `This CFDI has a payment complement (REP ${liveReps[0].uuid || '#' + liveReps[0].id}) that is still valid at SAT — cancel the REP first, then cancel this CFDI.`,
      422, 'CFDI_HAS_LIVE_REP',
    );
  }

  // All active PACs FOR THE ORG'S CURRENT FISCAL ENVIRONMENT, in priority order.
  // Unlike stamping, SAT cancellation is IDEMPOTENT (re-cancelling a UUID is
  // harmless — SAT reports it already cancelled), so cancel MAY fail over across
  // providers, and any active PAC in this environment (SW with the vaulted CSD,
  // Finkok with the cer/key inline) can cancel any of the org's CFDIs — including
  // one a now-down backup stamped. Environment-scoped for the same reason as
  // stamping: a production CFDI is cancelled by a production PAC, never a sandbox.
  const pacEnv = await orgPacEnvironment(doc.organization_id);
  const [pacs] = await db.query(
    'SELECT * FROM pac_providers WHERE organization_id = ? AND status = \'active\' AND environment = ? AND deleted_at IS NULL ORDER BY priority ASC, id DESC',
    [doc.organization_id, pacEnv],
  );
  if (pacs.length === 0) {
    throw new CfdiCancellationError(
      `No active PAC provider configured for this organization in ${pacEnv} mode — activate a ${pacEnv} PAC, or change the fiscal environment under Organization → Fiscal (SAT).`,
      { cfdiDocumentId, orgId: doc.organization_id },
    );
  }

  // Record the request (pending). The doc is NOT flipped to cancel_pending
  // yet — only a PAC that actually responds moves it (below), so a cancel
  // where every provider is unreachable leaves the CFDI 'vigente' and
  // retryable, instead of stranding it in cancel_pending forever.
  const [insertResult] = await db.query(
    `INSERT INTO cfdi_cancellations
       (cfdi_document_id, organization_id, uuid, motivo, folio_sustitucion,
        cancellation_status, requested_at, pac_provider_id)
     VALUES (?, ?, ?, ?, ?, 'pending', NOW(), ?)`,
    [cfdiDocumentId, doc.organization_id, doc.uuid, reason, replacementUuid, pacs[0].id],
  );
  const cancellationId = insertResult.insertId;

  let lastErr;
  let pacResult;
  let usedPac;
  for (const pac of pacs) {
    try {
      pacResult = await callPacCancel(pac, doc.uuid, reason, replacementUuid, doc);
      usedPac = pac;
      lastErr = null;
      break;
    } catch (pacErr) {
      // Deterministic config errors (missing/expired CSD, no emisor profile —
      // 4xx AppErrors) are identical for every provider — surface immediately
      // with the actionable message, no failover.
      if (pacErr instanceof AppError && pacErr.statusCode < 500) {
        await db.query('UPDATE cfdi_cancellations SET error_message = ? WHERE id = ?', [pacErr.message, cancellationId]);
        throw pacErr;
      }
      lastErr = pacErr;
      logger.warn({ cfdiDocumentId, pacId: pac.id, err: pacErr.message }, 'PAC cancellation attempt failed — trying next provider');
    }
  }

  if (lastErr) {
    await db.query(
      'UPDATE cfdi_cancellations SET error_message = ? WHERE id = ?',
      [lastErr.message, cancellationId],
    );
    logger.error({ cfdiDocumentId, err: lastErr.message }, 'PAC cancellation failed across all providers');
    // The doc was never moved off 'vigente' — nothing to revert.
    throw new CfdiCancellationError(
      `PAC cancellation failed: ${lastErr.message}`,
      { cfdiDocumentId, providersTried: pacs.length, cause: lastErr.message },
    );
  }
  // Attribute the cancellation to the provider that actually handled it.
  if (usedPac && usedPac.id !== pacs[0].id) {
    await db.query('UPDATE cfdi_cancellations SET pac_provider_id = ? WHERE id = ?', [usedPac.id, cancellationId]);
  }

  // Process PAC response
  const finalStatus = pacResult.status || 'pending';
  const acuseXml = pacResult.acuseXml || null;
  // PAC branches return acuseFecha in whatever form the provider gives
  // (simulator/dev: ISO-8601 with 'T'+'Z') — MySQL DATETIME rejects that form
  // in strict mode (error 1292 → opaque 500). Bind a JS Date instead: mysql2
  // serializes it in the connection timezone, valid for any source format.
  const acuseFecha = pacResult.acuseFecha ? new Date(pacResult.acuseFecha) : null;

  // Update cancellation record with PAC response
  await db.query(
    `UPDATE cfdi_cancellations
     SET cancellation_status = ?, acuse_xml = ?, acuse_fecha = ?, responded_at = NOW()
     WHERE id = ?`,
    [finalStatus, acuseXml, acuseFecha, cancellationId],
  );

  // Move the CFDI per the PAC response. The doc is still 'vigente' at this
  // point (it is flipped only now that a PAC has actually answered).
  if (finalStatus === 'accepted') {
    await db.query(
      'UPDATE cfdi_documents SET sat_status = ?, cancellation_reason = ?, cancellation_uuid = ?, cancelled_at = NOW() WHERE id = ?',
      ['cancelado', reason, replacementUuid, cfdiDocumentId],
    );
    await syncInvoiceCancelled(cfdiDocumentId);
  } else if (finalStatus === 'rejected') {
    // SAT rejected — the doc stays vigente (never moved). Nothing to do.
  } else {
    // pending (202 — awaiting receptor acceptance): now flip to cancel_pending;
    // getCancellationStatus resolves it later.
    await db.query(
      'UPDATE cfdi_documents SET sat_status = ?, cancellation_reason = ?, cancellation_uuid = ? WHERE id = ?',
      ['cancel_pending', reason, replacementUuid, cfdiDocumentId],
    );
  }

  logger.info({ cfdiDocumentId, cancellationId, finalStatus }, 'CFDI cancellation processed');
  return {
    cfdi_document_id: cfdiDocumentId,
    cancellation_id: cancellationId,
    status: finalStatus === 'accepted' ? 'cancelado' : finalStatus === 'rejected' ? 'rejected' : 'cancel_pending',
    reason,
    acuse_xml: acuseXml,
  };
}

/**
 * Call the PAC cancellation API based on the provider name.
 * Returns { status: 'accepted'|'rejected'|'pending', acuseXml, acuseFecha }
 */
async function callPacCancel(pac, uuid, reason, replacementUuid, doc) {
  if (pac.provider_name === 'finkok') {
    // Finkok SOAP cancel (cancel.wsdl): the request carries the emisor's CSD
    // cer/key as base64(PEM) — cert PEM and DECRYPTED (unencrypted PKCS#8) key
    // PEM, live-verified against Finkok's demo (see csdCancelMaterial). Finkok
    // itself signs the SAT Solicitud de Cancelación with our cert, so the CSD
    // never lives in a PAC vault — the key-isolation seal_mode='local' promises.
    // Per-UUID <apps:UUID> element with UUID/Motivo/FolioSustitucion attributes;
    // response cancelResult (Folios[].EstatusUUID + Acuse + Fecha).
    const baseUrl = finkokBaseUrl(pac);
    const { username, password } = await pacUserPass(pac);
    const emisor = await getEmisorProfile(doc.organization_id);
    const csd = await loadActiveOrgCsd(doc.organization_id);
    const { cerPemB64, keyPemB64 } = cfdiSealService.csdCancelMaterial(csd);

    // The <UUID> element lives in the apps.services.soap.core.views namespace
    // (Finkok's own example), NOT the cancel operation namespace.
    const folioAttr = replacementUuid ? ` FolioSustitucion="${escapeXml(replacementUuid)}"` : '';
    const soapBody = '<fin:cancel>'
      + `<fin:UUIDS><apps:UUID UUID="${escapeXml(uuid)}" Motivo="${escapeXml(reason)}"${folioAttr}/></fin:UUIDS>`
      + `<fin:username>${escapeXml(username)}</fin:username>`
      + `<fin:password>${escapeXml(password)}</fin:password>`
      + `<fin:taxpayer_id>${escapeXml(emisor.rfc)}</fin:taxpayer_id>`
      + `<fin:cer>${cerPemB64}</fin:cer>`
      + `<fin:key>${keyPemB64}</fin:key>`
      + '<fin:store_pending>false</fin:store_pending>'
      + '</fin:cancel>';
    const resp = await finkokSoapCall(`${baseUrl}/cancel`, 'cancel', 'http://facturacion.finkok.com/cancel', soapBody);
    const estatusUuid = finkokTag(resp, 'EstatusUUID');
    // No per-UUID EstatusUUID = the request itself failed (bad creds, no CSD
    // registered, malformed) — surface the error like the stamp branch does
    // for a missing UUID, instead of falling through to a bogus 'pending'.
    if (!estatusUuid) {
      throw new Error(finkokIncidencia(resp) || finkokTag(resp, 'CodEstatus') || 'Finkok cancellation returned no EstatusUUID');
    }
    return {
      // Finkok EstatusUUID mirrors SAT's (201 cancelled / 202 pending); reuse
      // the shared parser so downstream sat_status handling is provider-neutral.
      status: parseCancellationStatus(estatusUuid || finkokTag(resp, 'EstatusCancelacion')),
      acuseXml: finkokTag(resp, 'Acuse') ? decodeXmlEntities(finkokTag(resp, 'Acuse')) : null,
      acuseFecha: finkokTag(resp, 'Fecha') || null,
    };
  }

  if (pac.provider_name === 'sw_sapien') {
    // Honor the configured api_url (the schema REQUIRES it, but it was
    // silently ignored here) — fall back to SW's canonical hosts.
    const baseUrl = (pac.api_url || '').trim().replace(/\/+$/, '')
      || (pac.environment === 'production'
        ? 'https://services.sw.com.mx'
        : 'https://services.test.sw.com.mx');

    const swToken = await swAuthToken(pac, baseUrl);

    // Submit cancellation — probe-verified shape: PATH parameters
    // /cfdi33/cancel/{rfc}/{uuid}/{motivo}[/{folioSustitucion}] using the CSD
    // in the SW vault (the old JSON-body POST to /cfdi33/cancel was never a
    // real SW endpoint). RFC comes from the org's emisor profile, not the
    // document (cfdi_documents has no emisor_rfc column).
    const emisor = await getEmisorProfile(doc.organization_id);
    const cancelPath = [
      `${baseUrl}/cfdi33/cancel`,
      encodeURIComponent(emisor.rfc),
      encodeURIComponent(uuid),
      encodeURIComponent(reason),
      ...(replacementUuid ? [encodeURIComponent(replacementUuid)] : []),
    ].join('/');
    const cancelResponse = await httpRequest(cancelPath, 'POST', '',
      {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${swToken}`,
      },
    );
    const cancelData = JSON.parse(cancelResponse.body);
    if (cancelData.status === 'error') {
      let msg = [cancelData.message, cancelData.messageDetail].filter(Boolean).join(' — ') || 'SW Sapien cancellation failed';
      // Local sealing keeps the CSD off the PAC for STAMPING, but SW's
      // cancellation service signs the SAT Solicitud de Cancelación with the
      // CSD in the SW account's vault — so cancellation still needs it
      // registered there. Make that dependency explicit instead of surfacing
      // SW's opaque certificate error (true local cancel-signing lands with
      // the Finkok adapter).
      if (pac.seal_mode === 'local') {
        msg += ' — with local sealing, SW still signs cancellations with the CSD in your SW account; upload the same CSD in SW\'s Administración de certificados.';
      }
      throw new Error(msg);
    }

    // The acuse XML carries the SAT status: EstatusUUID 201 (cancelled) /
    // 202 (pending receptor acceptance).
    const acuse = cancelData.data?.acuse || null;
    const estatusMatch = acuse ? acuse.match(/<EstatusUUID>(\d+)<\/EstatusUUID>/) : null;
    return {
      status: parseCancellationStatus(estatusMatch?.[1] || cancelData.data?.estatus || cancelData.data?.status),
      acuseXml: acuse,
      acuseFecha: cancelData.data?.fechaCancelacion || null,
    };
  }

  // Simulator: accept immediately (see callPacStamp for the contract).
  if (pac.provider_name === 'simulator') {
    if (pac.environment !== 'sandbox') {
      throw new Error("The 'simulator' PAC only runs with environment='sandbox'.");
    }
    // The simulator may ONLY "cancel" what it itself stamped — a SIMULADO- UUID
    // (see callPacStamp). Refuse a real SAT-issued UUID outright: otherwise a
    // cancel misrouted to a sandbox simulator (e.g. an org that stamped in
    // production then switched back to sandbox) would fabricate acceptance and
    // mark a genuine, still-vigente CFDI 'cancelado' locally — the books would
    // silently diverge from the SAT. A real sandbox PAC would reject the
    // unknown UUID anyway; this makes the simulator just as safe.
    if (!String(uuid).startsWith('SIMULADO-')) {
      throw new Error(
        'The simulator can only cancel simulator-stamped CFDIs (SIMULADO- UUIDs). '
        + 'This UUID was stamped by a real PAC — switch the fiscal environment to the one that stamped it and cancel through that PAC.',
      );
    }
    logger.warn({ provider: 'simulator' }, 'SIMULATED cancellation — not a real SAT cancellation');
    return {
      status: 'accepted',
      acuseXml: `<Acuse><UUID>${uuid}</UUID><EstatusUUID>201</EstatusUUID><Fecha>${new Date().toISOString()}</Fecha></Acuse>`,
      acuseFecha: new Date().toISOString(),
    };
  }

  // Fallback for development / unknown providers
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `PAC provider "${pac.provider_name}" is not a supported cancellation service — ` +
      'configure a supported PAC (finkok, sw_sapien) for production use',
    );
  }
  logger.warn({ provider: pac.provider_name }, 'Using simulated cancellation — not valid for production');
  return {
    status: 'accepted',
    acuseXml: `<Acuse><UUID>${uuid}</UUID><EstatusUUID>201</EstatusUUID><Fecha>${new Date().toISOString()}</Fecha></Acuse>`,
    acuseFecha: new Date().toISOString(),
  };
}

/**
 * Normalize PAC cancellation status strings to internal enum values.
 */
function parseCancellationStatus(rawStatus) {
  if (!rawStatus) return 'pending';
  const s = String(rawStatus).toLowerCase().trim();
  if (s === '201' || s === 'cancelado' || s === 'accepted' || s === 'cancelled') return 'accepted';
  if (s === '202' || s === 'en proceso' || s === 'pending' || s === 'in_progress') return 'pending';
  if (s === '203' || s === 'rechazado' || s === 'rejected') return 'rejected';
  if (s === '204' || s === 'no encontrado' || s === 'not_found') return 'rejected';
  if (s === '205' || s === 'no cancelable') return 'rejected';
  return 'pending';
}

/**
 * Check cancellation status for a pending cancellation via the PAC.
 * Used to poll for SAT responses that were not immediately available.
 */
async function getCancellationStatus(cancellationId) {
  logger.info({ cancellationId }, 'Checking CFDI cancellation status');

  const [rows] = await db.query('SELECT * FROM cfdi_cancellations WHERE id = ?', [cancellationId]);
  const cancellation = rows[0];
  if (!cancellation) throw new CfdiCancellationError('Cancellation record not found', { cancellationId });

  // If already resolved, return immediately
  if (cancellation.cancellation_status !== 'pending') {
    return {
      cancellation_id: cancellationId,
      cfdi_document_id: cancellation.cfdi_document_id,
      status: cancellation.cancellation_status,
      acuse_xml: cancellation.acuse_xml,
      acuse_fecha: cancellation.acuse_fecha,
      responded_at: cancellation.responded_at,
    };
  }

  // Get PAC provider to query for status
  let pac = null;
  if (cancellation.pac_provider_id) {
    const [pacs] = await db.query('SELECT * FROM pac_providers WHERE id = ?', [cancellation.pac_provider_id]);
    pac = pacs[0] || null;
  }

  if (!pac) {
    return {
      cancellation_id: cancellationId,
      cfdi_document_id: cancellation.cfdi_document_id,
      status: 'pending',
      acuse_xml: null,
      acuse_fecha: null,
      responded_at: null,
    };
  }

  // Poll PAC for current status
  let pacResult;
  try {
    pacResult = await callPacCancelStatus(pac, cancellation.uuid, cancellation);
  } catch (err) {
    logger.warn({ cancellationId, err: err.message }, 'Failed to poll PAC for cancellation status');
    return {
      cancellation_id: cancellationId,
      cfdi_document_id: cancellation.cfdi_document_id,
      status: 'pending',
      acuse_xml: null,
      acuse_fecha: null,
      responded_at: null,
      error: err.message,
    };
  }

  const finalStatus = pacResult.status || 'pending';

  if (finalStatus !== 'pending') {
    // Update cancellation record
    await db.query(
      `UPDATE cfdi_cancellations
       SET cancellation_status = ?, acuse_xml = ?, acuse_fecha = ?, responded_at = NOW()
       WHERE id = ?`,
      // Same DATETIME normalization as cancel(): ISO-Z strings are rejected
      // by MySQL strict mode — bind a Date object.
      [finalStatus, pacResult.acuseXml, pacResult.acuseFecha ? new Date(pacResult.acuseFecha) : null, cancellationId],
    );

    // Update CFDI document status
    if (finalStatus === 'accepted') {
      await db.query(
        'UPDATE cfdi_documents SET sat_status = ?, cancelled_at = NOW() WHERE id = ?',
        ['cancelado', cancellation.cfdi_document_id],
      );
      await syncInvoiceCancelled(cancellation.cfdi_document_id);
    } else if (finalStatus === 'rejected') {
      await db.query(
        'UPDATE cfdi_documents SET sat_status = ? WHERE id = ?',
        ['vigente', cancellation.cfdi_document_id],
      );
    }
  }

  return {
    cancellation_id: cancellationId,
    cfdi_document_id: cancellation.cfdi_document_id,
    status: finalStatus,
    acuse_xml: pacResult.acuseXml || cancellation.acuse_xml,
    acuse_fecha: pacResult.acuseFecha || cancellation.acuse_fecha,
    responded_at: finalStatus !== 'pending' ? new Date().toISOString() : null,
  };
}

/**
 * Poll the PAC for the current cancellation status of a UUID.
 */
async function callPacCancelStatus(pac, uuid, _cancellation) {
  if (pac.provider_name === 'finkok') {
    // Finkok get_sat_status (cancel.wsdl): live SAT consulta for a UUID —
    // Estado (Vigente/Cancelado) + EstatusCancelacion. Emisor RFC comes from
    // the org profile (cfdi_documents has no emisor_rfc column).
    const baseUrl = finkokBaseUrl(pac);
    const { username, password } = await pacUserPass(pac);
    // get_sat_status proxies SAT's ConsultaCFDI, keyed on emisor RFC + receptor
    // RFC (rtaxpayer_id) + Total + UUID — all four required, so pull the
    // receptor RFC and total from the document row too.
    const [docRows] = await db.query(
      'SELECT organization_id, receptor_rfc, total FROM cfdi_documents WHERE uuid = ? LIMIT 1', [uuid]);
    const emisor = docRows[0] ? await getEmisorProfile(docRows[0].organization_id) : { rfc: '' };
    const soapBody = '<fin:get_sat_status>'
      + `<fin:username>${escapeXml(username)}</fin:username>`
      + `<fin:password>${escapeXml(password)}</fin:password>`
      + `<fin:taxpayer_id>${escapeXml(emisor.rfc)}</fin:taxpayer_id>`
      + `<fin:rtaxpayer_id>${escapeXml(docRows[0]?.receptor_rfc || '')}</fin:rtaxpayer_id>`
      + `<fin:uuid>${escapeXml(uuid)}</fin:uuid>`
      + `<fin:total>${escapeXml(String(docRows[0]?.total ?? ''))}</fin:total>`
      + '</fin:get_sat_status>';
    const resp = await finkokSoapCall(`${baseUrl}/cancel`, 'get_sat_status', 'http://facturacion.finkok.com/cancel', soapBody);
    const estado = finkokTag(resp, 'Estado');            // Vigente | Cancelado
    const estatusCancel = finkokTag(resp, 'EstatusCancelacion') || '';
    // 'rejected' MUST be reachable — getCancellationStatus reverts a stuck
    // cancel_pending doc back to 'vigente' only on a rejected result. A
    // receptor declining a Motivo-01/02 request leaves Estado=Vigente with
    // EstatusCancelacion like "Solicitud rechazada".
    let status;
    if (/cancelad/i.test(estado || '')) status = 'accepted';
    else if (/rechaz|no cancelable|denegad/i.test(estatusCancel)) status = 'rejected';
    else status = 'pending';
    return { status, acuseXml: null, acuseFecha: null };
  }

  if (pac.provider_name === 'sw_sapien') {
    // Honor the configured api_url (the schema REQUIRES it, but it was
    // silently ignored here) — fall back to SW's canonical hosts.
    const baseUrl = (pac.api_url || '').trim().replace(/\/+$/, '')
      || (pac.environment === 'production'
        ? 'https://services.sw.com.mx'
        : 'https://services.test.sw.com.mx');

    const swToken = await swAuthToken(pac, baseUrl);

    const statusResponse = await httpRequest(
      `${baseUrl}/cfdi33/cancel/${encodeURIComponent(uuid)}/status`,
      'GET',
      null,
      { 'Authorization': `Bearer ${swToken}` },
    );
    const statusData = JSON.parse(statusResponse.body);
    return {
      status: parseCancellationStatus(statusData.data?.estatus || statusData.data?.status),
      acuseXml: statusData.data?.acuse || null,
      acuseFecha: statusData.data?.fechaCancelacion || null,
    };
  }

  // Simulator: a simulated cancellation is always already accepted.
  if (pac.provider_name === 'simulator' && pac.environment === 'sandbox') {
    return {
      status: 'accepted',
      acuseXml: `<Acuse><UUID>${uuid}</UUID><EstatusUUID>201</EstatusUUID></Acuse>`,
      acuseFecha: new Date().toISOString(),
    };
  }

  // Fallback for development
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`PAC provider "${pac.provider_name}" does not support status queries`);
  }
  return {
    status: 'accepted',
    acuseXml: `<Acuse><UUID>${uuid}</UUID><EstatusUUID>201</EstatusUUID></Acuse>`,
    acuseFecha: new Date().toISOString(),
  };
}

/**
 * List cancellation records for a CFDI document.
 */
async function listCancellations(cfdiDocumentId, orgId) {
  const [rows] = await db.query(
    `SELECT * FROM cfdi_cancellations
     WHERE cfdi_document_id = ? AND organization_id = ?
     ORDER BY requested_at DESC`,
    [cfdiDocumentId, orgId],
  );
  return rows;
}

// =============================================================================
// Complemento de Pago 2.0
// =============================================================================

/**
 * Generate a Complemento de Pago 2.0 CFDI (tipo P) for a payment event.
 *
 * Creates:
 *   - One cfdi_documents row (tipo_comprobante = 'P', SubTotal/Total = 0)
 *   - One cfdi_payment_complements row (payment metadata)
 *   - N cfdi_payment_complement_items rows (one per PPD invoice being settled)
 *   - Generates and stores the XML
 *
 * @param {object} params
 * @param {number} params.organization_id
 * @param {number} params.client_id
 * @param {number|null} params.payment_id           - Link to payments table (optional)
 * @param {string|null} params.serie                - CFDI series prefix (e.g. 'P')
 * @param {string|null} params.folio               - Sequential folio
 * @param {string} params.fecha_emision             - ISO 8601 datetime string
 * @param {string} params.lugar_expedicion          - Postal code of issuance
 * @param {string} params.emisor_rfc
 * @param {string} params.emisor_nombre
 * @param {string} params.emisor_regimen_fiscal
 * @param {string} params.receptor_rfc
 * @param {string} params.receptor_nombre
 * @param {string} params.receptor_domicilio_fiscal - Postal code of receiver
 * @param {string} params.receptor_regimen_fiscal
 * @param {string} params.payment_date              - Date the payment was received (YYYY-MM-DD)
 * @param {string} params.forma_pago                - SAT c_FormaPago (e.g. '03')
 * @param {string} params.moneda                    - SAT c_Moneda (e.g. 'MXN')
 * @param {number|null} params.tipo_cambio          - Exchange rate; null when MXN
 * @param {number} params.amount                    - Total payment amount
 * @param {string|null} params.operation_number     - Bank transaction reference
 * @param {string|null} params.payer_rfc
 * @param {string|null} params.payer_bank_name
 * @param {string|null} params.payer_account
 * @param {string|null} params.beneficiary_rfc
 * @param {string|null} params.beneficiary_account
 * @param {Array} params.related_documents          - Array of DoctoRelacionado items
 *   Each item: { related_cfdi_uuid, serie, folio, moneda_dr, equivalencia_dr,
 *                num_parcialidad, imp_saldo_ant, imp_pagado, imp_saldo_insoluto }
 *
 * @returns {{ cfdi_document_id, complement_id, xml }}
 */
async function generatePaymentComplement(params) {
  const {
    organization_id, client_id, payment_id = null,
    serie = null, folio = null,
    fecha_emision, lugar_expedicion,
    emisor_rfc, emisor_nombre, emisor_regimen_fiscal,
    receptor_rfc, receptor_nombre, receptor_domicilio_fiscal, receptor_regimen_fiscal,
    payment_date, forma_pago, moneda, tipo_cambio = null, amount,
    operation_number = null,
    payer_rfc = null, payer_bank_name = null, payer_account = null,
    beneficiary_rfc = null, beneficiary_account = null,
    related_documents,
  } = params;

  logger.info({ organization_id, client_id, amount }, 'Generating Complemento de Pago');

  if (!related_documents || related_documents.length === 0) {
    throw new Error('At least one related document (DoctoRelacionado) is required for a payment complement');
  }

  // 1. Create cfdi_documents record (tipo P, SubTotal=0, Total=0, Moneda=XXX)
  // cfdi_documents has no fecha_emision / lugar_expedicion / emisor_* columns —
  // the issuer (emisor) is the organization, joined via organization_id, and the
  // issue date is created_at. The receptor columns are receptor_regimen and
  // receptor_cp (database/schema.sql). The values the caller passes for the
  // dropped fields are still used to build the XML further down.
  const [insertDocResult] = await db.query(
    `INSERT INTO cfdi_documents
       (organization_id, client_id, serie, folio, tipo_comprobante, uso_cfdi,
        moneda, tipo_cambio,
        receptor_rfc, receptor_nombre, receptor_cp, receptor_regimen,
        subtotal, total_impuestos, total, sat_status, payment_id)
     VALUES (?, ?, ?, ?, 'P', 'CP01', 'XXX', ?, ?, ?, ?, ?, 0, 0, 0, 'draft', ?)`,
    [
      organization_id, client_id, serie, folio,
      tipo_cambio,
      receptor_rfc, receptor_nombre, receptor_domicilio_fiscal, receptor_regimen_fiscal,
      payment_id,
    ],
  );
  const cfdiDocumentId = insertDocResult.insertId;

  // 2. Create cfdi_payment_complements record
  const [insertCompResult] = await db.query(
    `INSERT INTO cfdi_payment_complements
       (cfdi_document_id, payment_date, forma_pago, moneda, tipo_cambio, amount,
        operation_number, payer_rfc, payer_bank_name, payer_account,
        beneficiary_rfc, beneficiary_account)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cfdiDocumentId, payment_date, forma_pago, moneda, tipo_cambio, amount,
      operation_number, payer_rfc, payer_bank_name, payer_account,
      beneficiary_rfc, beneficiary_account,
    ],
  );
  const complementId = insertCompResult.insertId;

  // 3. Create cfdi_payment_complement_items records — enriched FIRST so the
  // stored objeto_imp_dr matches what the XML will say (the column default is
  // '02', which silently contradicted an XML that said 01/03), and so the
  // desglose lands in cfdi_payment_complement_item_taxes (the schema's
  // per-DoctoRelacionado ImpuestosP table, designed for this and never
  // written before) where the rebuild path can read it back.
  const enriched = await enrichRelatedDocumentsWithTaxes(related_documents, organization_id);
  for (const rd of enriched) {
    const [itemResult] = await db.query(
      `INSERT INTO cfdi_payment_complement_items
         (complement_id, related_cfdi_uuid, serie, folio, moneda_dr, equivalencia_dr,
          num_parcialidad, imp_saldo_ant, imp_pagado, imp_saldo_insoluto, objeto_imp_dr)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        complementId,
        rd.related_cfdi_uuid,
        rd.serie || null,
        rd.folio || null,
        rd.moneda_dr || 'MXN',
        rd.equivalencia_dr !== undefined ? rd.equivalencia_dr : 1.0,
        rd.num_parcialidad || 1,
        rd.imp_saldo_ant,
        rd.imp_pagado,
        rd.imp_saldo_insoluto,
        rd.objeto_imp_dr || '01',
      ],
    );
    if (rd.traslado_dr) {
      await db.query(
        `INSERT INTO cfdi_payment_complement_item_taxes
           (complement_item_id, tax_type, impuesto, tipo_factor, tasa_o_cuota, base, importe)
         VALUES (?, 'traslado', '002', 'Tasa', ?, ?, ?)`,
        [itemResult.insertId, rd.traslado_dr.tasa, rd.traslado_dr.base, rd.traslado_dr.importe],
      );
    }
  }

  // 4. Build the Complemento de Pago 2.0 XML
  const doc = {
    serie, folio, fecha_emision, lugar_expedicion, tipo_cambio,
    emisor_rfc, emisor_nombre, emisor_regimen_fiscal,
    receptor_rfc, receptor_nombre, receptor_domicilio_fiscal, receptor_regimen_fiscal,
  };
  const complement = {
    payment_date, forma_pago, moneda, tipo_cambio, amount, operation_number,
    payer_rfc, payer_bank_name, payer_account, beneficiary_rfc, beneficiary_account,
  };
  const xml = buildPaymentComplementXml(doc, complement, enriched);

  // 5. Store the generated XML
  await db.query(
    'UPDATE cfdi_documents SET xml_content = ? WHERE id = ?',
    [xml, cfdiDocumentId],
  );

  logger.info({ cfdiDocumentId, complementId }, 'Complemento de Pago generated');
  return { cfdi_document_id: cfdiDocumentId, complement_id: complementId, xml };
}

// Pagos 2.0 tax desglose. When the related invoice CFDI carried transferred
// IVA, SAT requires the REP to break the payment down (ObjetoImpDR=02 +
// ImpuestosDR/ImpuestosP + the per-rate Totales attributes) — a REP that says
// ObjetoImpDR=01 against an IVA invoice misreports the tax. The rate is not
// stored on the complement items; it is derived from the original CFDI's own
// totals (total_impuestos / subtotal) and snapped to the c_TasaOCuota catalog —
// TasaOCuotaDR must be a catalog value or the PAC rejects the REP outright.
const CATALOG_IVA_RATES = [0.16, 0.08, 0];

async function enrichRelatedDocumentsWithTaxes(relatedDocuments, organizationId) {
  const out = [];
  for (const rd of relatedDocuments) {
    // A caller that already decided the tax treatment wins — but an '02'
    // claim WITHOUT a desglose is re-derived: that is exactly the shape of a
    // stored item row where objeto_imp_dr is only the column DEFAULT '02'
    // (cfdi_payment_complement_items), and the builder would otherwise have
    // to degrade it to '03', losing the desglose the data supports.
    if (rd.objeto_imp_dr && (rd.objeto_imp_dr !== '02' || rd.traslado_dr)) { out.push(rd); continue; }
    const [origRows] = await db.query(
      'SELECT subtotal, total_impuestos, total FROM cfdi_documents WHERE uuid = ? AND organization_id = ? LIMIT 1',
      [rd.related_cfdi_uuid, organizationId],
    );
    const orig = origRows[0];
    const subtotal = Number(orig?.subtotal || 0);
    const impuestos = Number(orig?.total_impuestos || 0);
    if (!orig || subtotal <= 0 || impuestos <= 0) {
      // No original on file / no transferred tax → not object of tax.
      out.push({ ...rd, objeto_imp_dr: '01' });
      continue;
    }
    const ratio = impuestos / subtotal;
    const rate = CATALOG_IVA_RATES.find(r => Math.abs(ratio - r) < 0.005);
    if (rate === undefined) {
      // Taxed, but not at a catalog IVA rate we can assert — 03 = "sí objeto
      // del impuesto y no obligado al desglose" keeps the REP honest without
      // fabricating a TasaOCuotaDR the PAC would reject.
      out.push({ ...rd, objeto_imp_dr: '03' });
      continue;
    }
    // Proportional breakdown of this parcialidad's payment (guía de llenado):
    // base = pagado net of IVA at the invoice's rate, importe = the remainder.
    const pagado = Number(rd.imp_pagado);
    const base = Math.round((pagado / (1 + rate)) * 100) / 100;
    const importe = Math.round((pagado - base) * 100) / 100;
    out.push({
      ...rd,
      objeto_imp_dr: '02',
      traslado_dr: { base, tasa: rate.toFixed(6), importe },
    });
  }
  return out;
}

/**
 * Build the Complemento de Pago 2.0 XML string per the SAT specification.
 *
 * SAT rules for tipo=P:
 *   - Moneda at Comprobante level = 'XXX' (not-applicable currency)
 *   - SubTotal = 0, Total = 0
 *   - UsoCFDI = 'CP01' (Pagos)
 *   - Single Concepto: ClaveProdServ=84111506, ValorUnitario=0, Importe=0, ObjetoImp=01
 *   - cfdi:Complemento > pago20:Pagos Version="2.0"
 *   - pago20:Totales MontoTotalPagos = sum of imp_pagado across all items
 *   - xsi:schemaLocation must carry BOTH schema pairs (cfd/4 AND Pagos20) —
 *     sandbox-verified: SW rejects a REP without the Pagos20 pair (CO1003)
 *   - items may carry objeto_imp_dr + traslado_dr {base, tasa, importe} from
 *     enrichRelatedDocumentsWithTaxes; 02 renders ImpuestosDR per docto,
 *     aggregated ImpuestosP on the Pago, and per-rate Totales attributes
 */
function buildPaymentComplementXml(doc, complement, items) {
  // Fecha must be Mexico-local wall time. The old round-trip through
  // new Date(...).toISOString() re-emitted it as UTC — correct only on
  // UTC-clock servers, +N hours (a rejected future Fecha) everywhere else.
  // A plain string from cfdiExpeditionTime() is already CDMX wall time →
  // pass through; a zoned string or Date is an instant → convert to CDMX.
  let fecha = '';
  if (doc.fecha_emision instanceof Date) {
    fecha = cfdiExpeditionTime(doc.fecha_emision);
  } else if (doc.fecha_emision) {
    const s = String(doc.fecha_emision);
    if (/Z$|[+-]\d{2}:\d{2}$/.test(s)) {
      fecha = cfdiExpeditionTime(new Date(s));
    } else {
      // Local wall time, but callers may send MySQL 'YYYY-MM-DD HH:mm:ss' or a
      // bare date — the Fecha XSD pattern demands YYYY-MM-DDTHH:mm:ss exactly.
      fecha = s.replace(/\.\d+$/, '').replace(' ', 'T');
      if (!fecha.includes('T')) fecha = `${fecha}T00:00:00`;
    }
  }

  // FechaPago must include time component; use T00:00:00 if only a date was given
  const fechaPago = complement.payment_date
    ? (complement.payment_date.includes('T')
      ? complement.payment_date
      : `${complement.payment_date}T12:00:00`)
    : '';

  const montoTotalPagos = items
    .reduce((sum, rd) => sum + Number(rd.imp_pagado || 0), 0)
    .toFixed(2);

  // Optional payer/beneficiary attributes
  const payerAttrs = [
    complement.payer_rfc ? ` RfcEmisorCtaOrd="${escapeXml(complement.payer_rfc)}"` : '',
    complement.payer_bank_name ? ` NomBancoOrdExt="${escapeXml(complement.payer_bank_name)}"` : '',
    complement.payer_account ? ` CtaOrdenante="${escapeXml(complement.payer_account)}"` : '',
    complement.beneficiary_rfc ? ` RfcEmisorCtaBen="${escapeXml(complement.beneficiary_rfc)}"` : '',
    complement.beneficiary_account ? ` CtaBeneficiario="${escapeXml(complement.beneficiary_account)}"` : '',
  ].join('');

  const operacionAttr = complement.operation_number
    ? ` NumOperacion="${escapeXml(complement.operation_number)}"`
    : '';

  // CRP20215 (sandbox-verified): when MonedaP is MXN, TipoCambioP must be the
  // literal "1" — no decimals, and NOT omitted (the validator reads absent as 0).
  const monedaP = complement.moneda || 'MXN';
  const tipoCambioAttr = monedaP === 'MXN'
    ? ' TipoCambioP="1"'
    : (complement.tipo_cambio !== null && complement.tipo_cambio !== undefined
      ? ` TipoCambioP="${complement.tipo_cambio}"`
      : '');

  // Normalize the per-docto tax fields ONCE, before any XML assembly:
  //   - ObjetoImpDR is whitelisted to the c_ObjetoImp catalog (the nested
  //     related_documents fields are NOT walked by validate(), so a manual
  //     caller can put arbitrary strings here — never interpolate them raw);
  //   - the desglose numbers are Number-coerced for the same reason (a crafted
  //     `tasa` string was an XML-attribute injection into the fiscal document);
  //   - '02' with an unusable desglose degrades to '03' (sí objeto, sin
  //     desglose) — emitting 02 without ImpuestosDR is a CRP reject;
  //   - eq is the MonedaDR-per-MonedaP factor for the Pago-level rollup.
  const normItems = items.map(rd => {
    const eqNum = rd.equivalencia_dr !== undefined ? Number(rd.equivalencia_dr) : 1;
    const sameCurrency = (rd.moneda_dr || 'MXN') === monedaP;
    const eq = sameCurrency || !Number.isFinite(eqNum) || eqNum <= 0 ? 1 : eqNum;
    let objeto = ['02', '03', '04'].includes(String(rd.objeto_imp_dr)) ? String(rd.objeto_imp_dr) : '01';
    let traslado = null;
    if (objeto === '02') {
      const t = rd.traslado_dr || {};
      const tasa = Number(t.tasa);
      const base = Number(t.base);
      const importe = Number(t.importe);
      if ([tasa, base, importe].every(Number.isFinite)) traslado = { tasa, base, importe };
      else objeto = '03';
    }
    return { rd, sameCurrency, eq, objeto, traslado };
  });

  const doctosXml = normItems.map(({ rd, sameCurrency, eq, objeto, traslado }) => {
    const serieAttr = rd.serie ? ` Serie="${escapeXml(rd.serie)}"` : '';
    const folioAttr = rd.folio ? ` Folio="${escapeXml(String(rd.folio))}"` : '';
    // CRP20238 (sandbox-verified): same currency as MonedaP → EquivalenciaDR
    // must be the literal "1", not a decimal rendering like "1.0000".
    const eqVal = sameCurrency ? '1' : eq.toFixed(4);
    const head = `        <pago20:DoctoRelacionado IdDocumento="${escapeXml(rd.related_cfdi_uuid)}"${serieAttr}${folioAttr} MonedaDR="${escapeXml(rd.moneda_dr || 'MXN')}" EquivalenciaDR="${eqVal}" NumParcialidad="${rd.num_parcialidad || 1}" ImpSaldoAnt="${Number(rd.imp_saldo_ant).toFixed(2)}" ImpPagado="${Number(rd.imp_pagado).toFixed(2)}" ImpSaldoInsoluto="${Number(rd.imp_saldo_insoluto).toFixed(2)}" ObjetoImpDR="${objeto}"`;
    if (!traslado) return `${head} />`;
    return `${head}>
          <pago20:ImpuestosDR>
            <pago20:TrasladosDR>
              <pago20:TrasladoDR BaseDR="${traslado.base.toFixed(2)}" ImpuestoDR="002" TipoFactorDR="Tasa" TasaOCuotaDR="${traslado.tasa.toFixed(6)}" ImporteDR="${traslado.importe.toFixed(2)}" />
            </pago20:TrasladosDR>
          </pago20:ImpuestosDR>
        </pago20:DoctoRelacionado>`;
  }).join('\n');

  // Pago-level ImpuestosP: the docto traslados aggregated per (tasa) — XSD
  // sequence puts it AFTER the DoctoRelacionado nodes. Totales then carries
  // the per-rate TotalTraslados{Base,Impuesto}IVA{16,8,0} attribute pairs.
  // SAT wants these amounts in MonedaP: docto amounts are in MonedaDR, so
  // divide by eq (MonedaDR units per 1 MonedaP) when the currencies differ.
  const byRate = new Map();
  for (const { eq, traslado } of normItems) {
    if (!traslado) continue;
    const key = traslado.tasa.toFixed(6);
    const agg = byRate.get(key) || { base: 0, importe: 0 };
    agg.base += traslado.base / eq;
    agg.importe += traslado.importe / eq;
    byRate.set(key, agg);
  }
  const impuestosPXml = byRate.size === 0 ? '' : `
        <pago20:ImpuestosP>
          <pago20:TrasladosP>
${[...byRate.entries()].map(([tasa, agg]) =>
    `            <pago20:TrasladoP BaseP="${agg.base.toFixed(2)}" ImpuestoP="002" TipoFactorP="Tasa" TasaOCuotaP="${tasa}" ImporteP="${agg.importe.toFixed(2)}" />`,
  ).join('\n')}
          </pago20:TrasladosP>
        </pago20:ImpuestosP>`;
  const TOTALES_ATTR_BY_RATE = {
    '0.160000': ['TotalTrasladosBaseIVA16', 'TotalTrasladosImpuestoIVA16'],
    '0.080000': ['TotalTrasladosBaseIVA8', 'TotalTrasladosImpuestoIVA8'],
    '0.000000': ['TotalTrasladosBaseIVA0', 'TotalTrasladosImpuestoIVA0'],
  };
  const totalesAttrs = [...byRate.entries()].map(([tasa, agg]) => {
    const names = TOTALES_ATTR_BY_RATE[tasa];
    return names ? ` ${names[0]}="${agg.base.toFixed(2)}" ${names[1]}="${agg.importe.toFixed(2)}"` : '';
  }).join('');

  // Serie/Folio are optional attributes with non-empty XSD patterns — an empty
  // value is a schema violation, so omit them entirely when absent
  // (sandbox-verified rule, same as the invoice builder).
  const optAttrs = [
    doc.serie ? `  Serie="${escapeXml(doc.serie)}"` : null,
    doc.folio ? `  Folio="${escapeXml(String(doc.folio))}"` : null,
  ].filter(Boolean).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  xmlns:pago20="http://www.sat.gob.mx/Pagos20"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd http://www.sat.gob.mx/Pagos20 http://www.sat.gob.mx/sitio_internet/cfd/Pagos/Pagos20.xsd"
  Version="4.0"
${optAttrs ? `${optAttrs}\n` : ''}  Fecha="${fecha}"
  TipoDeComprobante="P"
  Exportacion="01"
  LugarExpedicion="${escapeXml(doc.lugar_expedicion || '')}"
  Moneda="XXX"
  SubTotal="0"
  Total="0">
  <cfdi:Emisor Rfc="${escapeXml(doc.emisor_rfc || '')}" Nombre="${escapeXml(doc.emisor_nombre || '')}" RegimenFiscal="${escapeXml(doc.emisor_regimen_fiscal || '')}" />
  <cfdi:Receptor Rfc="${escapeXml(doc.receptor_rfc || '')}" Nombre="${escapeXml(doc.receptor_nombre || '')}" DomicilioFiscalReceptor="${escapeXml(doc.receptor_domicilio_fiscal || '')}" RegimenFiscalReceptor="${escapeXml(doc.receptor_regimen_fiscal || '')}" UsoCFDI="CP01" />
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="84111506" Cantidad="1" ClaveUnidad="ACT" Descripcion="Pago" ValorUnitario="0" Importe="0" ObjetoImp="01" />
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <pago20:Pagos Version="2.0">
      <pago20:Totales${totalesAttrs} MontoTotalPagos="${montoTotalPagos}" />
      <pago20:Pago FechaPago="${fechaPago}" FormaDePagoP="${escapeXml(complement.forma_pago || '')}" MonedaP="${escapeXml(complement.moneda || 'MXN')}"${tipoCambioAttr} Monto="${Number(complement.amount).toFixed(2)}"${operacionAttr}${payerAttrs}>
${doctosXml}${impuestosPXml}
      </pago20:Pago>
    </pago20:Pagos>
  </cfdi:Complemento>
</cfdi:Comprobante>`;
}

/**
 * Retrieve a payment complement and its items by cfdi_document_id.
 */
async function getPaymentComplement(cfdiDocumentId, orgId) {
  const [docs] = await db.query(
    'SELECT * FROM cfdi_documents WHERE id = ? AND organization_id = ? AND tipo_comprobante = \'P\'',
    [cfdiDocumentId, orgId],
  );
  const doc = docs[0];
  if (!doc) throw new Error('Payment complement document not found');

  const [complements] = await db.query(
    'SELECT * FROM cfdi_payment_complements WHERE cfdi_document_id = ? LIMIT 1',
    [cfdiDocumentId],
  );
  const complement = complements[0];
  if (!complement) throw new Error('Payment complement record not found');

  const [items] = await db.query(
    'SELECT * FROM cfdi_payment_complement_items WHERE complement_id = ? ORDER BY id ASC',
    [complement.id],
  );

  return { document: doc, complement, items };
}

// =============================================================================
// Monthly CFDI Reconciliation Report
// =============================================================================

/**
 * Build a monthly CFDI reconciliation report comparing CFDIs issued in a
 * given calendar month against their SAT acknowledgment status.
 *
 * "Issued" = stamp_date falls within the requested month (sat_status != 'draft').
 * Drafts that were never stamped are excluded because they have no SAT UUID.
 *
 * @param {number} orgId   - Organization ID (tenant scope)
 * @param {number} year    - Calendar year  (e.g. 2026)
 * @param {number} month   - Calendar month (1–12)
 * @returns {Promise<object>}
 */
async function getReconciliationReport(orgId, year, month) {
  const paddedMonth = String(month).padStart(2, '0');
  const periodStart = `${year}-${paddedMonth}-01`;
  // First day of next month (exclusive upper bound)
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  const periodEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  logger.info({ orgId, year, month }, 'Building CFDI reconciliation report');

  // ------------------------------------------------------------------
  // 1. Aggregate totals by sat_status for stamped documents
  // ------------------------------------------------------------------
  const [statusRows] = await db.query(
    `SELECT
       sat_status,
       COUNT(*)               AS count,
       SUM(subtotal)          AS subtotal,
       SUM(total_impuestos)   AS total_impuestos,
       SUM(total)             AS total
     FROM cfdi_documents
     WHERE organization_id = ?
       AND sat_status != 'draft'
       AND stamp_date >= ? AND stamp_date < ?
     GROUP BY sat_status`,
    [orgId, periodStart, periodEnd],
  );

  // ------------------------------------------------------------------
  // 2. Aggregate totals by tipo_comprobante
  // ------------------------------------------------------------------
  const [tipoRows] = await db.query(
    `SELECT
       tipo_comprobante,
       COUNT(*)               AS count,
       SUM(subtotal)          AS subtotal,
       SUM(total_impuestos)   AS total_impuestos,
       SUM(total)             AS total
     FROM cfdi_documents
     WHERE organization_id = ?
       AND sat_status != 'draft'
       AND stamp_date >= ? AND stamp_date < ?
     GROUP BY tipo_comprobante`,
    [orgId, periodStart, periodEnd],
  );

  // ------------------------------------------------------------------
  // 3. Cancellation acknowledgment breakdown for this period's docs
  // ------------------------------------------------------------------
  const [cancellationRows] = await db.query(
    `SELECT
       cc.cancellation_status,
       COUNT(*) AS count
     FROM cfdi_cancellations cc
     INNER JOIN cfdi_documents cd ON cd.id = cc.cfdi_document_id
     WHERE cc.organization_id = ?
       AND cd.sat_status != 'draft'
       AND cd.stamp_date >= ? AND cd.stamp_date < ?
     GROUP BY cc.cancellation_status`,
    [orgId, periodStart, periodEnd],
  );

  // ------------------------------------------------------------------
  // Assemble the report
  // ------------------------------------------------------------------
  const toNum = v => Number(v) || 0;

  // Build by_status map
  const statusMap = {};
  let totalIssued = 0;
  let totalSubtotal = 0;
  let totalImpuestos = 0;
  let totalTotal = 0;

  for (const row of statusRows) {
    statusMap[row.sat_status] = {
      count:           toNum(row.count),
      subtotal:        toNum(row.subtotal),
      total_impuestos: toNum(row.total_impuestos),
      total:           toNum(row.total),
    };
    totalIssued    += toNum(row.count);
    totalSubtotal  += toNum(row.subtotal);
    totalImpuestos += toNum(row.total_impuestos);
    totalTotal     += toNum(row.total);
  }

  // Ensure all known statuses are present
  for (const s of ['vigente', 'cancelado', 'cancel_pending']) {
    if (!statusMap[s]) {
      statusMap[s] = { count: 0, subtotal: 0, total_impuestos: 0, total: 0 };
    }
  }

  // Build by_tipo map
  const tipoMap = {};
  for (const row of tipoRows) {
    tipoMap[row.tipo_comprobante] = {
      count:           toNum(row.count),
      subtotal:        toNum(row.subtotal),
      total_impuestos: toNum(row.total_impuestos),
      total:           toNum(row.total),
    };
  }

  // Build cancellations breakdown
  const cancellationMap = { accepted: 0, rejected: 0, pending: 0, cancelled_by_timeout: 0 };
  for (const row of cancellationRows) {
    if (row.cancellation_status in cancellationMap) {
      cancellationMap[row.cancellation_status] = toNum(row.count);
    }
  }

  return {
    period: { year, month },
    period_start: periodStart,
    period_end:   `${year}-${paddedMonth}-${lastDayOfMonth(year, month)}`,
    issued: {
      count:           totalIssued,
      subtotal:        totalSubtotal,
      total_impuestos: totalImpuestos,
      total:           totalTotal,
    },
    by_status:      statusMap,
    by_tipo:        tipoMap,
    cancellations: {
      accepted_by_sat:      cancellationMap.accepted,
      rejected_by_sat:      cancellationMap.rejected,
      pending_sat_response: cancellationMap.pending,
      timed_out:            cancellationMap.cancelled_by_timeout,
    },
  };
}

/** Return the last calendar day (1-based) for a given year/month. */
function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

module.exports = {
  generateXml, buildCfdi40Xml, escapeXml, cfdiExpeditionTime, getEmisorProfile, swAuthToken, stamp, cancel,
  callPacStamp, callPacCancel, callPacCancelStatus,
  parseCancellationStatus, getCancellationStatus, listCancellations,
  generatePaymentComplement, buildPaymentComplementXml, enrichRelatedDocumentsWithTaxes, getPaymentComplement,
  getReconciliationReport,
  httpRequest, circuitBreaker, providerBreaker,
};
