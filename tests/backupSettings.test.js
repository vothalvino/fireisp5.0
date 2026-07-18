// =============================================================================
// FireISP 5.0 — Remote Backup Settings Tests
// =============================================================================
// Covers src/models/BackupSettings.js, src/services/backupSettingsService.js,
// and src/routes/backupSettings.js (GET/PUT /backup-settings, POST /test,
// GET /runs, POST /run-now).
//
// Security-critical properties under test:
//   - secret_key_encrypted is NEVER present in any HTTP response body
//   - PUT's three-state secret contract: omitted=keep, ''=clear, value=replace
//   - encrypt() is called with the plaintext secret — the raw value is never
//     persisted as-is
//   - effective-config precedence: enabled+complete settings row beats env
//     vars; disabled/absent row falls back to env vars; neither -> null
//   - enabling remote backup with an incomplete destination is a 422, never
//     a silently-broken 3 AM upload
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', role: 'admin' };
    req.userId = 1;
    next();
  },
}));

jest.mock('../src/middleware/rbac', () => ({
  userHasPermission: async () => true,
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

const mockEncrypt = jest.fn((v) => `enc:${v}`);
const mockDecrypt = jest.fn((v) => (typeof v === 'string' ? v.replace('enc:', '') : v));
jest.mock('../src/utils/encryption', () => ({
  encrypt: (v) => mockEncrypt(v),
  decrypt: (v) => mockDecrypt(v),
}));

// The service reaches cloud storage for POST /test; the run-now endpoint
// lazy-requires the backup script. Both are module-mocked so no real network
// or mysqldump is ever touched.
const mockUploadObject = jest.fn();
const mockDeleteObject = jest.fn();
const mockIsConfigured = jest.fn(() => false);
const mockResolveEnvConfig = jest.fn(() => null);
jest.mock('../src/services/cloudStorageService', () => ({
  uploadObject: (...a) => mockUploadObject(...a),
  deleteObject: (...a) => mockDeleteObject(...a),
  uploadBackup: jest.fn(),
  isConfigured: () => mockIsConfigured(),
  resolveEnvConfig: () => mockResolveEnvConfig(),
  normalizedPrefix: (config) => {
    const prefix = config.prefix ?? 'db-backups/';
    if (!prefix) return '';
    return prefix.endsWith('/') ? prefix : `${prefix}/`;
  },
}));

const mockBackup = jest.fn();
const mockIsRunning = jest.fn(() => false);
jest.mock('../src/scripts/backup', () => ({
  backup: (...a) => mockBackup(...a),
  isRunning: () => mockIsRunning(),
  rotate: jest.fn(),
  BACKUP_DIR: '/nonexistent-test-backup-dir',
}));

const request = require('supertest');
const db = require('../src/config/database');
const app = require('../src/app');
const backupSettingsService = require('../src/services/backupSettingsService');

// ---------------------------------------------------------------------------
// A tiny stateful fake for the backup_settings singleton + backup_runs list,
// so PUT -> GET round-trips actually persist across calls within a test
// (real model/service code runs against this, not a hand-mocked shape).
// ---------------------------------------------------------------------------
let settingsRow;
let runsRows;

function resetStore() {
  settingsRow = null;
  runsRows = [];
}

function installDbMock() {
  db.query.mockImplementation((sql, params = []) => {
    if (sql.includes('SELECT * FROM backup_settings')) {
      return Promise.resolve([settingsRow ? [settingsRow] : []]);
    }
    if (sql.includes('INSERT INTO backup_settings') && sql.includes('last_test_at')) {
      const [, status, error] = params;
      settingsRow = settingsRow || { id: 1, remote_enabled: 0, provider: 'custom', prefix: 'db-backups/' };
      settingsRow.last_test_at = '2026-01-02T00:00:00.000Z';
      settingsRow.last_test_status = status;
      settingsRow.last_test_error = error;
      return Promise.resolve([{ affectedRows: 1 }]);
    }
    if (sql.includes('INSERT INTO backup_settings')) {
      const [
        id, remote_enabled, provider, bucket, region, endpoint, prefix,
        access_key, secret_key_encrypted,
      ] = params;
      settingsRow = {
        id, remote_enabled, provider, bucket, region, endpoint, prefix,
        access_key, secret_key_encrypted,
        last_test_at: settingsRow?.last_test_at ?? null,
        last_test_status: settingsRow?.last_test_status ?? null,
        last_test_error: settingsRow?.last_test_error ?? null,
        created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      };
      return Promise.resolve([{ insertId: 1 }]);
    }
    if (sql.includes('FROM backup_runs')) {
      return Promise.resolve([runsRows]);
    }
    if (sql.includes('FROM scheduled_tasks')) {
      return Promise.resolve([[{
        cron_expression: '0 3 * * *', is_enabled: 1,
        last_run_at: '2026-07-16T03:00:00.000Z', last_status: 'success',
        next_run_at: '2026-07-17T03:00:00.000Z',
      }]]);
    }
    return Promise.resolve([[]]);
  });
}

const MINIO_SETTINGS = {
  remote_enabled: true,
  provider: 'minio',
  bucket: 'fireisp-backups',
  region: 'us-east-1',
  endpoint: 'http://192.168.1.50:9000',
  prefix: 'db-backups/',
  access_key: 'minio-key',
  secret_key: 'minio-secret',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockIsConfigured.mockReturnValue(false);
  mockResolveEnvConfig.mockReturnValue(null);
  mockIsRunning.mockReturnValue(false);
  mockBackup.mockResolvedValue({ filepath: '/x', cloudUrl: null, remoteStatus: 'disabled' });
  resetStore();
  installDbMock();
});

// =============================================================================
// GET /api/v1/backup-settings
// =============================================================================
describe('GET /api/v1/backup-settings', () => {
  it('returns safe defaults (secret_configured:false) when nothing is saved', async () => {
    const res = await request(app).get('/api/v1/backup-settings');
    expect(res.status).toBe(200);
    expect(res.body.data.settings).toMatchObject({
      remote_enabled: false,
      secret_configured: false,
      env_configured: false,
      effective_source: 'none',
    });
    expect(JSON.stringify(res.body)).not.toContain('secret_key_encrypted');
  });

  it('never includes the encrypted secret in the response, even once configured', async () => {
    await request(app).put('/api/v1/backup-settings').send(MINIO_SETTINGS);
    const res = await request(app).get('/api/v1/backup-settings');
    expect(res.status).toBe(200);
    expect(res.body.data.settings.secret_configured).toBe(true);
    expect(res.body.data.settings.effective_source).toBe('settings');
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('secret_key_encrypted');
    expect(body).not.toContain('minio-secret');
  });

  it('reports env vars as the effective source when settings are absent but env is configured', async () => {
    mockIsConfigured.mockReturnValue(true);
    mockResolveEnvConfig.mockReturnValue({ bucket: 'env-bucket', source: 'env' });
    const res = await request(app).get('/api/v1/backup-settings');
    expect(res.body.data.settings.env_configured).toBe(true);
    expect(res.body.data.settings.effective_source).toBe('env');
  });

  it('includes the nightly schedule row', async () => {
    const res = await request(app).get('/api/v1/backup-settings');
    expect(res.body.data.schedule).toMatchObject({ cron_expression: '0 3 * * *' });
  });
});

// =============================================================================
// PUT /api/v1/backup-settings — three-state secret + completeness validation
// =============================================================================
describe('PUT /api/v1/backup-settings', () => {
  it('encrypts the secret and never stores the plaintext', async () => {
    const res = await request(app).put('/api/v1/backup-settings').send(MINIO_SETTINGS);
    expect(res.status).toBe(200);
    expect(mockEncrypt).toHaveBeenCalledWith('minio-secret');
    expect(settingsRow.secret_key_encrypted).toBe('enc:minio-secret');
  });

  it('keeps the saved secret when the field is omitted', async () => {
    await request(app).put('/api/v1/backup-settings').send(MINIO_SETTINGS);
    const { secret_key: _omitted, ...withoutSecret } = MINIO_SETTINGS;
    const res = await request(app).put('/api/v1/backup-settings').send({ ...withoutSecret, bucket: 'renamed' });
    expect(res.status).toBe(200);
    expect(settingsRow.secret_key_encrypted).toBe('enc:minio-secret');
    expect(settingsRow.bucket).toBe('renamed');
  });

  it('clears the secret when an empty string is sent (and refuses to stay enabled)', async () => {
    await request(app).put('/api/v1/backup-settings').send(MINIO_SETTINGS);
    const res = await request(app).put('/api/v1/backup-settings').send({ ...MINIO_SETTINGS, secret_key: '' });
    // Clearing the secret while remote_enabled stays true = incomplete config.
    expect(res.status).toBe(422);
    // Disabled + cleared is fine.
    const res2 = await request(app).put('/api/v1/backup-settings')
      .send({ ...MINIO_SETTINGS, remote_enabled: false, secret_key: '' });
    expect(res2.status).toBe(200);
    expect(settingsRow.secret_key_encrypted).toBe(null);
  });

  it('rejects enabling with missing fields, naming them', async () => {
    const res = await request(app).put('/api/v1/backup-settings')
      .send({ remote_enabled: true, provider: 'minio', bucket: 'b' });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/missing/i);
    expect(res.body.error.message).toMatch(/secret key/);
    expect(res.body.error.message).toMatch(/endpoint/);
  });

  it('allows AWS without an endpoint (derived from region) but requires one for other providers', async () => {
    const aws = { ...MINIO_SETTINGS, provider: 'aws', endpoint: '' };
    const res = await request(app).put('/api/v1/backup-settings').send(aws);
    expect(res.status).toBe(200);

    const gcsNoEndpoint = { ...MINIO_SETTINGS, provider: 'gcs', endpoint: '' };
    const res2 = await request(app).put('/api/v1/backup-settings').send(gcsNoEndpoint);
    expect(res2.status).toBe(422);
  });

  it('rejects a non-http(s) endpoint', async () => {
    const res = await request(app).put('/api/v1/backup-settings')
      .send({ ...MINIO_SETTINGS, endpoint: 'ftp://not-s3.example.com' });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/http/i);
  });

  it('rejects an unknown provider via schema validation', async () => {
    const res = await request(app).put('/api/v1/backup-settings')
      .send({ ...MINIO_SETTINGS, provider: 'dropbox' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

// =============================================================================
// Effective remote config precedence (service level)
// =============================================================================
describe('backupSettingsService.getEffectiveRemoteConfig', () => {
  it('prefers an enabled + complete settings row and decrypts the secret', async () => {
    await request(app).put('/api/v1/backup-settings').send(MINIO_SETTINGS);
    const config = await backupSettingsService.getEffectiveRemoteConfig();
    expect(config).toMatchObject({
      bucket: 'fireisp-backups',
      accessKey: 'minio-key',
      secretKey: 'minio-secret', // decrypted for the uploader, never for HTTP
      endpoint: 'http://192.168.1.50:9000',
      source: 'settings',
    });
  });

  it('falls back to env vars when the settings row is disabled', async () => {
    await request(app).put('/api/v1/backup-settings').send({ ...MINIO_SETTINGS, remote_enabled: false });
    const envConfig = { bucket: 'env-bucket', region: 'us-east-1', accessKey: 'a', secretKey: 's', endpoint: null, prefix: 'db-backups/', source: 'env' };
    mockResolveEnvConfig.mockReturnValue(envConfig);
    const config = await backupSettingsService.getEffectiveRemoteConfig();
    expect(config).toBe(envConfig);
  });

  it('returns null when neither settings nor env vars are configured', async () => {
    const config = await backupSettingsService.getEffectiveRemoteConfig();
    expect(config).toBeNull();
  });

  it('does NOT silently fall back to env when an enabled row is incomplete (direct DB edit)', async () => {
    settingsRow = { id: 1, remote_enabled: 1, provider: 'minio', bucket: 'b', region: null, endpoint: null, prefix: 'db-backups/', access_key: null, secret_key_encrypted: null };
    mockResolveEnvConfig.mockReturnValue({ bucket: 'env-bucket', source: 'env' });
    const config = await backupSettingsService.getEffectiveRemoteConfig();
    expect(config).toBeNull();
  });
});

// =============================================================================
// POST /api/v1/backup-settings/test
// =============================================================================
describe('POST /api/v1/backup-settings/test', () => {
  it('uploads and deletes a probe object, recording success', async () => {
    await request(app).put('/api/v1/backup-settings').send(MINIO_SETTINGS);
    mockUploadObject.mockResolvedValue('http://192.168.1.50:9000/fireisp-backups/db-backups/probe.txt');
    mockDeleteObject.mockResolvedValue(undefined);

    const res = await request(app).post('/api/v1/backup-settings/test');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ success: true, source: 'settings' });
    expect(mockUploadObject).toHaveBeenCalledTimes(1);
    const [config, key] = mockUploadObject.mock.calls[0];
    expect(config.secretKey).toBe('minio-secret');
    expect(key).toMatch(/^db-backups\/fireisp-connection-test-/);
    expect(mockDeleteObject).toHaveBeenCalledWith(expect.anything(), key);
    expect(settingsRow.last_test_status).toBe('success');
  });

  it('returns success:false (HTTP 200) and records the error when the probe fails', async () => {
    await request(app).put('/api/v1/backup-settings').send(MINIO_SETTINGS);
    mockUploadObject.mockRejectedValue(new Error('Cloud upload failed: HTTP 403 — AccessDenied'));

    const res = await request(app).post('/api/v1/backup-settings/test');
    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(false);
    expect(res.body.data.error).toContain('403');
    expect(settingsRow.last_test_status).toBe('failed');
  });

  it('fails cleanly when nothing is configured', async () => {
    const res = await request(app).post('/api/v1/backup-settings/test');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ success: false, source: 'none' });
    expect(mockUploadObject).not.toHaveBeenCalled();
  });

  it('still succeeds when only the probe cleanup fails', async () => {
    await request(app).put('/api/v1/backup-settings').send(MINIO_SETTINGS);
    mockUploadObject.mockResolvedValue('url');
    mockDeleteObject.mockRejectedValue(new Error('delete denied'));

    const res = await request(app).post('/api/v1/backup-settings/test');
    expect(res.body.data.success).toBe(true);
  });
});

// =============================================================================
// GET /runs + POST /run-now
// =============================================================================
describe('backup runs endpoints', () => {
  it('GET /runs returns run history (and tolerates a missing local dir)', async () => {
    runsRows = [{
      id: 7, trigger_source: 'scheduled', status: 'success', filename: 'fireisp_x.sql.gz',
      size_bytes: 12345, remote_status: 'uploaded', remote_url: 'http://x/y', error_message: null,
      started_at: '2026-07-17T03:00:00.000Z', finished_at: '2026-07-17T03:00:20.000Z',
    }];
    const res = await request(app).get('/api/v1/backup-settings/runs');
    expect(res.status).toBe(200);
    expect(res.body.data.runs).toHaveLength(1);
    expect(res.body.data.runs[0]).toMatchObject({ status: 'success', remote_status: 'uploaded' });
    // BACKUP_DIR is mocked to a nonexistent path — must yield [], not a 500.
    expect(res.body.data.files).toEqual([]);
  });

  it('POST /run-now starts a manual backup and returns 202', async () => {
    const res = await request(app).post('/api/v1/backup-settings/run-now');
    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ started: true });
    expect(mockBackup).toHaveBeenCalledWith({ trigger: 'manual' });
  });

  it('POST /run-now returns 409 while a backup is in progress', async () => {
    mockIsRunning.mockReturnValue(true);
    const res = await request(app).post('/api/v1/backup-settings/run-now');
    expect(res.status).toBe(409);
    expect(mockBackup).not.toHaveBeenCalled();
  });
});
