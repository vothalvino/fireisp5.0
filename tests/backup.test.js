// =============================================================================
// FireISP 5.0 — Backup Script Tests
// =============================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { rotate } = require('../src/scripts/backup');
const cloudStorage = require('../src/services/cloudStorageService');

const S3_ENV_KEYS = [
  'BACKUP_S3_BUCKET',
  'BACKUP_S3_REGION',
  'BACKUP_S3_ACCESS_KEY',
  'BACKUP_S3_SECRET_KEY',
  'BACKUP_S3_ENDPOINT',
  'BACKUP_S3_PREFIX',
];

describe('backup rotate', () => {
  const backupDir = path.resolve(__dirname, '../storage/backups');

  beforeEach(() => {
    // Ensure clean state — remove any test .sql.gz files
    if (fs.existsSync(backupDir)) {
      for (const f of fs.readdirSync(backupDir).filter(f => f.endsWith('.sql.gz'))) {
        fs.unlinkSync(path.join(backupDir, f));
      }
    }
  });

  afterEach(() => {
    // Clean up test files
    if (fs.existsSync(backupDir)) {
      for (const f of fs.readdirSync(backupDir).filter(f => f.endsWith('.sql.gz'))) {
        fs.unlinkSync(path.join(backupDir, f));
      }
    }
  });

  test('rotate removes oldest files when exceeding max', () => {
    // Create 10 fake backup files (MAX_BACKUPS defaults to 7)
    for (let i = 0; i < 10; i++) {
      const name = `fireisp_2025-01-${String(i + 1).padStart(2, '0')}T00-00-00.sql.gz`;
      fs.writeFileSync(path.join(backupDir, name), 'test');
    }

    // Verify 10 exist
    const before = fs.readdirSync(backupDir).filter(f => f.endsWith('.sql.gz'));
    expect(before.length).toBe(10);

    rotate();

    const after = fs.readdirSync(backupDir).filter(f => f.endsWith('.sql.gz'));
    expect(after.length).toBe(7);

    // Should keep the newest 7 (sorted alphabetically, last 7)
    expect(after[0]).toBe('fireisp_2025-01-04T00-00-00.sql.gz');
    expect(after[6]).toBe('fireisp_2025-01-10T00-00-00.sql.gz');
  });

  test('rotate does nothing when under limit', () => {
    // Create 3 files
    for (let i = 0; i < 3; i++) {
      const name = `fireisp_2025-02-${String(i + 1).padStart(2, '0')}T00-00-00.sql.gz`;
      fs.writeFileSync(path.join(backupDir, name), 'test');
    }

    rotate();

    const after = fs.readdirSync(backupDir).filter(f => f.endsWith('.sql.gz'));
    expect(after.length).toBe(3);
  });
});

