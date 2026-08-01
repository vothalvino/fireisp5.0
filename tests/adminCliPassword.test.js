'use strict';
// =============================================================================
// FireISP 5.0 — the admin CLI must not take a password on the command line
// =============================================================================
// `node src/scripts/admin.js create-user --password hunter2` put the new
// account's password in this process's argv, and /proc/<pid>/cmdline is mode
// 0444 — every local account on the box can read it for as long as the command
// runs. The same class as the deploy agent (PR #630) and the compose/install
// credentials (PR #631).
//
// The password now arrives by a channel that is not world-readable: the
// FIREISP_ADMIN_PASSWORD environment variable (/proc/<pid>/environ is 0400,
// owner only), or an interactive prompt. The flag still works so existing scripts do not
// break, but it warns.
//
// resolvePassword is exercised for real rather than asserted on as text: the
// function is lifted out of the script and run in a child process, so a change
// that breaks precedence or the non-TTY guard fails here.
// =============================================================================

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ADMIN = path.join(__dirname, '..', 'src', 'scripts', 'admin.js');
const source = () => fs.readFileSync(ADMIN, 'utf8');

/**
 * Extract promptHidden + resolvePassword into a standalone ESM module with a
 * stub logger, so they can be driven without a database or a real command.
 */
function harnessPath() {
  const src = source();
  const start = src.indexOf('function promptHidden');
  const end = src.indexOf('// ====', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fireisp-admincli-'));
  const file = path.join(dir, 'harness.mjs');
  fs.writeFileSync(file, [
    "import readline from 'node:readline';",
    'const logger = { warn: (m) => console.error(String(m)), error: (m) => console.error(String(m)) };',
    src.slice(start, end),
    "const args = JSON.parse(process.env.TEST_ARGS || '{}');",
    "const pw = await resolvePassword(args, { confirm: process.env.TEST_CONFIRM === '1' });",
    "console.log('RESOLVED:' + pw);",
  ].join('\n'));
  return file;
}

/** Run the harness with stdin as a PIPE, i.e. deliberately not a TTY. */
function run(env, file) {
  const clean = { ...process.env };
  delete clean.ADMIN_PASSWORD;
  delete clean.FIREISP_ADMIN_PASSWORD;
  return spawnSync('node', [file], { env: { ...clean, ...env }, input: '', encoding: 'utf8' });
}

describe('the admin CLI takes the password off the command line', () => {
  let file;
  beforeAll(() => { file = harnessPath(); });

  it('prefers FIREISP_ADMIN_PASSWORD from the environment', () => {
    const r = run({ FIREISP_ADMIN_PASSWORD: 'from-env-123', TEST_ARGS: '{}' }, file);
    expect(r.stdout).toContain('RESOLVED:from-env-123');
  });

  it('lets the environment win over the deprecated flag', () => {
    const r = run({ FIREISP_ADMIN_PASSWORD: 'from-env-123', TEST_ARGS: JSON.stringify({ password: 'from-flag' }) }, file);
    expect(r.stdout).toContain('RESOLVED:from-env-123');
  });

  it('still accepts --password, so existing scripts keep working', () => {
    const r = run({ TEST_ARGS: JSON.stringify({ password: 'from-flag-999' }) }, file);
    expect(r.stdout).toContain('RESOLVED:from-flag-999');
  });

  it('warns that --password is readable from /proc', () => {
    const r = run({ TEST_ARGS: JSON.stringify({ password: 'from-flag-999' }) }, file);
    expect(r.stderr).toMatch(/proc\/<pid>\/cmdline/);
  });

  it('refuses, rather than hanging, when there is no password and no terminal', () => {
    // A prompt written without this guard blocks forever under cron/CI.
    const r = run({ TEST_ARGS: '{}' }, file);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/FIREISP_ADMIN_PASSWORD/);
  });
});

describe('the shipped script and its docs agree', () => {
  it('no longer requires --password to reach the command', () => {
    // Both commands used to hard-fail on `!args.password` before doing anything,
    // which is what made the flag mandatory in practice.
    const src = source();
    expect(src).not.toContain('!args.email || !args.password');
    expect(src).toContain('await resolvePassword(args');
  });

  it('documents FIREISP_ADMIN_PASSWORD in the built-in help', () => {
    expect(source()).toMatch(/FIREISP_ADMIN_PASSWORD/);
  });

  it('does NOT read ADMIN_PASSWORD, which belongs to the seeded account', () => {
    // seed.js owns ADMIN_PASSWORD as the seeded admin's INITIAL password;
    // install.sh writes it into .env.prod and the app container loads that file.
    // Reading it here would make `reset-password` inside the container — the
    // most likely place to run it — silently reset the account to the seed
    // password instead of prompting. Asserted on code, not comments, because
    // the file legitimately explains the collision in prose.
    const code = source().split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/process\.env\.ADMIN_PASSWORD/);
  });

  it('the header usage block no longer advertises --password', () => {
    const header = source().slice(0, source().indexOf("require('dotenv')"));
    expect(header).not.toMatch(/create-user\s+--email <email> --password/);
  });

  it('parses and lints as shipped', () => {
    // node --check catches a syntax error the unit tests above would mask,
    // because they only ever load an extracted slice of the file.
    execFileSync('node', ['--check', ADMIN], { stdio: 'pipe' });
  });
});
