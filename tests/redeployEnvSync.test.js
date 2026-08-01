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
  // MANAGED_ENV_KEYS is empty right now (FIREISP_UPDATE_CHECK moved to
  // MANAGED_ENV_RETIRE when its default flipped to on). These exercise the
  // mechanism with a synthetic entry so it stays proven for the next setting,
  // rather than deleting the coverage until one appears.
  const withKey = (file, entry) => execFileSync('bash', ['-c',
    `set -euo pipefail; FIREISP_LIB_ONLY=1 source "$1"; MANAGED_ENV_KEYS=("$3"); sync_managed_env "$2"`,
    'bash', SCRIPT, file, entry], { encoding: 'utf8' });
  const ENTRY = 'FIREISP_DEMO_KEY=7|A synthetic managed setting used only by the test suite.';

  it('appends the key with its default and an explanation', () => {
    const f = write('.env.prod', 'DOMAIN=isp.example\n');
    withKey(f, ENTRY);
    expect(read(f)).toMatch(/^FIREISP_DEMO_KEY=7$/m);
    // The comment is the point: a bare key teaches nobody what it does.
    expect(read(f)).toMatch(/^# A synthetic managed setting/m);
  });

  it('leaves every existing line untouched', () => {
    const before = 'DB_PASSWORD=s3cret\nENCRYPTION_KEY=deadbeef\nDOMAIN=isp.example\n';
    const f = write('.env.prod', before);
    withKey(f, ENTRY);
    // Append-only: the original content must still be a literal prefix.
    expect(read(f).startsWith(before)).toBe(true);
  });

  it('takes a backup before writing', () => {
    const f = write('.env.prod', 'DOMAIN=isp.example\n');
    withKey(f, ENTRY);
    const backups = fs.readdirSync(dir).filter(n => n.startsWith('.env.prod.bak-'));
    expect(backups).toHaveLength(1);
    expect(read(path.join(dir, backups[0]))).toBe('DOMAIN=isp.example\n');
  });

  it('does not revert a value the operator set', () => {
    const f = write('.env.prod', 'FIREISP_DEMO_KEY=99\n');
    withKey(f, ENTRY);
    expect(read(f)).toBe('FIREISP_DEMO_KEY=99\n');
  });
});

describe('it never overrides what the operator decided', () => {
  const withKey = (file) => execFileSync('bash', ['-c',
    `set -euo pipefail; FIREISP_LIB_ONLY=1 source "$1"; MANAGED_ENV_KEYS=("FIREISP_DEMO_KEY=7|synthetic setting for the test suite"); sync_managed_env "$2"`,
    'bash', SCRIPT, file], { encoding: 'utf8' });

  it('does not re-add a key they deliberately commented out', () => {
    // Commenting something out is an expressed intent, not an absence.
    const f = write('.env.prod', '# FIREISP_DEMO_KEY=7\n');
    withKey(f);
    expect(read(f).match(/FIREISP_DEMO_KEY/g)).toHaveLength(1);
  });

  it('is idempotent across repeated deploys', () => {
    const f = write('.env.prod', 'DOMAIN=isp.example\n');
    withKey(f); const once = read(f);
    withKey(f); withKey(f);
    expect(read(f)).toBe(once);
  });
});

