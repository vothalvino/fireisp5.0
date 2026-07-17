// =============================================================================
// FireISP 5.0 — Backup Script dump-path tests
// =============================================================================
// The old `execSync('mysqldump … | gzip > file')` reported the PIPELINE's exit
// status (gzip's), so a missing binary or failed dump wrote a 20-byte empty
// gzip that was logged as "Backup created". These tests drive the rewritten
// spawn-based path with fake mysqldump binaries on PATH: success must produce
// a real gzip of the dump output; any failure must throw AND leave no file
// behind.

jest.mock('../src/utils/logger', () => {
  const mock = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => mock),
  };
  return mock;
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const ENV_KEYS = ['BACKUP_DIR', 'BACKUP_MIN_BYTES', 'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'PATH'];

let tmpRoot;
let backupDir;
let binDir;
const savedEnv = {};

/** Write an executable fake `mysqldump` into binDir. */
function fakeMysqldump(script) {
  const p = path.join(binDir, 'mysqldump');
  fs.writeFileSync(p, `#!/bin/sh\n${script}\n`);
  fs.chmodSync(p, 0o755);
}

/** Load a fresh copy of the backup module with the current env. */
function loadBackup() {
  jest.resetModules();
  return require('../src/scripts/backup');
}

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fireisp-backup-'));
  backupDir = path.join(tmpRoot, 'backups');
  binDir = path.join(tmpRoot, 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  process.env.BACKUP_DIR = backupDir;
  process.env.DB_HOST = '127.0.0.1';
  process.env.DB_PORT = '3306';
  process.env.DB_USER = 'fireisp';
  process.env.DB_PASSWORD = 'sekret with spaces; $pecial';
  process.env.DB_NAME = 'fireisp';
  // Only the fake binary is visible — the real mysqldump (if any) is not.
  process.env.PATH = binDir;
  delete process.env.BACKUP_MIN_BYTES;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function backupFiles() {
  return fs.existsSync(backupDir)
    ? fs.readdirSync(backupDir).filter((f) => f.endsWith('.sql.gz'))
    : [];
}

describe('backup() dump path', () => {
  test('gzips the dump output and reports the file', async () => {
    // ~64 KB of dump output, and echo the password source to prove it arrives
    // via MYSQL_PWD (never argv).
    fakeMysqldump([
      'echo "-- fake dump for $MYSQL_PWD"',
      'i=0; while [ $i -lt 1000 ]; do echo "INSERT INTO t VALUES ($i, \'row\');"; i=$((i+1)); done',
    ].join('\n'));

    const { backup } = loadBackup();
    const { filepath } = await backup();

    expect(fs.existsSync(filepath)).toBe(true);
    const raw = zlib.gunzipSync(fs.readFileSync(filepath)).toString();
    expect(raw).toContain("-- fake dump for sekret with spaces; $pecial");
    expect(raw).toContain('INSERT INTO t VALUES (999');
    expect(fs.statSync(filepath).size).toBeGreaterThan(512);
  });

  test('non-zero mysqldump exit throws with stderr and leaves no file', async () => {
    fakeMysqldump([
      'echo "partial output that must not survive"',
      'echo "mysqldump: Got error: 1045: Access denied" >&2',
      'exit 2',
    ].join('\n'));

    const { backup } = loadBackup();
    await expect(backup()).rejects.toThrow(/exited with code 2.*Access denied/s);
    expect(backupFiles()).toHaveLength(0);
  });

  test('missing mysqldump binary throws a clear install hint and leaves no file', async () => {
    // binDir is empty — spawn fails with ENOENT, the exact production bug
    // (no client tools in the image) that used to "succeed" with 20 bytes.
    const { backup } = loadBackup();
    await expect(backup()).rejects.toThrow(/mysqldump not found in PATH/);
    expect(backupFiles()).toHaveLength(0);
  });

  test('an empty-but-successful dump is rejected by the size floor', async () => {
    fakeMysqldump('exit 0'); // no output at all → 20-byte empty gzip
    const { backup } = loadBackup();
    await expect(backup()).rejects.toThrow(/suspiciously small/);
    expect(backupFiles()).toHaveLength(0);
  });

  test('BACKUP_MIN_BYTES overrides the size floor', async () => {
    process.env.BACKUP_MIN_BYTES = '10';
    fakeMysqldump('echo "-- tiny but legitimate dump"');
    const { backup } = loadBackup();
    const { filepath } = await backup();
    expect(fs.statSync(filepath).size).toBeGreaterThan(10);
  });
});
