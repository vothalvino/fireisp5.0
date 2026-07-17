// =============================================================================
// FireISP 5.0 — Cloud Storage Service (S3-compatible)
// =============================================================================
// Uploads files to any S3-compatible object store using AWS Signature
// Version 4 and Node.js built-in modules only: AWS S3, Google Cloud Storage
// (XML interoperability API + HMAC keys), Backblaze B2, Cloudflare R2, or a
// self-hosted MinIO server.
//
// The remote target is resolved by the caller (see
// backupSettingsService.getEffectiveRemoteConfig(): UI-saved settings first,
// BACKUP_S3_* env vars as fallback) and passed in as a config object. When no
// config is passed, the env vars are read directly — the pre-migration-404
// behavior, kept for compatibility:
//   BACKUP_S3_BUCKET      — Target bucket name
//   BACKUP_S3_REGION      — AWS region (e.g. us-east-1) or B2 region (e.g. us-west-002)
//   BACKUP_S3_ACCESS_KEY  — Access key ID (AWS) / Application Key ID (B2) / HMAC key (GCS)
//   BACKUP_S3_SECRET_KEY  — Secret access key / Application Key / HMAC secret
//   BACKUP_S3_ENDPOINT    — Optional: override endpoint for B2/R2/GCS/MinIO
//                           (e.g. https://s3.us-west-002.backblazeb2.com)
//   BACKUP_S3_PREFIX      — Optional: key prefix / folder (default: "db-backups/")
// =============================================================================

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const logger = require('../utils/logger').child({ service: 'cloudStorage' });

// ---------------------------------------------------------------------------
// AWS Signature Version 4 helpers
// ---------------------------------------------------------------------------

function hmac(key, data, encoding) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest(encoding);
}

function hash(data, encoding) {
  return crypto.createHash('sha256').update(data).digest(encoding);
}

/**
 * Derive the SigV4 signing key.
 */
