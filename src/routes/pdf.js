// =============================================================================
// FireISP 5.0 — PDF Export Routes
// =============================================================================
// Endpoints for generating and downloading PDF documents.
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const pdfService = require('../services/pdfService');

const router = Router();

router.use(authenticate, orgScope);

/**
 * GET /api/pdf/invoices/:id
 * Download an invoice as PDF.
 */
router.get('/invoices/:id', async (req, res, next) => {
  try {
    const buffer = await pdfService.generateInvoicePdf(parseInt(req.params.id, 10));
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="invoice-${req.params.id}.pdf"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/pdf/credit-notes/:id
 * Download a credit note as PDF.
 */
router.get('/credit-notes/:id', async (req, res, next) => {
  try {
    const buffer = await pdfService.generateCreditNotePdf(parseInt(req.params.id, 10));
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="credit-note-${req.params.id}.pdf"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/pdf/quotes/:id
 * Download a quote as PDF.
 */
router.get('/quotes/:id', async (req, res, next) => {
  try {
    const buffer = await pdfService.generateQuotePdf(parseInt(req.params.id, 10));
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="quote-${req.params.id}.pdf"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/pdf/cfdi/:id
 * Download a CFDI 4.0 representation as PDF.
 */
router.get('/cfdi/:id', async (req, res, next) => {
  try {
    const buffer = await pdfService.generateCfdiPdf(parseInt(req.params.id, 10));
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="cfdi-${req.params.id}.pdf"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
