// =============================================================================
// FireISP 5.0 — CFDI Controller
// =============================================================================
// Domain-specific endpoints for Mexican fiscal compliance (CFDI 4.0):
//   generate XML → stamp via PAC → cancel → download XML/PDF.
// =============================================================================

const db = require('../config/database');
const cfdiService = require('../services/cfdiService');

/**
 * POST /api/cfdi/generate-xml
 * Generate CFDI 4.0 XML for a CFDI document.
 */
async function generateXml(req, res, next) {
  try {
    const { cfdi_document_id } = req.body;

    // Verify document belongs to this org
    const [docs] = await db.query(
      'SELECT * FROM cfdi_documents WHERE id = ? AND organization_id = ?',
      [cfdi_document_id, req.orgId],
    );
    if (!docs[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'CFDI document not found' } });
    }

    const result = await cfdiService.generateXml(cfdi_document_id);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/cfdi/stamp
 * Submit CFDI document to PAC for stamping (timbrado).
 */
async function stamp(req, res, next) {
  try {
    const { cfdi_document_id } = req.body;

    const [docs] = await db.query(
      'SELECT * FROM cfdi_documents WHERE id = ? AND organization_id = ?',
      [cfdi_document_id, req.orgId],
    );
    if (!docs[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'CFDI document not found' } });
    }

    const result = await cfdiService.stamp(cfdi_document_id);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/cfdi/cancel
 * Cancel a stamped CFDI document with the SAT.
 */
async function cancel(req, res, next) {
  try {
    const { cfdi_document_id, reason, replacement_uuid } = req.body;

    const [docs] = await db.query(
      'SELECT * FROM cfdi_documents WHERE id = ? AND organization_id = ?',
      [cfdi_document_id, req.orgId],
    );
    if (!docs[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'CFDI document not found' } });
    }

    const result = await cfdiService.cancel(cfdi_document_id, reason, replacement_uuid);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/cfdi/:id/xml
 * Download the generated XML for a CFDI document.
 */
async function downloadXml(req, res, next) {
  try {
    const [docs] = await db.query(
      'SELECT * FROM cfdi_documents WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (!docs[0] || !docs[0].xml_content) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'XML not found' } });
    }

    res.set('Content-Type', 'application/xml');
    res.set('Content-Disposition', `attachment; filename="CFDI-${docs[0].uuid || docs[0].id}.xml"`);
    res.send(docs[0].xml_content);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/cfdi/:id/pdf
 * Generate and download a PDF representation of a CFDI document.
 */
async function downloadPdf(req, res, next) {
  try {
    const [docs] = await db.query(
      'SELECT * FROM cfdi_documents WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (!docs[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'CFDI document not found' } });
    }

    const doc = docs[0];

    // Fetch conceptos for the PDF
    const [conceptos] = await db.query(
      'SELECT * FROM cfdi_conceptos WHERE cfdi_document_id = ?',
      [doc.id],
    );

    const PDFDocument = require('pdfkit');
    const pdfDoc = new PDFDocument({ size: 'LETTER', margin: 50 });

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="CFDI-${doc.uuid || doc.id}.pdf"`);
    pdfDoc.pipe(res);

    // Header
    pdfDoc.fontSize(18).text('CFDI 4.0', { align: 'center' });
    pdfDoc.moveDown(0.5);
    pdfDoc.fontSize(10);
    pdfDoc.text(`UUID: ${doc.uuid || 'N/A'}`);
    pdfDoc.text(`Serie: ${doc.serie || ''} Folio: ${doc.folio || ''}`);
    pdfDoc.text(`Fecha: ${doc.fecha_emision || ''}`);
    pdfDoc.text(`Tipo: ${doc.tipo_comprobante || ''} | Moneda: ${doc.moneda || ''}`);
    pdfDoc.moveDown();

    // Emisor / Receptor
    pdfDoc.fontSize(12).text('Emisor', { underline: true });
    pdfDoc.fontSize(10);
    pdfDoc.text(`RFC: ${doc.emisor_rfc || ''} — ${doc.emisor_nombre || ''}`);
    pdfDoc.moveDown(0.5);
    pdfDoc.fontSize(12).text('Receptor', { underline: true });
    pdfDoc.fontSize(10);
    pdfDoc.text(`RFC: ${doc.receptor_rfc || ''} — ${doc.receptor_nombre || ''}`);
    pdfDoc.moveDown();

    // Conceptos table
    pdfDoc.fontSize(12).text('Conceptos', { underline: true });
    pdfDoc.moveDown(0.3);
    pdfDoc.fontSize(9);
    for (const c of conceptos) {
      pdfDoc.text(
        `${c.cantidad}x ${c.descripcion || ''} @ $${c.valor_unitario || 0} = $${c.importe || 0}`,
      );
    }

    pdfDoc.moveDown();
    pdfDoc.fontSize(11);
    pdfDoc.text(`Subtotal: $${doc.subtotal || 0}`);
    pdfDoc.text(`Total:    $${doc.total || 0}`, { bold: true });

    if (doc.uuid) {
      pdfDoc.moveDown();
      pdfDoc.fontSize(8).text(`Sello SAT: ${doc.sello_sat || 'N/A'}`);
    }

    pdfDoc.end();
  } catch (err) {
    next(err);
  }
}

module.exports = { generateXml, stamp, cancel, downloadXml, downloadPdf };