function getSigningKey(secretKey, dateStamp, region, service) {
  const kDate = hmac('AWS4' + secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  return kSigning;
}

/**
 * Build the SigV4 Authorization header for an S3 request.
 *
 * @param {object} opts
 * @param {string} opts.method       — HTTP method (PUT / DELETE / HEAD)
 * @param {string} opts.path         — URL path (e.g. "/bucket/backups/file.sql.gz")
 * @param {string} opts.region       — AWS region
 * @param {string} opts.accessKey    — Access key ID
 * @param {string} opts.secretKey    — Secret access key
 * @param {string} opts.payloadHash  — SHA-256 hex of the request body
 * @param {string} opts.dateISO      — ISO-8601 date/time (yyyymmddTHHMMSSZ)
 * @param {string} opts.dateStamp    — Date stamp (yyyymmdd)
 * @param {object} opts.headers      — Headers to sign, EXACT values as sent
 *                                     (lowercase names; must include host)
 * @returns {string} the Authorization header value
 */
function buildAuthorizationHeader(opts) {
  const { method, path: urlPath, region, accessKey, secretKey, payloadHash, dateISO, dateStamp, headers } = opts;

  const service = 's3';
  const names = Object.keys(headers).map(h => h.toLowerCase()).sort();
  const canonicalHeaders = names.map(n => `${n}:${String(headers[n]).trim()}\n`).join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    method,
    urlPath,
    '', // query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    dateISO,
    credentialScope,
    hash(canonicalRequest, 'hex'),
  ].join('\n');

  const signingKey = getSigningKey(secretKey, dateStamp, region, service);
  const signature = hmac(signingKey, stringToSign, 'hex');

  return [
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(', ');
}

// ---------------------------------------------------------------------------
// Config + endpoint resolution
// ---------------------------------------------------------------------------

/**
 * Returns true when all required cloud storage env vars are present.
 */
function isConfigured() {
  return Boolean(
    process.env.BACKUP_S3_BUCKET &&
    process.env.BACKUP_S3_REGION &&
    process.env.BACKUP_S3_ACCESS_KEY &&
    process.env.BACKUP_S3_SECRET_KEY,
  );
}

/**
 * Read the BACKUP_S3_* env vars into a config object, or null when unset.
 */
function resolveEnvConfig() {
  if (!isConfigured()) return null;
  return {
    bucket: process.env.BACKUP_S3_BUCKET,
    region: process.env.BACKUP_S3_REGION,
    accessKey: process.env.BACKUP_S3_ACCESS_KEY,
    secretKey: process.env.BACKUP_S3_SECRET_KEY,
    endpoint: process.env.BACKUP_S3_ENDPOINT || null,
    prefix: process.env.BACKUP_S3_PREFIX !== undefined ? process.env.BACKUP_S3_PREFIX : 'db-backups/',
    source: 'env',
  };
}

/**
 * Resolve host + base URL for a config. Path-style addressing throughout —
 * required by MinIO without wildcard DNS, accepted by every other provider.
 */
function resolveTarget(config) {
  if (config.endpoint) {
    const u = new URL(config.endpoint);
    return { host: u.host, endpointBase: config.endpoint.replace(/\/$/, '') };
  }
  const host = `s3.${config.region}.amazonaws.com`;
  return { host, endpointBase: `https://${host}` };
}

function objectPath(config, objectKey) {
  // Restore literal slashes so S3 treats the key as a path (prefix/filename)
  // rather than a single URL-encoded segment.
  return `/${config.bucket}/${encodeURIComponent(objectKey).replace(/%2F/g, '/')}`;
}

// ---------------------------------------------------------------------------
// Signed requests
// ---------------------------------------------------------------------------

/**
 * Perform a signed S3 request with an optional buffer body.
 * Resolves {statusCode, body}; rejects only on transport errors.
 */
function signedRequest(config, method, objectKey, body, contentType) {
  const { host, endpointBase } = resolveTarget(config);
  const urlPath = objectPath(config, objectKey);
  const payloadHash = hash(body || '', 'hex');

  const now = new Date();
  const dateISO = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const dateStamp = dateISO.slice(0, 8);

  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': dateISO,
  };
  if (body) {
    headers['content-length'] = body.length;
    headers['content-type'] = contentType || 'application/octet-stream';
  }

  const authorization = buildAuthorizationHeader({
    method,
    path: urlPath,
    region: config.region,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    payloadHash,
    dateISO,
    dateStamp,
    headers,
  });

  const parsedUrl = new URL(`${endpointBase}${urlPath}`);
  const requestOptions = {
    method,
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
    path: parsedUrl.pathname + (parsedUrl.search || ''),
    headers: { ...headers, Authorization: authorization },
  };

  return new Promise((resolve, reject) => {
    const transport = parsedUrl.protocol === 'https:' ? https : http;
    const req = transport.request(requestOptions, (res) => {
      let responseBody = '';
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: responseBody }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Upload a buffer to the bucket. Throws on any non-2xx response.
 * @returns {Promise<string>} — the object URL.
 */
async function uploadObject(config, objectKey, body, contentType) {
  const { endpointBase } = resolveTarget(config);
  const res = await signedRequest(config, 'PUT', objectKey, body, contentType);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`Cloud upload failed: HTTP ${res.statusCode} — ${res.body.slice(0, 500)}`);
  }
  return `${endpointBase}/${config.bucket}/${objectKey}`;
}

/**
 * Delete an object. 404 is treated as success (already gone).
 */
async function deleteObject(config, objectKey) {
  const res = await signedRequest(config, 'DELETE', objectKey, null, null);
  if (res.statusCode !== 404 && (res.statusCode < 200 || res.statusCode >= 300)) {
    throw new Error(`Cloud delete failed: HTTP ${res.statusCode} — ${res.body.slice(0, 500)}`);
  }
}

/**
 * Upload a local backup file to the configured bucket.
 *
 * @param {string} localPath  — Absolute path to the file to upload.
 * @param {string} [filename] — Destination filename inside the bucket prefix.
 *                             Defaults to the basename of localPath.
 * @param {object} [config]   — Remote config (from
 *                             backupSettingsService.getEffectiveRemoteConfig()).
 *                             Defaults to the BACKUP_S3_* env vars.
 * @returns {Promise<string>} — The URL of the uploaded object.
 */
async function uploadBackup(localPath, filename, config) {
  const effective = config || resolveEnvConfig();
  if (!effective) {
    throw new Error(
      'Cloud storage is not configured. Save remote backup settings in the UI or set ' +
      'BACKUP_S3_BUCKET, BACKUP_S3_REGION, BACKUP_S3_ACCESS_KEY, and BACKUP_S3_SECRET_KEY.',
    );
  }

  const destFilename = filename || path.basename(localPath);
  const objectKey = `${effective.prefix ?? 'db-backups/'}${destFilename}`;
  const fileBuffer = fs.readFileSync(localPath);

  logger.info(
    { bucket: effective.bucket, objectKey, source: effective.source, sizeKB: (fileBuffer.length / 1024).toFixed(1) },
    'Uploading backup to cloud',
  );
  const url = await uploadObject(effective, objectKey, fileBuffer, 'application/gzip');
  logger.info({ bucket: effective.bucket, objectKey }, 'Backup uploaded to cloud');
  return url;
}

module.exports = { uploadBackup, uploadObject, deleteObject, isConfigured, resolveEnvConfig };
