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
 * Cancel a stamped CFDI document with the SAT via a PAC provider.
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
 * GET /api/cfdi/:id/cancellation-status
 * Check the cancellation status of a CFDI document.
 * Polls the PAC if status is still pending.
 */
async function cancellationStatus(req, res, next) {
  try {
    const [docs] = await db.query(
      'SELECT * FROM cfdi_documents WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (!docs[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'CFDI document not found' } });
    }

    // Get the latest cancellation record
    const [cancellations] = await db.query(
      `SELECT * FROM cfdi_cancellations
       WHERE cfdi_document_id = ? AND organization_id = ?
       ORDER BY requested_at DESC LIMIT 1`,
      [req.params.id, req.orgId],
    );
    if (!cancellations[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No cancellation request found for this document' } });
    }

    const result = await cfdiService.getCancellationStatus(cancellations[0].id);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/cfdi/:id/cancellations
 * List all cancellation records for a CFDI document.
 */
async function listCancellations(req, res, next) {
  try {
    const [docs] = await db.query(
      'SELECT * FROM cfdi_documents WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (!docs[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'CFDI document not found' } });
    }

    const cancellations = await cfdiService.listCancellations(req.params.id, req.orgId);
    res.json({ data: cancellations });
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

/**
 * POST /api/cfdi/payment-complement
 * Create a Complemento de Pago 2.0 CFDI (tipo P) for a payment event.
 * Expects all required fields in req.body; organization_id comes from orgScope.
 */
async function createPaymentComplement(req, res, next) {
  try {
    const params = { ...req.body, organization_id: req.orgId };
    const result = await cfdiService.generatePaymentComplement(params);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/cfdi/payment-complement/:id
 * Retrieve a payment complement (cfdi_documents tipo P) with its items.
 * :id is the cfdi_document_id.
 */
async function getPaymentComplement(req, res, next) {
  try {
    const result = await cfdiService.getPaymentComplement(req.params.id, req.orgId);
    res.json({ data: result });
  } catch (err) {
    if (err.message === 'Payment complement document not found' ||
        err.message === 'Payment complement record not found') {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: err.message } });
    }
    next(err);
  }
}

module.exports = {
  generateXml, stamp, cancel, cancellationStatus, listCancellations, downloadXml, downloadPdf,
  createPaymentComplement, getPaymentComplement,
};