describe('cloudStorageService', () => {
  const originalEnv = { ...process.env };

  /** Build a mock https request/response pair for S3 upload tests. */
  function mockHttpsRequest(statusCode, responseBody = '') {
    const mockReq = { write: jest.fn(), end: jest.fn(), on: jest.fn() };
    const mockRes = {
      statusCode,
      on: jest.fn((event, cb) => {
        if (event === 'data') cb(responseBody);
        if (event === 'end') cb();
      }),
    };
    const originalRequest = https.request;
    https.request = jest.fn((opts, cb) => { cb(mockRes); return mockReq; });
    return { originalRequest, mockReq };
  }

  afterEach(() => {
    // Restore env vars
    for (const key of S3_ENV_KEYS) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  test('isConfigured returns false when env vars are missing', () => {
    delete process.env.BACKUP_S3_BUCKET;
    delete process.env.BACKUP_S3_REGION;
    delete process.env.BACKUP_S3_ACCESS_KEY;
    delete process.env.BACKUP_S3_SECRET_KEY;
    expect(cloudStorage.isConfigured()).toBe(false);
  });

  test('isConfigured returns true when all required env vars are set', () => {
    process.env.BACKUP_S3_BUCKET = 'my-bucket';
    process.env.BACKUP_S3_REGION = 'us-east-1';
    process.env.BACKUP_S3_ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE';
    process.env.BACKUP_S3_SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    expect(cloudStorage.isConfigured()).toBe(true);
  });

  test('uploadBackup throws when cloud storage is not configured', async () => {
    delete process.env.BACKUP_S3_BUCKET;
    delete process.env.BACKUP_S3_REGION;
    delete process.env.BACKUP_S3_ACCESS_KEY;
    delete process.env.BACKUP_S3_SECRET_KEY;
    await expect(cloudStorage.uploadBackup('/tmp/test.sql.gz')).rejects.toThrow(
      'Cloud storage is not configured',
    );
  });

  test('uploadBackup uses default prefix db-backups/ when BACKUP_S3_PREFIX is not set', async () => {
    const { originalRequest } = mockHttpsRequest(200);
    const tmpFile = path.join(os.tmpdir(), 'test_backup.sql.gz');
    fs.writeFileSync(tmpFile, 'fake backup content');

    process.env.BACKUP_S3_BUCKET = 'my-bucket';
    process.env.BACKUP_S3_REGION = 'us-east-1';
    process.env.BACKUP_S3_ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE';
    process.env.BACKUP_S3_SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    delete process.env.BACKUP_S3_PREFIX;

    try {
      const url = await cloudStorage.uploadBackup(tmpFile, 'test_backup.sql.gz');
      expect(url).toContain('db-backups/test_backup.sql.gz');
      const callOpts = https.request.mock.calls[0][0];
      expect(callOpts.path).toContain('db-backups');
    } finally {
      https.request = originalRequest;
      fs.unlinkSync(tmpFile);
    }
  });

  test('uploadBackup uses custom BACKUP_S3_PREFIX when set', async () => {
    const { originalRequest } = mockHttpsRequest(200);
    const tmpFile = path.join(os.tmpdir(), 'test_backup2.sql.gz');
    fs.writeFileSync(tmpFile, 'fake backup content 2');

    process.env.BACKUP_S3_BUCKET = 'my-bucket';
    process.env.BACKUP_S3_REGION = 'us-east-1';
    process.env.BACKUP_S3_ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE';
    process.env.BACKUP_S3_SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    process.env.BACKUP_S3_PREFIX = 'prod/backups/';

    try {
      const url = await cloudStorage.uploadBackup(tmpFile, 'test_backup2.sql.gz');
      expect(url).toContain('prod/backups/test_backup2.sql.gz');
    } finally {
      https.request = originalRequest;
      fs.unlinkSync(tmpFile);
    }
  });

  test('uploadBackup uses custom endpoint for B2', async () => {
    const { originalRequest } = mockHttpsRequest(200);
    const tmpFile = path.join(os.tmpdir(), 'test_backup_b2.sql.gz');
    fs.writeFileSync(tmpFile, 'fake b2 backup');

    process.env.BACKUP_S3_BUCKET = 'my-b2-bucket';
    process.env.BACKUP_S3_REGION = 'us-west-002';
    process.env.BACKUP_S3_ACCESS_KEY = 'b2-key-id';
    process.env.BACKUP_S3_SECRET_KEY = 'b2-app-key';
    process.env.BACKUP_S3_ENDPOINT = 'https://s3.us-west-002.backblazeb2.com';

    try {
      const url = await cloudStorage.uploadBackup(tmpFile, 'test_backup_b2.sql.gz');
      expect(url).toContain('backblazeb2.com');
      const callOpts = https.request.mock.calls[0][0];
      expect(callOpts.hostname).toBe('s3.us-west-002.backblazeb2.com');
    } finally {
      https.request = originalRequest;
      fs.unlinkSync(tmpFile);
    }
  });

  test('uploadBackup rejects on non-2xx HTTP response', async () => {
    const { originalRequest } = mockHttpsRequest(403, 'AccessDenied');
    const tmpFile = path.join(os.tmpdir(), 'test_403.sql.gz');
    fs.writeFileSync(tmpFile, 'fake content');

    process.env.BACKUP_S3_BUCKET = 'my-bucket';
    process.env.BACKUP_S3_REGION = 'us-east-1';
    process.env.BACKUP_S3_ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE';
    process.env.BACKUP_S3_SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    delete process.env.BACKUP_S3_ENDPOINT;

    try {
      await expect(cloudStorage.uploadBackup(tmpFile, 'test_403.sql.gz')).rejects.toThrow(
        'Cloud upload failed: HTTP 403',
      );
    } finally {
      https.request = originalRequest;
      fs.unlinkSync(tmpFile);
    }
  });

  test('error messages surface the S3 <Code> token but never the raw response body', async () => {
    const xmlBody = '<?xml version="1.0"?><Error><Code>NoSuchBucket</Code><Message>internal-hostname-and-secrets-here</Message></Error>';
    const { originalRequest } = mockHttpsRequest(404, xmlBody);
    const tmpFile = path.join(os.tmpdir(), 'test_reflect.sql.gz');
    fs.writeFileSync(tmpFile, 'fake content');

    process.env.BACKUP_S3_BUCKET = 'my-bucket';
    process.env.BACKUP_S3_REGION = 'us-east-1';
    process.env.BACKUP_S3_ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE';
    process.env.BACKUP_S3_SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    delete process.env.BACKUP_S3_ENDPOINT;

    try {
      await cloudStorage.uploadBackup(tmpFile, 'test_reflect.sql.gz');
      throw new Error('expected rejection');
    } catch (err) {
      // The endpoint is admin-supplied: reflecting its response body would
      // turn the accepted blind-SSRF into a readable one. Code token only.
      expect(err.message).toBe('Cloud upload failed: HTTP 404 (NoSuchBucket)');
      expect(err.message).not.toContain('internal-hostname');
    } finally {
      https.request = originalRequest;
      fs.unlinkSync(tmpFile);
    }
  });

  test('object keys are AWS-UriEncoded per segment (space, !\'()* — slashes preserved)', async () => {
    const { originalRequest } = mockHttpsRequest(200);
    const tmpFile = path.join(os.tmpdir(), 'test_enc.sql.gz');
    fs.writeFileSync(tmpFile, 'fake content');

    process.env.BACKUP_S3_BUCKET = 'my-bucket';
    process.env.BACKUP_S3_REGION = 'us-east-1';
    process.env.BACKUP_S3_ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE';
    process.env.BACKUP_S3_SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    process.env.BACKUP_S3_PREFIX = 'weird prefix/';
    delete process.env.BACKUP_S3_ENDPOINT;

    try {
      await cloudStorage.uploadBackup(tmpFile, "odd !'()*name.sql.gz");
      const callOpts = https.request.mock.calls[0][0];
      expect(callOpts.path).toBe("/my-bucket/weird%20prefix/odd%20%21%27%28%29%2Aname.sql.gz");
    } finally {
      https.request = originalRequest;
      fs.unlinkSync(tmpFile);
    }
  });

  test('a prefix saved without a trailing slash still becomes a folder', async () => {
    const { originalRequest } = mockHttpsRequest(200);
    const tmpFile = path.join(os.tmpdir(), 'test_noslash.sql.gz');
    fs.writeFileSync(tmpFile, 'fake content');

    process.env.BACKUP_S3_BUCKET = 'my-bucket';
    process.env.BACKUP_S3_REGION = 'us-east-1';
    process.env.BACKUP_S3_ACCESS_KEY = 'AKIAIOSFODNN7EXAMPLE';
    process.env.BACKUP_S3_SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    process.env.BACKUP_S3_PREFIX = 'prod';
    delete process.env.BACKUP_S3_ENDPOINT;

    try {
      const url = await cloudStorage.uploadBackup(tmpFile, 'test_noslash.sql.gz');
      expect(url).toContain('prod/test_noslash.sql.gz');
      expect(url).not.toContain('prodtest_noslash');
    } finally {
      https.request = originalRequest;
      fs.unlinkSync(tmpFile);
    }
  });

  test('an endpoint with a base path (reverse-proxied MinIO) signs and sends the same path', async () => {
    const { originalRequest } = mockHttpsRequest(200);
    const tmpFile = path.join(os.tmpdir(), 'test_basepath.sql.gz');
    fs.writeFileSync(tmpFile, 'fake content');

    process.env.BACKUP_S3_BUCKET = 'my-bucket';
    process.env.BACKUP_S3_REGION = 'us-east-1';
    process.env.BACKUP_S3_ACCESS_KEY = 'k';
    process.env.BACKUP_S3_SECRET_KEY = 's';
    process.env.BACKUP_S3_ENDPOINT = 'https://proxy.example.com/minio/';
    delete process.env.BACKUP_S3_PREFIX;

    try {
      const url = await cloudStorage.uploadBackup(tmpFile, 'test_basepath.sql.gz');
      const callOpts = https.request.mock.calls[0][0];
      expect(callOpts.path).toBe('/minio/my-bucket/db-backups/test_basepath.sql.gz');
      expect(callOpts.hostname).toBe('proxy.example.com');
      expect(url).toBe('https://proxy.example.com/minio/my-bucket/db-backups/test_basepath.sql.gz');
    } finally {
      https.request = originalRequest;
      fs.unlinkSync(tmpFile);
    }
  });
});
