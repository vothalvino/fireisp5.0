// =============================================================================
// FireISP 5.0 — CFDI Controller
// =============================================================================
// Domain-specific endpoints for Mexican fiscal compliance (CFDI 4.0):
//   generate XML → stamp via PAC → cancel → download XML/PDF.
// =============================================================================

const db = require('../config/database');
const pdfService = require('../services/pdfService');
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
    // Once stamped, signed_xml (with the TimbreFiscalDigital complement and
    // seals, as returned by the PAC) IS the fiscal document — serving the
    // pre-stamp builder XML for a vigente CFDI hands the client a legally
    // useless file. Caught live: the download of a freshly SW-stamped CFDI
    // came back without its TFD.
    const fiscalXml = docs[0] && (docs[0].signed_xml || docs[0].xml_content);
    if (!fiscalXml) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'XML not found' } });
    }

    res.set('Content-Type', 'application/xml');
    res.set('Content-Disposition', `attachment; filename="CFDI-${docs[0].uuid || docs[0].id}.xml"`);
    res.send(fiscalXml);
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
      'SELECT id, uuid FROM cfdi_documents WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (!docs[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'CFDI document not found' } });
    }

    // One renderer for every CFDI PDF: pdfService picks the representación
    // impresa for stamped documents and the draft summary otherwise. The
    // hand-rolled layout that used to live here read phantom columns
    // (sello_sat / fecha_emision) and skipped every legally required element.
    const buffer = await pdfService.generateCfdiPdf(docs[0].id, { locale: 'es' });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="CFDI-${docs[0].uuid || docs[0].id}.pdf"`);
    res.send(buffer);
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

/**
 * GET /api/cfdi/reconciliation?year=2026&month=4
 * Monthly CFDI reconciliation report: issued vs SAT acknowledgments.
 * year and month are required query parameters.
 */
async function reconciliationReport(req, res, next) {
  try {
    const year  = parseInt(req.query.year,  10);
    const month = parseInt(req.query.month, 10);

    if (!year || year < 2000 || year > 2100) {
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'year must be a valid 4-digit calendar year (2000–2100)' },
      });
    }
    if (!month || month < 1 || month > 12) {
      return res.status(422).json({
        error: { code: 'VALIDATION_ERROR', message: 'month must be a number between 1 and 12' },
      });
    }

    const data = await cfdiService.getReconciliationReport(req.orgId, year, month);
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  generateXml, stamp, cancel, cancellationStatus, listCancellations, downloadXml, downloadPdf,
  createPaymentComplement, getPaymentComplement, reconciliationReport,
};
