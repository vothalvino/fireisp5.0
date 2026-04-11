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
    `<cfdi:Traslado Base="${t.base}" Impuesto="${t.impuesto}" TipoFactor="${t.tipo_factor}" TasaOCuota="${t.tasa_o_cuota}" Importe="${t.importe}" />`
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
 * This is a placeholder for the actual PAC API integration.
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

  // PAC stamping would happen here (API call to Finkok, SW Sapien, etc.)
  // For now, generate a placeholder UUID and mark as vigente
  const uuid = crypto.randomUUID();

  await db.query(
    'UPDATE cfdi_documents SET uuid = ?, sat_status = ?, stamped_at = NOW() WHERE id = ?',
    [uuid, 'vigente', cfdiDocumentId],
  );

  return { cfdi_document_id: cfdiDocumentId, uuid, status: 'vigente' };
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

module.exports = { generateXml, buildCfdi40Xml, escapeXml, stamp, cancel };
