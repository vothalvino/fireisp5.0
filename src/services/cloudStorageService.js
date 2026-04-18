// =============================================================================
// FireISP 5.0 — Cloud Storage Service (S3-compatible)
// =============================================================================
// Uploads files to AWS S3 or Backblaze B2 (S3-compatible API) using
// AWS Signature Version 4 and Node.js built-in modules only.
//
// Required env vars (when cloud upload is enabled):
//   BACKUP_S3_BUCKET      — Target bucket name
//   BACKUP_S3_REGION      — AWS region (e.g. us-east-1) or B2 region (e.g. us-west-002)
//   BACKUP_S3_ACCESS_KEY  — Access key ID (AWS) or Application Key ID (B2)
//   BACKUP_S3_SECRET_KEY  — Secret access key (AWS) or Application Key (B2)
//   BACKUP_S3_ENDPOINT    — Optional: override endpoint for B2 or S3-compatible
//                           providers (e.g. https://s3.us-west-002.backblazeb2.com)
//   BACKUP_S3_PREFIX      — Optional: key prefix / folder (default: "db-backups/")
// =============================================================================

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const fs = require('fs');
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
 * Build canonical request + string-to-sign + Authorization header for S3 PUT.
 *
 * @param {object} opts
 * @param {string} opts.method        — HTTP method (PUT)
 * @param {string} opts.host          — Host header value
 * @param {string} opts.path          — URL path (e.g. "/backups/file.sql.gz")
 * @param {string} opts.region        — AWS region
 * @param {string} opts.accessKey     — Access key ID
 * @param {string} opts.secretKey     — Secret access key
 * @param {string} opts.payloadHash   — SHA-256 hex of the request body
 * @param {string} opts.dateISO       — ISO-8601 date/time (yyyymmddTHHMMSSZ)
 * @param {string} opts.dateStamp     — Date stamp (yyyymmdd)
 * @param {string} opts.contentType   — Content-Type header
 * @param {number} opts.contentLength — Content-Length in bytes
 * @returns {{ Authorization: string, 'x-amz-content-sha256': string, 'x-amz-date': string }}
 */
function buildAuthorizationHeader(opts) {
  const {
    method, host, path, region, accessKey, secretKey,
    payloadHash, dateISO, dateStamp, contentType, contentLength,
  } = opts;

  const service = 's3';

  // Canonical headers (must be sorted by lowercase header name)
  const canonicalHeaders = [
    `content-length:${contentLength}`,
    `content-type:${contentType}`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${dateISO}`,
  ].join('\n') + '\n';

  const signedHeaders = 'content-length;content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    method,
    path,
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

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(', ');

  return {
    Authorization: authorization,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': dateISO,
  };
}

// ---------------------------------------------------------------------------
// Public API
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
 * Upload a local file to the configured S3-compatible bucket.
 *
 * @param {string} localPath  — Absolute path to the file to upload.
 * @param {string} [filename] — Destination filename inside the bucket prefix.
 *                             Defaults to the basename of localPath.
 * @returns {Promise<string>} — The S3 URL of the uploaded object.
 */
async function uploadBackup(localPath, filename) {
  if (!isConfigured()) {
    throw new Error(
      'Cloud storage is not configured. Set BACKUP_S3_BUCKET, BACKUP_S3_REGION, ' +
      'BACKUP_S3_ACCESS_KEY, and BACKUP_S3_SECRET_KEY.',
    );
  }

  const bucket = process.env.BACKUP_S3_BUCKET;
  const region = process.env.BACKUP_S3_REGION;
  const accessKey = process.env.BACKUP_S3_ACCESS_KEY;
  const secretKey = process.env.BACKUP_S3_SECRET_KEY;
  const prefix = process.env.BACKUP_S3_PREFIX !== undefined
    ? process.env.BACKUP_S3_PREFIX
    : 'db-backups/';

  const destFilename = filename || require('path').basename(localPath);
  const objectKey = `${prefix}${destFilename}`;

  // Resolve the S3 endpoint
  let host;
  let endpointBase;
  if (process.env.BACKUP_S3_ENDPOINT) {
    const u = new URL(process.env.BACKUP_S3_ENDPOINT);
    host = u.host;
    endpointBase = process.env.BACKUP_S3_ENDPOINT.replace(/\/$/, '');
  } else {
    // Default AWS S3 path-style: https://s3.{region}.amazonaws.com/{bucket}
    host = `s3.${region}.amazonaws.com`;
    endpointBase = `https://${host}`;
  }

  const urlPath = `/${bucket}/${encodeURIComponent(objectKey).replace(/%2F/g, '/')}`;
  // Restore literal slashes so S3 treats the key as a path (prefix/filename)
  // rather than a single URL-encoded segment.

  // Read file and compute SHA-256
  const fileBuffer = fs.readFileSync(localPath);
  const payloadHash = hash(fileBuffer, 'hex');
  const contentLength = fileBuffer.length;
  const contentType = 'application/gzip';

  // Timestamps for signature
  const now = new Date();
  const dateISO = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const dateStamp = dateISO.slice(0, 8);

  const authHeaders = buildAuthorizationHeader({
    method: 'PUT',
    host,
    path: urlPath,
    region,
    accessKey,
    secretKey,
    payloadHash,
    dateISO,
    dateStamp,
    contentType,
    contentLength,
  });

  const fullUrl = `${endpointBase}${urlPath}`;
  const parsedUrl = new URL(fullUrl);

  const requestOptions = {
    method: 'PUT',
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
    path: parsedUrl.pathname + (parsedUrl.search || ''),
    headers: {
      'Content-Type': contentType,
      'Content-Length': contentLength,
      Host: host,
      ...authHeaders,
    },
  };

  logger.info({ bucket, objectKey, sizeKB: (contentLength / 1024).toFixed(1) }, 'Uploading backup to cloud');

  return new Promise((resolve, reject) => {
    const transport = parsedUrl.protocol === 'https:' ? https : http;
    const req = transport.request(requestOptions, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const s3Url = `${endpointBase}/${bucket}/${objectKey}`;
          logger.info({ bucket, objectKey, statusCode: res.statusCode }, 'Backup uploaded to cloud');
          resolve(s3Url);
        } else {
          reject(new Error(`Cloud upload failed: HTTP ${res.statusCode} — ${body}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(fileBuffer);
    req.end();
  });
}

module.exports = { uploadBackup, isConfigured };
