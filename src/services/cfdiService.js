// =============================================================================
// FireISP 5.0 — CFDI Service
// =============================================================================
// Generates CFDI 4.0 XML documents, submits to PAC for stamping,
// and handles cancellation flows.
// =============================================================================

const crypto = require('crypto');
const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'cfdi' });
const { CfdiStampingError, CfdiCancellationError, AppError } = require('../utils/errors');

// ---------------------------------------------------------------------------
// Simple circuit breaker for PAC stamping calls
// ---------------------------------------------------------------------------
const circuitBreaker = {
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

async function generateXml(cfdiDocumentId) {
  logger.info({ cfdiDocumentId }, 'Generating CFDI XML');
  const [docs] = await db.query('SELECT * FROM cfdi_documents WHERE id = ?', [cfdiDocumentId]);
  const doc = docs[0];
  if (!doc) throw new Error('CFDI document not found');

  const emisor = await getEmisorProfile(doc.organization_id);

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

    return `    <cfdi:Concepto ClaveProdServ="${c.clave_prod_serv || ''}" NoIdentificacion="${c.no_identificacion || ''}" Cantidad="${c.cantidad}" ClaveUnidad="${c.clave_unidad || ''}" Descripcion="${escapeXml(c.descripcion || '')}" ValorUnitario="${c.valor_unitario}" Importe="${c.importe}" ObjetoImp="${c.objeto_imp || '02'}">${taxesXml}
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

  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  Version="4.0"
  Serie="${escapeXml(doc.serie || '')}"
  Folio="${escapeXml(doc.folio || '')}"
  Fecha="${fecha}"
  FormaPago="${doc.forma_pago || ''}"
  MetodoPago="${doc.metodo_pago || ''}"
  TipoDeComprobante="${doc.tipo_comprobante || 'I'}"
  Exportacion="${doc.exportacion || '01'}"
  LugarExpedicion="${escapeXml(emisor.codigo_postal_fiscal)}"
  Moneda="${doc.moneda || 'MXN'}"
  SubTotal="${doc.subtotal || 0}"
  Total="${doc.total || 0}">
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

  // Get PAC provider for the organization
  const [pacs] = await db.query(
    'SELECT * FROM pac_providers WHERE organization_id = ? AND status = \'active\' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1',
    [doc.organization_id],
  );

  if (pacs.length === 0) {
    throw new CfdiStampingError('No active PAC provider configured for this organization', { cfdiDocumentId, orgId: doc.organization_id });
  }

  const pac = pacs[0];
  // NOTE: callPacStamp also returns cadenaOriginal, but cfdi_documents has no
  // column for it (database/schema.sql) — it is reproducible from signed_xml.
  let uuid, signedXml, selloSat;

  // Retry with exponential backoff (up to 3 attempts)
  const MAX_RETRIES = 3;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await callPacStamp(pac, doc.xml_content);
      uuid = result.uuid;
      signedXml = result.signedXml || doc.xml_content;
      selloSat = result.selloSat || null;
      circuitBreaker.recordSuccess();
      lastErr = null;
      break;
    } catch (pacErr) {
      lastErr = pacErr;
      logger.warn({ cfdiDocumentId, attempt, err: pacErr.message }, 'PAC stamping attempt failed');
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }

  if (lastErr) {
    circuitBreaker.recordFailure();
    // sat_status is ENUM('draft','vigente','cancelado','cancel_pending') — there is
    // no 'stamp_error' value (database/schema.sql), so the UPDATE that used to be
    // here threw and *masked* the real PAC error with a DB error. A document that
    // failed to stamp stays 'draft' (it is not fiscally valid) and the caller gets
    // the actual CfdiStampingError.
    throw new CfdiStampingError(
      `PAC stamping failed after ${MAX_RETRIES} attempts: ${lastErr.message}`,
      { cfdiDocumentId, provider: pac.provider_name, cause: lastErr.message },
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

  logger.info({ cfdiDocumentId, uuid }, 'CFDI document stamped successfully');
  return { cfdi_document_id: cfdiDocumentId, uuid, status: 'vigente' };
}

/**
 * Call the PAC stamping API based on the provider name.
 * Supported: finkok, sw_sapien.
 * Other providers fall back to a placeholder UUID (development mode).
 */
async function callPacStamp(pac, xmlContent) {
  if (pac.provider_name === 'finkok') {
    // Finkok REST API — POST /stamp
    const url = pac.environment === 'production'
      ? 'https://facturacion.finkok.com/servicios/soap/stamp'
      : 'https://demo-facturacion.finkok.com/servicios/soap/stamp';

    const body = JSON.stringify({
      username: pac.username,
      password: pac.password_encrypted, // Decrypted at app layer in production
      xml: Buffer.from(xmlContent).toString('base64'),
    });

    const response = await httpRequest(url, 'POST', body, {
      'Content-Type': 'application/json',
    });

    const data = JSON.parse(response.body);
    if (data.error || !data.uuid) {
      throw new Error(data.error || 'Finkok stamping returned no UUID');
    }

    return {
      uuid: data.uuid,
      signedXml: data.xml ? Buffer.from(data.xml, 'base64').toString('utf8') : null,
      selloSat: data.sello_sat || null,
      cadenaOriginal: data.cadena_original || null,
    };
  }

  if (pac.provider_name === 'sw_sapien') {
    // SW Sapien REST API
    const baseUrl = pac.environment === 'production'
      ? 'https://services.sw.com.mx'
      : 'https://services.test.sw.com.mx';

    // Authenticate to get token
    const authResponse = await httpRequest(`${baseUrl}/security/authenticate`, 'POST',
      JSON.stringify({ user: pac.username, password: pac.password_encrypted }),
      { 'Content-Type': 'application/json' },
    );
    const authData = JSON.parse(authResponse.body);
    if (!authData.data?.token) {
      throw new Error('SW Sapien authentication failed');
    }

    // Stamp
    const stampResponse = await httpRequest(`${baseUrl}/cfdi33/stamp/v4`, 'POST',
      xmlContent,
      {
        'Content-Type': 'application/xml',
        'Authorization': `Bearer ${authData.data.token}`,
      },
    );
    const stampData = JSON.parse(stampResponse.body);
    if (!stampData.data?.uuid) {
      throw new Error(stampData.message || 'SW Sapien stamping failed');
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
  // environment='sandbox', and its UUIDs are unmistakably fake ('SIM-…').
  // A 'simulator' row with environment='production' is a misconfiguration.
  if (pac.provider_name === 'simulator') {
    if (pac.environment !== 'sandbox') {
      throw new Error("The 'simulator' PAC only runs with environment='sandbox' — it never produces fiscally valid CFDIs.");
    }
    logger.warn({ provider: 'simulator' }, 'SIMULATED stamping — NOT a fiscally valid CFDI');
    return {
      uuid: `SIM-${crypto.randomUUID()}`,
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

  // Get PAC provider
  const [pacs] = await db.query(
    'SELECT * FROM pac_providers WHERE organization_id = ? AND status = \'active\' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1',
    [doc.organization_id],
  );
  if (pacs.length === 0) {
    throw new CfdiCancellationError('No active PAC provider configured for this organization', { cfdiDocumentId, orgId: doc.organization_id });
  }
  const pac = pacs[0];

  // Record the cancellation request
  const [insertResult] = await db.query(
    `INSERT INTO cfdi_cancellations
       (cfdi_document_id, organization_id, uuid, motivo, folio_sustitucion,
        cancellation_status, requested_at, pac_provider_id)
     VALUES (?, ?, ?, ?, ?, 'pending', NOW(), ?)`,
    [cfdiDocumentId, doc.organization_id, doc.uuid, reason, replacementUuid, pac.id],
  );
  const cancellationId = insertResult.insertId;

  // Update CFDI document status to cancel_pending
  await db.query(
    'UPDATE cfdi_documents SET sat_status = ?, cancellation_reason = ?, cancellation_uuid = ? WHERE id = ?',
    ['cancel_pending', reason, replacementUuid, cfdiDocumentId],
  );

  // Submit cancellation to PAC with retry logic
  const MAX_RETRIES = 3;
  let lastErr;
  let pacResult;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      pacResult = await callPacCancel(pac, doc.uuid, reason, replacementUuid, doc);
      lastErr = null;
      break;
    } catch (pacErr) {
      lastErr = pacErr;
      logger.warn({ cfdiDocumentId, attempt, err: pacErr.message }, 'PAC cancellation attempt failed');
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }

  if (lastErr) {
    // Record the failure in the cancellation record
    await db.query(
      'UPDATE cfdi_cancellations SET error_message = ? WHERE id = ?',
      [lastErr.message, cancellationId],
    );
    logger.error({ cfdiDocumentId, err: lastErr.message }, 'PAC cancellation failed after retries');
    throw new CfdiCancellationError(
      `PAC cancellation failed after ${MAX_RETRIES} attempts: ${lastErr.message}`,
      { cfdiDocumentId, provider: pac.provider_name, cause: lastErr.message },
    );
  }

  // Process PAC response
  const finalStatus = pacResult.status || 'pending';
  const acuseXml = pacResult.acuseXml || null;
  const acuseFecha = pacResult.acuseFecha || null;

  // Update cancellation record with PAC response
  await db.query(
    `UPDATE cfdi_cancellations
     SET cancellation_status = ?, acuse_xml = ?, acuse_fecha = ?, responded_at = NOW()
     WHERE id = ?`,
    [finalStatus, acuseXml, acuseFecha, cancellationId],
  );

  // Update CFDI document status based on PAC response
  if (finalStatus === 'accepted') {
    await db.query(
      'UPDATE cfdi_documents SET sat_status = ?, cancelled_at = NOW() WHERE id = ?',
      ['cancelado', cfdiDocumentId],
    );
    await syncInvoiceCancelled(cfdiDocumentId);
  } else if (finalStatus === 'rejected') {
    // Revert to vigente since SAT rejected the cancellation
    await db.query(
      'UPDATE cfdi_documents SET sat_status = ? WHERE id = ?',
      ['vigente', cfdiDocumentId],
    );
  }
  // If status is 'pending', it stays cancel_pending — will be resolved via getCancellationStatus

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
    const url = pac.environment === 'production'
      ? 'https://facturacion.finkok.com/servicios/soap/cancel'
      : 'https://demo-facturacion.finkok.com/servicios/soap/cancel';

    const body = JSON.stringify({
      username: pac.username,
      password: pac.password_encrypted,
      uuid,
      rfc: doc.emisor_rfc,
      motivo: reason,
      folio_sustitucion: replacementUuid || '',
    });

    const response = await httpRequest(url, 'POST', body, {
      'Content-Type': 'application/json',
    });

    const data = JSON.parse(response.body);
    if (data.error) {
      throw new Error(data.error);
    }

    return {
      status: parseCancellationStatus(data.estatus || data.status),
      acuseXml: data.acuse_xml || data.acuse || null,
      acuseFecha: data.fecha_cancelacion || null,
    };
  }

  if (pac.provider_name === 'sw_sapien') {
    const baseUrl = pac.environment === 'production'
      ? 'https://services.sw.com.mx'
      : 'https://services.test.sw.com.mx';

    // Authenticate
    const authResponse = await httpRequest(`${baseUrl}/security/authenticate`, 'POST',
      JSON.stringify({ user: pac.username, password: pac.password_encrypted }),
      { 'Content-Type': 'application/json' },
    );
    const authData = JSON.parse(authResponse.body);
    if (!authData.data?.token) {
      throw new Error('SW Sapien authentication failed');
    }

    // Submit cancellation
    const cancelBody = JSON.stringify({
      uuid,
      rfc: doc.emisor_rfc,
      motivo: reason,
      folioSustitucion: replacementUuid || '',
    });

    const cancelResponse = await httpRequest(`${baseUrl}/cfdi33/cancel`, 'POST',
      cancelBody,
      {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authData.data.token}`,
      },
    );
    const cancelData = JSON.parse(cancelResponse.body);
    if (cancelData.status === 'error') {
      throw new Error(cancelData.message || 'SW Sapien cancellation failed');
    }

    return {
      status: parseCancellationStatus(cancelData.data?.estatus || cancelData.data?.status),
      acuseXml: cancelData.data?.acuse || null,
      acuseFecha: cancelData.data?.fechaCancelacion || null,
    };
  }

  // Simulator: accept immediately (see callPacStamp for the contract).
  if (pac.provider_name === 'simulator') {
    if (pac.environment !== 'sandbox') {
      throw new Error("The 'simulator' PAC only runs with environment='sandbox'.");
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
      [finalStatus, pacResult.acuseXml, pacResult.acuseFecha, cancellationId],
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
    const url = pac.environment === 'production'
      ? 'https://facturacion.finkok.com/servicios/soap/cancel'
      : 'https://demo-facturacion.finkok.com/servicios/soap/cancel';

    const body = JSON.stringify({
      username: pac.username,
      password: pac.password_encrypted,
      uuid,
      type: 'query',
    });

    const response = await httpRequest(url, 'POST', body, {
      'Content-Type': 'application/json',
    });

    const data = JSON.parse(response.body);
    return {
      status: parseCancellationStatus(data.estatus || data.status),
      acuseXml: data.acuse_xml || data.acuse || null,
      acuseFecha: data.fecha_cancelacion || null,
    };
  }

  if (pac.provider_name === 'sw_sapien') {
    const baseUrl = pac.environment === 'production'
      ? 'https://services.sw.com.mx'
      : 'https://services.test.sw.com.mx';

    const authResponse = await httpRequest(`${baseUrl}/security/authenticate`, 'POST',
      JSON.stringify({ user: pac.username, password: pac.password_encrypted }),
      { 'Content-Type': 'application/json' },
    );
    const authData = JSON.parse(authResponse.body);
    if (!authData.data?.token) {
      throw new Error('SW Sapien authentication failed');
    }

    const statusResponse = await httpRequest(
      `${baseUrl}/cfdi33/cancel/${encodeURIComponent(uuid)}/status`,
      'GET',
      null,
      { 'Authorization': `Bearer ${authData.data.token}` },
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

  // 3. Create cfdi_payment_complement_items records
  for (const rd of related_documents) {
    await db.query(
      `INSERT INTO cfdi_payment_complement_items
         (complement_id, related_cfdi_uuid, serie, folio, moneda_dr, equivalencia_dr,
          num_parcialidad, imp_saldo_ant, imp_pagado, imp_saldo_insoluto)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ],
    );
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
  const xml = buildPaymentComplementXml(doc, complement, related_documents);

  // 5. Store the generated XML
  await db.query(
    'UPDATE cfdi_documents SET xml_content = ? WHERE id = ?',
    [xml, cfdiDocumentId],
  );

  logger.info({ cfdiDocumentId, complementId }, 'Complemento de Pago generated');
  return { cfdi_document_id: cfdiDocumentId, complement_id: complementId, xml };
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
 */
function buildPaymentComplementXml(doc, complement, items) {
  const fecha = doc.fecha_emision
    ? new Date(doc.fecha_emision).toISOString().replace(/\.\d+Z$/, '')
    : '';

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

  const tipoCambioAttr = complement.tipo_cambio !== null && complement.tipo_cambio !== undefined
    ? ` TipoCambioP="${complement.tipo_cambio}"`
    : '';

  const doctosXml = items.map(rd => {
    const serieAttr = rd.serie ? ` Serie="${escapeXml(rd.serie)}"` : '';
    const folioAttr = rd.folio ? ` Folio="${escapeXml(String(rd.folio))}"` : '';
    const eqDR = rd.equivalencia_dr !== undefined ? Number(rd.equivalencia_dr) : 1;
    return `        <pago20:DoctoRelacionado IdDocumento="${escapeXml(rd.related_cfdi_uuid)}"${serieAttr}${folioAttr} MonedaDR="${escapeXml(rd.moneda_dr || 'MXN')}" EquivalenciaDR="${eqDR.toFixed(4)}" NumParcialidad="${rd.num_parcialidad || 1}" ImpSaldoAnt="${Number(rd.imp_saldo_ant).toFixed(2)}" ImpPagado="${Number(rd.imp_pagado).toFixed(2)}" ImpSaldoInsoluto="${Number(rd.imp_saldo_insoluto).toFixed(2)}" ObjetoImpDR="01" />`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  xmlns:pago20="http://www.sat.gob.mx/Pagos20"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  Version="4.0"
  Serie="${escapeXml(doc.serie || '')}"
  Folio="${escapeXml(String(doc.folio || ''))}"
  Fecha="${fecha}"
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
      <pago20:Totales MontoTotalPagos="${montoTotalPagos}" />
      <pago20:Pago FechaPago="${fechaPago}" FormaDePagoP="${escapeXml(complement.forma_pago || '')}" MonedaP="${escapeXml(complement.moneda || 'MXN')}"${tipoCambioAttr} Monto="${Number(complement.amount).toFixed(2)}"${operacionAttr}${payerAttrs}>
${doctosXml}
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
  generateXml, buildCfdi40Xml, escapeXml, cfdiExpeditionTime, getEmisorProfile, stamp, cancel,
  callPacStamp, callPacCancel, callPacCancelStatus,
  parseCancellationStatus, getCancellationStatus, listCancellations,
  generatePaymentComplement, buildPaymentComplementXml, getPaymentComplement,
  getReconciliationReport,
  httpRequest, circuitBreaker,
};
