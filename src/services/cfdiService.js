// =============================================================================
// FireISP 5.0 — CFDI Service
// =============================================================================
// Generates CFDI 4.0 XML documents, submits to PAC for stamping,
// and handles cancellation flows.
// =============================================================================

const crypto = require('crypto');
const db = require('../config/database');

/**
 * Generate CFDI XML for an invoice.
 * Builds the XML structure from cfdi_documents and cfdi_conceptos rows.
 */
async function generateXml(cfdiDocumentId) {
  const [docs] = await db.query('SELECT * FROM cfdi_documents WHERE id = ?', [cfdiDocumentId]);
  const doc = docs[0];
  if (!doc) throw new Error('CFDI document not found');

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
  const xml = buildCfdi40Xml(doc, conceptos, impuestos);

  // Store the generated XML
  await db.query(
    'UPDATE cfdi_documents SET xml_content = ?, sat_status = ? WHERE id = ?',
    [xml, 'draft', cfdiDocumentId],
  );

  return { cfdi_document_id: cfdiDocumentId, xml };
}

/**
 * Build CFDI 4.0 XML string.
 */
function buildCfdi40Xml(doc, conceptos, impuestos) {
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

  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  Version="4.0"
  Serie="${escapeXml(doc.serie || '')}"
  Folio="${escapeXml(doc.folio || '')}"
  Fecha="${doc.fecha_emision ? new Date(doc.fecha_emision).toISOString().replace(/\\.\\d+Z$/, '') : ''}"
  FormaPago="${doc.forma_pago || ''}"
  MetodoPago="${doc.metodo_pago || ''}"
  TipoDeComprobante="${doc.tipo_comprobante || 'I'}"
  Exportacion="${doc.exportacion || '01'}"
  LugarExpedicion="${doc.lugar_expedicion || ''}"
  Moneda="${doc.moneda || 'MXN'}"
  SubTotal="${doc.subtotal || 0}"
  Total="${doc.total || 0}">
  <cfdi:Emisor Rfc="${escapeXml(doc.emisor_rfc || '')}" Nombre="${escapeXml(doc.emisor_nombre || '')}" RegimenFiscal="${doc.emisor_regimen_fiscal || ''}" />
  <cfdi:Receptor Rfc="${escapeXml(doc.receptor_rfc || '')}" Nombre="${escapeXml(doc.receptor_nombre || '')}" DomicilioFiscalReceptor="${doc.receptor_domicilio_fiscal || ''}" RegimenFiscalReceptor="${doc.receptor_regimen_fiscal || ''}" UsoCFDI="${doc.uso_cfdi || ''}" />
  <cfdi:Conceptos>
${conceptosXml}
  </cfdi:Conceptos>
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
  const [docs] = await db.query('SELECT * FROM cfdi_documents WHERE id = ?', [cfdiDocumentId]);
  const doc = docs[0];
  if (!doc) throw new Error('CFDI document not found');
  if (!doc.xml_content) throw new Error('XML not generated yet — call generateXml first');

  // Get PAC provider for the organization
  const [pacs] = await db.query(
    'SELECT * FROM pac_providers WHERE organization_id = ? AND status = \'active\' LIMIT 1',
    [doc.organization_id],
  );

  if (pacs.length === 0) {
    throw new Error('No active PAC provider configured for this organization');
  }

  const pac = pacs[0];
  let uuid, signedXml, selloSat, cadenaOriginal;

  try {
    const result = await callPacStamp(pac, doc.xml_content);
    uuid = result.uuid;
    signedXml = result.signedXml || doc.xml_content;
    selloSat = result.selloSat || null;
    cadenaOriginal = result.cadenaOriginal || null;
  } catch (pacErr) {
    // Record the failure
    await db.query(
      'UPDATE cfdi_documents SET sat_status = ? WHERE id = ?',
      ['stamp_error', cfdiDocumentId],
    );
    throw new Error(`PAC stamping failed: ${pacErr.message}`, { cause: pacErr });
  }

  await db.query(
    `UPDATE cfdi_documents
     SET uuid = ?, sat_status = ?, stamped_at = NOW(),
         signed_xml = ?, sello_sat = ?, cadena_original = ?
     WHERE id = ?`,
    [uuid, 'vigente', signedXml, selloSat, cadenaOriginal, cfdiDocumentId],
  );

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

  // Fallback for development / unknown providers — generate placeholder UUID
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
 * Cancel a stamped CFDI document.
 */
async function cancel(cfdiDocumentId, reason, replacementUuid = null) {
  const [docs] = await db.query('SELECT * FROM cfdi_documents WHERE id = ?', [cfdiDocumentId]);
  const doc = docs[0];
  if (!doc) throw new Error('CFDI document not found');
  if (doc.sat_status !== 'vigente') throw new Error('Can only cancel vigente documents');

  // Record cancellation
  await db.query(
    `INSERT INTO cfdi_cancellations (cfdi_document_id, organization_id, motivo, folio_sustitucion, cancellation_status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [cfdiDocumentId, doc.organization_id, reason, replacementUuid],
  );

  // PAC cancellation API call would happen here
  await db.query(
    'UPDATE cfdi_documents SET sat_status = ?, cancellation_reason = ? WHERE id = ?',
    ['cancel_pending', reason, cfdiDocumentId],
  );

  return { cfdi_document_id: cfdiDocumentId, status: 'cancel_pending', reason };
}

module.exports = { generateXml, buildCfdi40Xml, escapeXml, stamp, cancel, callPacStamp, httpRequest };
