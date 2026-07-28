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

// ---------------------------------------------------------------------------
// Ticket / work-order attachments
// ---------------------------------------------------------------------------
// A DELIBERATELY DIFFERENT allowlist from ALLOWED_EXTENSIONS above. That set
// exists for CSD certificates and generic document uploads; reusing it here
// would start rejecting the uploads field staff actually make every day — it
// has no .heic (every modern iPhone photo), no .docx, no video at all.
//
// What this covers: the evidence a technician or support agent attaches to a
// job — install photos, a short clip of a fault, a signed work order, a
// spreadsheet of readings.
//
// ARCHIVES AND SCRIPTS ARE DELIBERATELY EXCLUDED. An attachment is handed back
// to another user of the same org on download, and an archive is the classic
// carrier for something that should never have been stored. If an operator
// genuinely needs .zip on tickets, this one Set is the knob — but it should be
// a decision someone makes, not a default nobody chose.
const ATTACHMENT_EXTENSIONS = new Set([
  // Photos — heic/heif matter: iPhones shoot heic by default.
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif',
  // Documents
  '.pdf', '.txt', '.csv', '.doc', '.docx', '.xls', '.xlsx',
  // Short video evidence of a fault
  '.mp4', '.mov',
]);

// The Content-Type a download is served with, derived from the EXTENSION.
// req.file.mimetype comes from the client's multipart headers — it is caller
// input, and it was being stored verbatim and echoed straight back as the
// download's Content-Type. Deriving it here means the served type can only ever
// be one of these, whatever the uploader claimed.
const ATTACHMENT_MIME_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp',
  '.heic': 'image/heic', '.heif': 'image/heif',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime',
};

/**
 * Build a rejection whose message actually reaches the caller.
 *
 * `new multer.MulterError(code, field)` takes a FIELD NAME as its second
 * argument and derives `.message` from the code alone — so every rejection in
 * this file has been surfacing multer's canned "Unexpected field" and throwing
 * away the explanation, in the existing fileFilter as well as here. The routes
 * respond with `err.message`, so an operator uploading a .exe was told
 * "Unexpected field". Keep the MulterError type (callers may test for it) and
 * set a message worth reading.
 */
function uploadRejection(message) {
  const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE');
  err.message = message;
  return err;
}

/** multer fileFilter for ticket / work-order attachments. */
function attachmentFileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ATTACHMENT_EXTENSIONS.has(ext)) {
    return cb(uploadRejection(
      `File type "${ext || 'unknown'}" is not allowed. Accepted: ${[...ATTACHMENT_EXTENSIONS].join(', ')}`,
    ));
  }
  cb(null, true);
}

/** The mime type to STORE for an upload — from the extension, never the client. */
function attachmentMimeType(originalname) {
  const ext = path.extname(originalname || '').toLowerCase();
  return ATTACHMENT_MIME_BY_EXT[ext] || 'application/octet-stream';
}

/**
 * Build a safe `Content-Disposition: attachment` header value.
 *
 * original_filename is caller-controlled and was being interpolated raw into
 * `attachment; filename="..."`. A name containing a double quote closes the
 * quoted-string early and lets the rest be read as further header parameters.
 * Node itself rejects CR/LF in a header value, so this is parameter injection
 * rather than response splitting — but it is still caller input steering a
 * header. Quotes and backslashes are stripped for the legacy `filename`, and
 * RFC 5987 `filename*` carries the real name (including non-ASCII, which the
 * bare form cannot represent at all).
 */
function contentDispositionAttachment(originalname) {
  const name = String(originalname || 'download');
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

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
    return cb(uploadRejection(`File type "${file.mimetype}" is not allowed.`));
  }

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(uploadRejection(
      `File extension "${ext || 'unknown'}" is not allowed. Accepted: ${[...ALLOWED_EXTENSIONS].join(', ')}`,
    ));
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

/**
 * Disk storage for a FIXED sub-directory of STORAGE_ROOT, for routes that own
 * one attachment type (ticket attachments, work-order photos).
 *
 * The directory is created at UPLOAD time, never at module load. A top-level
 * `mkdirSync` runs during `require()`, so on a read-only root filesystem — which
 * is exactly what k8s/deployment.yaml sets with `readOnlyRootFilesystem: true` —
 * it throws EROFS while app.js is still wiring routes and takes the whole
 * process down. That turns "attachments are broken" into "the app will not
 * boot", which is a much worse failure for a much smaller cause.
 */
function attachmentStorage(subdir) {
  return multer.diskStorage({
    destination(_req, _file, cb) {
      const dir = path.join(STORAGE_ROOT, subdir);
      try {
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (err) {
        cb(err);          // surfaces as a 422 on the upload, not a dead server
      }
    },
    filename(_req, file, cb) {
      const unique = crypto.randomBytes(16).toString('hex');
      cb(null, `${Date.now()}-${unique}${path.extname(file.originalname).toLowerCase()}`);
    },
  });
}

/**
 * Resolve a stored attachment path to an absolute path on disk.
 *
 * Two shapes exist in the database and both must keep working:
 *   * relative to STORAGE_ROOT — what everything writes now, and what survives
 *     the install root moving (/app in Docker, /opt/fireisp from install.sh);
 *   * absolute — written by ticket and work-order attachments before they were
 *     moved into STORAGE_ROOT. Those rows are read as-is so existing
 *     attachments stay downloadable.
 *
 * Returns null for a relative path that escapes STORAGE_ROOT, so a malformed or
 * tampered row can never be turned into a read of an arbitrary file.
 */
function resolveStoredPath(stored) {
  if (!stored || typeof stored !== 'string') return null;
  if (path.isAbsolute(stored)) return stored;
  const abs = path.resolve(STORAGE_ROOT, stored);
  if (abs !== STORAGE_ROOT && !abs.startsWith(STORAGE_ROOT + path.sep)) return null;
  return abs;
}

module.exports = {
  uploadSingle, uploadMultiple, uploadClientDocument,
  STORAGE_ROOT, entityDir, ALLOWED_EXTENSIONS,
  attachmentStorage, resolveStoredPath,
  ATTACHMENT_EXTENSIONS, attachmentFileFilter, attachmentMimeType,
  contentDispositionAttachment,
};
