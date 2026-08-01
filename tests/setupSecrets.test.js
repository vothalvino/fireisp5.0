const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const HEX_64_RE = /^[0-9a-f]{64}$/i;
const HEX_40_RE = /^[0-9a-f]{40}$/i;

function parseEnv(filePath) {
  return Object.fromEntries(
    fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter(line => line && !line.startsWith('#') && line.includes('='))
      .map(line => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

function createWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fireisp-setup-'));
  for (const file of ['setup.sh', '.env.example', '.env.prod.example']) {
    fs.copyFileSync(path.join(REPO_ROOT, file), path.join(dir, file));
  }

  const fakeBin = path.join(dir, 'bin');
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, 'pnpm'), '#!/bin/sh\nexit 0\n');
  fs.chmodSync(path.join(fakeBin, 'pnpm'), 0o755);
  return { dir, fakeBin };
}

function runSetup(dir, fakeBin, args = []) {
  execFileSync('bash', ['setup.sh', ...args], {
    cwd: dir,
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    stdio: 'pipe',
  });
}

describe('setup.sh secret generation', () => {
  test('development setup generates stable local HS256 and database encryption secrets', () => {
    const { dir, fakeBin } = createWorkspace();

    runSetup(dir, fakeBin);
    const first = parseEnv(path.join(dir, '.env'));

    expect(first.JWT_ALGORITHM).toBe('HS256');
    expect(first.JWT_SECRET).toMatch(HEX_64_RE);
    expect(first.ENCRYPTION_KEY).toMatch(HEX_64_RE);
    expect(first.DB_PASSWORD).toMatch(HEX_40_RE);

    runSetup(dir, fakeBin);
    const second = parseEnv(path.join(dir, '.env'));
    expect(second.JWT_SECRET).toBe(first.JWT_SECRET);
    expect(second.ENCRYPTION_KEY).toBe(first.ENCRYPTION_KEY);
    expect(second.DB_PASSWORD).toBe(first.DB_PASSWORD);
  });

  test('production setup replaces placeholders and keeps Redis URL password in sync', () => {
    const { dir, fakeBin } = createWorkspace();

    runSetup(dir, fakeBin, ['--prod']);
    const env = parseEnv(path.join(dir, '.env.prod'));

    expect(env.JWT_ALGORITHM).toBe('HS256');
    expect(env.JWT_SECRET).toMatch(HEX_64_RE);
    expect(env.ENCRYPTION_KEY).toMatch(HEX_64_RE);
    expect(env.DB_PASSWORD).toMatch(HEX_40_RE);
    expect(env.DB_ROOT_PASSWORD).toMatch(HEX_40_RE);
    expect(env.MYSQL_REPL_PASSWORD).toMatch(HEX_40_RE);
    expect(env.REDIS_PASSWORD).toMatch(HEX_40_RE);
    expect(env.REDIS_URL).toBe(`redis://:${env.REDIS_PASSWORD}@redis:6379`);
  });
});

// ---------------------------------------------------------------------------
// set_env_value must not hand a secret to another process, or mangle it
// ---------------------------------------------------------------------------
// It used to run `sed -i "s|^KEY=.*|KEY=${value}|"`, which execs sed with the
// secret in its argv — and /proc/<pid>/cmdline is mode 0444, readable by every
// local account. Every generated secret went through it: JWT_SECRET,
// ENCRYPTION_KEY, and the DB / root / replication / Redis passwords.
//
// The same line was also a silent corruption bug, because sed's replacement
// text has its own syntax: `&` means "the whole match" and `|` closed the
// s-command. Verified against the old implementation — `sed&replace` was
// written as `sedJWT_SECRET=oldreplace`, and `has|pipe&amp` as `old`.

/** Call set_env_value in isolation, without running the rest of setup.sh. */
function callSetEnvValue(file, key, value) {
  const script = `
    set -euo pipefail
    eval "$(sed -n '/^set_env_value() {/,/^}/p' "$1")"
    set_env_value "$2" "$3" "$4"
  `;
  return execFileSync('bash', ['-c', script, 'bash', path.join(REPO_ROOT, 'setup.sh'), file, key, value],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const readKey = (file, key) => fs.readFileSync(file, 'utf8')
  .split(/\r?\n/).find(l => l.startsWith(`${key}=`))?.slice(key.length + 1);

describe('setup.sh set_env_value keeps secrets out of argv and intact', () => {
  const HOSTILE = [
    ['plain', 'simple123'],
    ['sed replacement ampersand', 'sed&replace'],
    ['pipe, the old sed delimiter', 'has|pipe&amp'],
    ['backslash', 'back\\slash'],
    ['double quote', 'quo"te'],
    ['single quote', "sin'gle"],
    ['forward slashes', 'a/b/c'],
    ['shell substitution shapes', '$(id)`id`'],
    ['spaces', 'sp ace'],
  ];

  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fireisp-setenv-')); });

  const seed = (contents = 'JWT_SECRET=old\n# DB_PASSWORD=commented\nKEEP_ME=yes\n') => {
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, contents);
    fs.chmodSync(file, 0o600);
    return file;
  };

  test.each(HOSTILE)('writes a value containing %s byte-for-byte', (_label, value) => {
    const file = seed();
    callSetEnvValue(file, 'JWT_SECRET', value);
    expect(readKey(file, 'JWT_SECRET')).toBe(value);
  });

  test('uncomments a commented key rather than appending a duplicate', () => {
    const file = seed();
    callSetEnvValue(file, 'DB_PASSWORD', 'x|y\\z"q');
    expect(readKey(file, 'DB_PASSWORD')).toBe('x|y\\z"q');
    const occurrences = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.startsWith('DB_PASSWORD='));
    expect(occurrences).toHaveLength(1);
  });

  test('appends a key that is absent entirely', () => {
    const file = seed();
    callSetEnvValue(file, 'BRAND_NEW', 'v|a\\l');
    expect(readKey(file, 'BRAND_NEW')).toBe('v|a\\l');
  });

  test('leaves other lines alone and preserves 0600 on the secrets file', () => {
    // A rewrite that mv'd a temp over the original would replace the inode and
    // take the umask's mode, quietly making DB_PASSWORD world-readable.
    const file = seed();
    callSetEnvValue(file, 'JWT_SECRET', 'zz');
    expect(fs.readFileSync(file, 'utf8')).toContain('KEEP_ME=yes');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  test('spawns nothing that could carry the secret in its argv', () => {
    // The load-bearing property. Builtins only — no sed, no awk, no tee.
    const body = fs.readFileSync(path.join(REPO_ROOT, 'setup.sh'), 'utf8');
    const fn = body.slice(body.indexOf('set_env_value() {'), body.indexOf('\n}', body.indexOf('set_env_value() {')));
    const code = fn.split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
    for (const forbidden of ['sed ', 'awk ', 'tee ', 'perl ', 'python']) {
      expect(code).not.toContain(forbidden);
    }
    // grep is still used, but only to TEST for a key — never with the value.
    for (const line of code.split('\n').filter(l => l.includes('grep'))) {
      expect(line).not.toContain('$value');
      expect(line).not.toContain('${value}');
    }
  });
});