describe('it cannot corrupt the file it is appending to', () => {
  const withKey = (file) => execFileSync('bash', ['-c',
    `set -euo pipefail; FIREISP_LIB_ONLY=1 source "$1"; MANAGED_ENV_KEYS=("FIREISP_DEMO_KEY=7|synthetic setting for the test suite"); sync_managed_env "$2"`,
    'bash', SCRIPT, file], { encoding: 'utf8' });

  it('does not glue the new key onto a file with no trailing newline', () => {
    // The realistic disaster: ENCRYPTION_KEY=deadbeefFIREISP_UPDATE_CHECK=0
    //
    // Note for anyone mutation-testing this: deleting the tail -c1 guard in
    // redeploy.sh does NOT fail this test, and that is correct rather than a
    // gap — the append block opens with its own newline, so the guard is
    // redundant today. It is kept as protection against that separator being
    // dropped later. This test pins the OUTCOME, which is what matters.
    const f = write('.env.prod', 'ENCRYPTION_KEY=deadbeef');
    withKey(f);
    expect(read(f)).toMatch(/^ENCRYPTION_KEY=deadbeef$/m);
    expect(read(f)).toMatch(/^FIREISP_DEMO_KEY=7$/m);
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
    // The list is legitimately EMPTY between settings — assert the shape of
    // whatever is there rather than requiring something to be there.
    const out = execFileSync('bash', ['-c',
      'set -euo pipefail; FIREISP_LIB_ONLY=1 source "$1"; printf "%s\\n" "${MANAGED_ENV_KEYS[@]:-}"',
      'bash', SCRIPT], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    for (const entry of out) {
      expect(entry).toMatch(/^[A-Z0-9_]+=[^|]*\|.+/);
      // A one-word "comment" helps nobody.
      expect(entry.split('|')[1].length).toBeGreaterThan(30);
    }
  });
});


// ---------------------------------------------------------------------------
// Retirement — the ONE place this script removes a line from .env.prod
// ---------------------------------------------------------------------------
// When a setting's default flips, installs that received the OLD default
// explicitly are pinned to it and would need exactly the hand-edit the sync
// exists to avoid. FIREISP_UPDATE_CHECK is the first case: it shipped as
// off-by-default, the sync wrote `=0` into live .env.prod files, and the
// default is now on.
//
// Removing a line from a file holding DB_PASSWORD and ENCRYPTION_KEY earns
// tighter constraints than appending to one.

function retire(file) {
  return execFileSync(
    'bash',
    ['-c', 'set -euo pipefail; FIREISP_LIB_ONLY=1 source "$1"; retire_managed_env "$2"',
      'bash', SCRIPT, file],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

// What sync_managed_env actually wrote in #607, comment and all.
const OURS = 'DB_PASSWORD=s3cret\nDOMAIN=isp.example\n'
  + '\n# Show the install operator a once-a-day banner when a newer FireISP release exists. Set to 1 to enable.\n'
  + 'FIREISP_UPDATE_CHECK=0\n';

describe('withdrawing a setting whose default changed', () => {
  it('removes the line and the comment we wrote with it', () => {
    const f = write('.env.prod', OURS);
    retire(f);
    expect(read(f)).not.toMatch(/FIREISP_UPDATE_CHECK/);
    // An orphaned comment explaining an absent key is worse than either.
    expect(read(f)).not.toMatch(/once-a-day banner/);
  });

  it('leaves the rest of the file byte-identical', () => {
    const f = write('.env.prod', OURS);
    retire(f);
    expect(read(f)).toBe('DB_PASSWORD=s3cret\nDOMAIN=isp.example\n');
  });

  it('PRESERVES FILE PERMISSIONS', () => {
    // The trap: rewriting via `mv tmp file` replaces the inode and hands the
    // file the temp's umask-derived mode, silently turning a 0600 secrets file
    // world-readable. This must rewrite the original in place.
    const f = write('.env.prod', OURS);
    fs.chmodSync(f, 0o600);
    retire(f);
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
  });

  it('backs the file up first', () => {
    const f = write('.env.prod', OURS);
    retire(f);
    const backups = fs.readdirSync(dir).filter(n => n.startsWith('.env.prod.bak-'));
    expect(backups).toHaveLength(1);
    expect(read(path.join(dir, backups[0]))).toBe(OURS);
  });

  it('is idempotent', () => {
    const f = write('.env.prod', OURS);
    retire(f); const once = read(f);
    retire(f); retire(f);
    expect(read(f)).toBe(once);
  });
});

describe('it can only withdraw a suggestion, never a decision', () => {
  it('keeps a value the operator changed', () => {
    const f = write('.env.prod', OURS.replace('FIREISP_UPDATE_CHECK=0', 'FIREISP_UPDATE_CHECK=1'));
    retire(f);
    expect(read(f)).toMatch(/^FIREISP_UPDATE_CHECK=1$/m);
  });

  it("keeps an operator's OWN opt-out, which is byte-identical to ours", () => {
    // The whole reason the marker exists. `FIREISP_UPDATE_CHECK=0` typed by
    // hand is indistinguishable from ours by value, and withdrawing it would
    // re-enable something they deliberately switched off. The comment we wrote
    // alongside it is the only evidence of authorship available.
    const f = write('.env.prod', 'DOMAIN=isp.example\nFIREISP_UPDATE_CHECK=0\n');
    retire(f);
    expect(read(f)).toMatch(/^FIREISP_UPDATE_CHECK=0$/m);
  });

  it('refuses to write an empty file when the rewrite yields nothing', () => {
    // Reachable, not theoretical: a .env.prod consisting ONLY of the block we
    // wrote leaves nothing behind. Without the non-empty guard this drops a
    // 108-byte file to 1 byte — and on a real install that file holds
    // DB_PASSWORD and ENCRYPTION_KEY. Found by mutation testing: removing the
    // guard passed every other case in this suite.
    const onlyOurs = '# Show the install operator a once-a-day banner when a newer FireISP release exists.\n'
      + 'FIREISP_UPDATE_CHECK=0\n';
    const f = write('.env.prod', onlyOurs);
    retire(f);
    expect(read(f)).toBe(onlyOurs);
  });

  it('warns and continues on a read-only file', () => {
    const f = write('.env.prod', OURS);
    fs.chmodSync(f, 0o444);
    expect(() => retire(f)).not.toThrow();
    expect(read(f)).toBe(OURS);
    fs.chmodSync(f, 0o644);
  });

  it('skips a missing file', () => {
    expect(() => retire(path.join(dir, 'absent.env'))).not.toThrow();
  });
});
