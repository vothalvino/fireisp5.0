// =============================================================================
// FireISP 5.0 — File Upload Middleware
// =============================================================================
// Multer-based multipart upload with size and MIME type validation.
// Files are stored in the appropriate storage/ subdirectory based on entity type.
// =============================================================================

const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const STORAGE_ROOT = path.resolve(__dirname, '../../storage');

/**
 * Allowed MIME types grouped by category.
 */
const ALLOWED_MIME_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
  document: ['application/pdf', 'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  archive: ['application/zip', 'application/gzip', 'application/x-tar'],
  xml: ['application/xml', 'text/xml'],
};

const ALL_ALLOWED = Object.values(ALLOWED_MIME_TYPES).flat();

/**
 * Maps entity_type values from the files table to storage subdirectories.
 */
const ENTITY_DIRS = {
  device: 'devices',
  client: 'clients',
  ticket: 'tickets',
  organization: 'organizations',
  backup: 'backups',
};

/**
 * Create the storage directory for an entity type if it doesn't exist.
 */
function ensureDir(entityType) {
  const subdir = ENTITY_DIRS[entityType] || 'uploads';
  const dir = path.join(STORAGE_ROOT, subdir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Generate a unique filename preserving the original extension.
 */
function generateFilename(originalname) {
  const ext = path.extname(originalname);
  const hash = crypto.randomBytes(16).toString('hex');
  return `${Date.now()}-${hash}${ext}`;
}

/**
 * Multer disk storage engine that routes files to the correct subdirectory.
 */
const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    const entityType = _req.body.entity_type || _req.query.entity_type || 'client';
    try {
      const dir = ensureDir(entityType);
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename(_req, file, cb) {
    cb(null, generateFilename(file.originalname));
  },
});

/**
 * MIME type filter — rejects uploads with disallowed MIME types.
 */
function fileFilter(_req, file, cb) {
  if (ALL_ALLOWED.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Unsupported file type: ${file.mimetype}`));
  }
}

/**
 * Default upload handler — single file, 10 MB limit.
 */
const uploadSingle = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
}).single('file');

/**
 * Multi-file upload handler — up to 5 files, 10 MB each.
 */
const uploadMultiple = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 5,
  },
}).array('files', 5);

/**
 * Express error-handling wrapper for multer.
 */
function handleUploadErrors(uploadFn) {
  return (req, res, next) => {
    uploadFn(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({
          error: { code: 'UPLOAD_ERROR', message: err.message },
        });
      }
      if (err) {
        return res.status(500).json({
          error: { code: 'UPLOAD_ERROR', message: err.message },
        });
      }
      next();
    });
  };
}

module.exports = {
  uploadSingle: handleUploadErrors(uploadSingle),
  uploadMultiple: handleUploadErrors(uploadMultiple),
  ALLOWED_MIME_TYPES,
  ALL_ALLOWED,
  ENTITY_DIRS,
  STORAGE_ROOT,
  ensureDir,
  generateFilename,
};
