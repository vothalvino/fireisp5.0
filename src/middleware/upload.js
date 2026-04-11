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
  if (ALLOWED_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'File type not allowed'));
  }
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

module.exports = { uploadSingle, uploadMultiple, STORAGE_ROOT, entityDir };
