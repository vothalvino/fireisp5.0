// =============================================================================
// FireISP 5.0 — Backup Download Endpoint Tests
// =============================================================================
// GET /backup-settings/download/:filename serves a file that IS the entire
// database, so this suite is mostly adversarial: path traversal in every
// encoding, non-dump filenames, and missing files must all be refused, and
// every successful download must write an audit_logs row BEFORE streaming.
// Separate from tests/backupSettings.test.js because this file's module mock
// points BACKUP_DIR at a REAL temp directory (that one uses a nonexistent
// path to test the empty-list case).
// =============================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_BACKUP_DIR = path.join(os.tmpdir(), 'fireisp-download-test-backups');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 7, email: 'admin@test.com', role: 'admin' };
    req.userId = 7;
    next();
  },
}));

jest.mock('../src/middleware/rbac', () => ({
  userHasPermission: async () => true,
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../src/scripts/backup', () => ({
  backup: jest.fn(),
  isRunning: () => false,
  rotate: jest.fn(),
  BACKUP_DIR: require('path').join(require('os').tmpdir(), 'fireisp-download-test-backups'),
}));

const request = require('supertest');
const db = require('../src/config/database');
const app = require('../src/app');

const FILE_CONTENT = Buffer.from('fake gzip backup content for download test');
const OUTSIDE_SECRET = path.join(os.tmpdir(), 'fireisp-download-test-outside-secret.txt');

beforeAll(() => {
  fs.mkdirSync(TEST_BACKUP_DIR, { recursive: true });
  fs.writeFileSync(path.join(TEST_BACKUP_DIR, 'fireisp_2026-07-17T03-00-00.sql.gz'), FILE_CONTENT);
  // A sibling file OUTSIDE the allowlisted extension — must never be servable.
  fs.writeFileSync(path.join(TEST_BACKUP_DIR, 'secrets.env'), 'DB_PASSWORD=hunter2');
  // A directory whose name matches the pattern — isFile() must refuse it.
  fs.mkdirSync(path.join(TEST_BACKUP_DIR, 'dir.sql.gz'), { recursive: true });
  // A SYMLINK with a dump-shaped name pointing OUTSIDE BACKUP_DIR — the
  // string containment check passes it, so only an lstat/symlink check stops
  // it being followed and its target streamed to the caller.
  fs.writeFileSync(OUTSIDE_SECRET, 'OUTSIDE-SECRET-DO-NOT-LEAK');
  try {
    fs.symlinkSync(OUTSIDE_SECRET, path.join(TEST_BACKUP_DIR, 'leak.sql.gz'));
  } catch { /* platforms without symlink perms skip the symlink case */ }
});

afterAll(() => {
  fs.rmSync(TEST_BACKUP_DIR, { recursive: true, force: true });
  fs.rmSync(OUTSIDE_SECRET, { force: true });
});

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue([[]]);
});

describe('GET /api/v1/backup-settings/download/:filename', () => {
  it('serves an existing backup file as an attachment and audit-logs it first', async () => {
    const res = await request(app)
      .get('/api/v1/backup-settings/download/fireisp_2026-07-17T03-00-00.sql.gz')
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', c => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('fireisp_2026-07-17T03-00-00.sql.gz');
    expect(Buffer.compare(res.body, FILE_CONTENT)).toBe(0);

    const auditInsert = db.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO audit_logs'));
    expect(auditInsert).toBeDefined();
    expect(auditInsert[1][0]).toBe(7); // user_id
    expect(auditInsert[1][5]).toContain('fireisp_2026-07-17T03-00-00.sql.gz'); // summary
  });

  it.each([
    ['..%2F..%2Fetc%2Fpasswd', 'encoded traversal'],
    ['..%5C..%5Csecrets.env', 'encoded backslash traversal'],
    ['secrets.env', 'non-dump extension'],
    ['%2e%2e%2fsecrets.env', 'double-encoded dots'],
    ['a%00.sql.gz', 'null byte'],
  ])('refuses %s (%s) with 4xx and serves nothing', async (rawName) => {
    const res = await request(app).get(`/api/v1/backup-settings/download/${rawName}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.headers['content-disposition']).toBeUndefined();
    // Refusals must not be audit-logged as downloads
    const auditInsert = db.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO audit_logs'));
    expect(auditInsert).toBeUndefined();
  });

  it('404s a well-formed filename that does not exist', async () => {
    const res = await request(app).get('/api/v1/backup-settings/download/fireisp_2099-01-01T00-00-00.sql.gz');
    expect(res.status).toBe(404);
  });

  it('refuses a directory whose name matches the dump pattern', async () => {
    const res = await request(app).get('/api/v1/backup-settings/download/dir.sql.gz');
    expect(res.status).toBe(404);
  });

  it('refuses a symlink in BACKUP_DIR pointing outside it (does not follow it)', async () => {
    const linkExists = fs.existsSync(path.join(TEST_BACKUP_DIR, 'leak.sql.gz'));
    if (!linkExists) return; // symlink creation unsupported on this platform
    const res = await request(app)
      .get('/api/v1/backup-settings/download/leak.sql.gz')
      .buffer(true)
      .parse((r, cb) => { const c = []; r.on('data', d => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(422); // ValidationError — symlink rejected outright
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.body.toString()).not.toContain('OUTSIDE-SECRET');
  });
});

describe('GET /api/v1/backup-settings/runs — local file listing', () => {
  it('lists only real regular files, never the directory or symlink lures', async () => {
    const res = await request(app).get('/api/v1/backup-settings/runs');
    expect(res.status).toBe(200);
    const names = res.body.data.files.map(f => f.filename);
    // Every listed file must be one the download route would actually serve.
    expect(names).toContain('fireisp_2026-07-17T03-00-00.sql.gz');
    expect(names).not.toContain('dir.sql.gz');
    expect(names).not.toContain('leak.sql.gz');
    expect(names).not.toContain('secrets.env');
  });
});
