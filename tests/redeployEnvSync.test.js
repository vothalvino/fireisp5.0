'use strict';
// =============================================================================
// FireISP 5.0 — redeploy.sh introduces new settings into a live .env.prod
// =============================================================================
// An upgrade that requires hand-editing a secrets file is an upgrade most
// operators will not perform, so new options arrive on the next deploy already
// carrying their default and their explanation.
//
// That means a shell script appends to a file holding DB_PASSWORD, JWT_SECRET
// and ENCRYPTION_KEY. These tests EXECUTE the real function against real files
// rather than grepping the source, because the failure that matters here is not
// "the wrong text was written" — it is "a working install stopped booting".
//
// The specific hazard the allowlist exists for: .env.prod.example ships
// PLACEHOLDER SECRETS (DB_PASSWORD=CHANGE_ME_..., ENCRYPTION_KEY=CHANGE_ME_...).
// A sync that copied "every key in the example" would introduce those into a
// working install, locking out the database and making every stored CSD and
// payment credential undecryptable.
// =============================================================================

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '../redeploy.sh');
let dir;

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fireisp-envsync-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Source redeploy.sh in library mode and run the sync against `file`. */
function sync(file) {
  return execFileSync(
    'bash',
    ['-c', `set -euo pipefail; FIREISP_LIB_ONLY=1 source "$1"; sync_managed_env "$2"`,
      'bash', SCRIPT, file],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function write(name, content) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}
const read = (p) => fs.readFileSync(p, 'utf8');

describe('a new setting arrives without the operator editing anything', () => {
  it('appends the key with its default and an explanation', () => {
    const f = write('.env.prod', 'DOMAIN=isp.example\n');
    sync(f);
    expect(read(f)).toMatch(/^FIREISP_UPDATE_CHECK=0$/m);
    // The comment is the point: a bare key teaches nobody what it does.
    expect(read(f)).toMatch(/^# .*banner.*$/m);
  });

  it('leaves every existing line untouched', () => {
    const before = 'DB_PASSWORD=s3cret\nENCRYPTION_KEY=deadbeef\nDOMAIN=isp.example\n';
    const f = write('.env.prod', before);
    sync(f);
    // Append-only: the original content must still be a literal prefix.
    expect(read(f).startsWith(before)).toBe(true);
  });

  it('takes a backup before writing', () => {
    const f = write('.env.prod', 'DOMAIN=isp.example\n');
    sync(f);
    const backups = fs.readdirSync(dir).filter(n => n.startsWith('.env.prod.bak-'));
    expect(backups).toHaveLength(1);
    expect(read(path.join(dir, backups[0]))).toBe('DOMAIN=isp.example\n');
  });
});

describe('it never overrides what the operator decided', () => {
  it('does not revert a value they set', () => {
    // Every deploy runs this. Re-writing the default would silently turn the
    // setting back off on the next upgrade.
    const f = write('.env.prod', 'FIREISP_UPDATE_CHECK=1\n');
    sync(f);
    expect(read(f)).toBe('FIREISP_UPDATE_CHECK=1\n');
  });

  it('does not re-add a key they deliberately commented out', () => {
    // Commenting something out is an expressed intent, not an absence.
    const f = write('.env.prod', '# FIREISP_UPDATE_CHECK=1\n');
    sync(f);
    expect(read(f).match(/FIREISP_UPDATE_CHECK/g)).toHaveLength(1);
  });

  it('is idempotent across repeated deploys', () => {
    const f = write('.env.prod', 'DOMAIN=isp.example\n');
    sync(f); const once = read(f);
    sync(f); sync(f);
    expect(read(f)).toBe(once);
  });
});

describe('it cannot corrupt the file it is appending to', () => {
  it('does not glue the new key onto a file with no trailing newline', () => {
    // The realistic disaster: ENCRYPTION_KEY=deadbeefFIREISP_UPDATE_CHECK=0
    //
    // Note for anyone mutation-testing this: deleting the tail -c1 guard in
    // redeploy.sh does NOT fail this test, and that is correct rather than a
    // gap — the append block opens with its own newline, so the guard is
    // redundant today. It is kept as protection against that separator being
    // dropped later. This test pins the OUTCOME, which is what matters.
    const f = write('.env.prod', 'ENCRYPTION_KEY=deadbeef');
    sync(f);
    expect(read(f)).toMatch(/^ENCRYPTION_KEY=deadbeef$/m);
    expect(read(f)).toMatch(/^FIREISP_UPDATE_CHECK=0$/m);
  });

  it('warns and continues when the file is read-only', () => {
    const f = write('.env.prod', 'DOMAIN=isp.example\n');
    fs.chmodSync(f, 0o444);
    let out;
    expect(() => { out = sync(f); }).not.toThrow();   // must not fail the deploy
    expect(read(f)).toBe('DOMAIN=isp.example\n');
    fs.chmodSync(f, 0o644);
    expect(out).toBeDefined();
  });

  it('skips a missing file without failing the deploy', () => {
    expect(() => sync(path.join(dir, 'absent.env'))).not.toThrow();
  });
});

describe('the allowlist is the safety mechanism', () => {
  const src = () => fs.readFileSync(SCRIPT, 'utf8');

  it('carries only inert, non-secret settings', () => {
    const block = src().slice(src().indexOf('MANAGED_ENV_KEYS=('), src().indexOf('\n)', src().indexOf('MANAGED_ENV_KEYS=(')));
    // If one of these ever appears here, a deploy would overwrite a live
    // install's credentials with a CHANGE_ME placeholder.
    for (const forbidden of ['DB_PASSWORD', 'DB_ROOT_PASSWORD', 'ENCRYPTION_KEY',
      'JWT_SECRET', 'REDIS_PASSWORD', 'MYSQL_REPL_PASSWORD', 'SMTP_PASS', 'TWILIO_AUTH_TOKEN']) {
      expect(block).not.toContain(forbidden);
    }
  });

  it('is a literal list, not derived from .env.prod.example', () => {
    // Deriving it would sweep in the placeholder secrets that file ships.
    const block = src().slice(src().indexOf('MANAGED_ENV_KEYS=('), src().indexOf('\n)', src().indexOf('MANAGED_ENV_KEYS=(')));
    expect(block).not.toMatch(/env\.prod\.example/);
    expect(block).not.toMatch(/\$\(/);
  });

  it('every managed entry has a default and an explanation', () => {
    const out = execFileSync('bash', ['-c',
      'set -euo pipefail; FIREISP_LIB_ONLY=1 source "$1"; printf "%s\\n" "${MANAGED_ENV_KEYS[@]}"',
      'bash', SCRIPT], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    expect(out.length).toBeGreaterThan(0);
    for (const entry of out) {
      expect(entry).toMatch(/^[A-Z0-9_]+=[^|]*\|.+/);
      // A one-word "comment" helps nobody.
      expect(entry.split('|')[1].length).toBeGreaterThan(30);
    }
  });
});
