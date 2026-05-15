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
