// =============================================================================
// FireISP 5.0 — Import Routes (Bulk CSV / Excel)
// =============================================================================

const { Router } = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
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
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
]);

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMPORT_MAX_SIZE },
  fileFilter(_req, file, cb) {
    const ext = require('path').extname(file.originalname).toLowerCase();
    const allowedExts = new Set(['.csv', '.xlsx', '.xls']);
    if (!allowedExts.has(ext) && !ALLOWED_IMPORT_MIMES.has(file.mimetype)) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Only .csv, .xlsx, and .xls files are accepted'));
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

// ---------------------------------------------------------------------------
// File upload routes (multipart/form-data, field "file", .csv or .xlsx)
// ---------------------------------------------------------------------------
router.post('/clients/upload', requirePermission('clients.create'), uploadImportFile, importController.importClientsFile);
router.post('/devices/upload', requirePermission('devices.create'), uploadImportFile, importController.importDevicesFile);
router.post('/contracts/upload', requirePermission('contracts.create'), uploadImportFile, importController.importContractsFile);

module.exports = router;
