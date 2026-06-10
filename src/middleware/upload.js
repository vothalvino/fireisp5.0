// =============================================================================
// FireISP 5.0 — File Upload Middleware (Multer)
// =============================================================================
// Configures multer for disk storage with entity-based subdirectories.
// =============================================================================

const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const STORAGE_ROOT = path.resolve(__dirname, '../../storage');

// Allowed MIME types
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/xml',
  'text/xml',
  'text/plain',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/zip',
  'application/x-tar',
  'application/gzip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',  // CSD .cer / .key files
]);

// Allowed file extensions (lowercase, with leading dot).
// application/octet-stream is only accepted when the extension is whitelisted.
const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.xml', '.txt', '.csv',
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.zip', '.tar', '.gz', '.tgz',
  '.xlsx', '.xls',
  '.cer', '.key', '.pem',     // CSD certificate files
]);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

/**
 * Map entity_type to storage subdirectory.
 */
function entityDir(entityType) {
  const map = {
    device: 'devices',
    client: 'clients',
    ticket: 'tickets',
    organization: 'organizations',
    backup: 'backups',
  };
  return map[entityType] || 'uploads';
}

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const dir = path.join(STORAGE_ROOT, entityDir(req.body.entity_type || 'uploads'));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(_req, file, cb) {
    const unique = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${unique}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();

  if (!ALLOWED_TYPES.has(file.mimetype)) {
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'File type not allowed'));
  }

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'File extension not allowed'));
  }

  cb(null, true);
}

/**
 * Single-file upload middleware.  Field name: "file".
 */
const uploadSingle = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
}).single('file');

/**
 * Multi-file upload (up to 10).  Field name: "files".
 */
const uploadMultiple = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
}).array('files', 10);

/**
 * Single-file upload that always stores under storage/clients (used for client
 * ID document / photo uploads where the entity type is implicit). Field: "file".
 */
const uploadClientDocument = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      const dir = path.join(STORAGE_ROOT, 'clients');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req, file, cb) {
      const unique = crypto.randomBytes(16).toString('hex');
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${unique}${ext}`);
    },
  }),
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
}).single('file');

module.exports = { uploadSingle, uploadMultiple, uploadClientDocument, STORAGE_ROOT, entityDir, ALLOWED_EXTENSIONS };
