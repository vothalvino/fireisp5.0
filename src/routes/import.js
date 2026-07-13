// =============================================================================
// FireISP 5.0 — Import Routes (Bulk CSV)
// =============================================================================

const { Router } = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { uploadLimiter } = require('../middleware/rateLimit');
const { validate } = require('../middleware/validate');
const importSchemas = require('../middleware/schemas/import');
const importController = require('../controllers/importController');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// Memory storage for import files — files are parsed in-memory, not persisted.
const IMPORT_MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_IMPORT_MIMES = new Set([
  'text/csv',
  'text/plain',
  'application/octet-stream',
]);

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMPORT_MAX_SIZE },
  fileFilter(_req, file, cb) {
    const ext = require('path').extname(file.originalname).toLowerCase();
    if (ext !== '.csv' || !ALLOWED_IMPORT_MIMES.has(file.mimetype)) {
      return cb(new Error('Only .csv files are accepted'));
    }
    cb(null, true);
  },
}).single('file');

/**
 * Wrap multer upload for import routes, converting MulterError to 422.
 */
function uploadImportFile(req, res, next) {
  importUpload(req, res, (err) => {
    if (err) {
      return res.status(422).json({ error: { code: 'UPLOAD_ERROR', message: err.message } });
    }
    next();
  });
}

// ---------------------------------------------------------------------------
// JSON body routes (CSV string in request body — backward compatible)
// ---------------------------------------------------------------------------
router.post('/clients', requirePermission('clients.create'), validate(importSchemas.importCsv), importController.importClients);
router.post('/devices', requirePermission('devices.create'), validate(importSchemas.importCsv), importController.importDevices);
router.post('/contracts', requirePermission('contracts.create'), validate(importSchemas.importCsv), importController.importContracts);
router.post('/invoices', requirePermission('invoices.create'), validate(importSchemas.importCsv), importController.importInvoices);
router.post('/payments', requirePermission('payments.create'), validate(importSchemas.importCsv), importController.importPayments);

// ---------------------------------------------------------------------------
// File upload routes (multipart/form-data, field "file", .csv only)
// ---------------------------------------------------------------------------
// uploadLimiter mounted first (before requirePermission), matching bulk.js's
// bulkEmailLimiter convention — reject cheaply before the potentially
// expensive file parse, and before any permission-check DB work.
router.post('/clients/upload', uploadLimiter, requirePermission('clients.create'), uploadImportFile, importController.importClientsFile);
router.post('/devices/upload', uploadLimiter, requirePermission('devices.create'), uploadImportFile, importController.importDevicesFile);
router.post('/contracts/upload', uploadLimiter, requirePermission('contracts.create'), uploadImportFile, importController.importContractsFile);
router.post('/invoices/upload', uploadLimiter, requirePermission('invoices.create'), uploadImportFile, importController.importInvoicesFile);
router.post('/payments/upload', uploadLimiter, requirePermission('payments.create'), uploadImportFile, importController.importPaymentsFile);

module.exports = router;
