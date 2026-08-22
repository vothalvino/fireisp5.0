'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const REDEPLOY = path.join(ROOT, 'redeploy.sh');
const INSTALL = path.join(ROOT, 'install.sh');

function topology(envContents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fireisp-topology-'));
  fs.writeFileSync(path.join(dir, '.env.prod'), envContents, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'docker-compose.prod.yml'), 'services: {}\n');
  fs.writeFileSync(path.join(dir, 'docker-compose.host-nginx.yml'), 'services: {}\n');
  try {
    return execFileSync('bash', ['-c', [
      'source "$1"',
      'resolve_host_nginx_mode',
      'printf "%s\\n" "${COMPOSE_ARGS[*]}"',
    ].join('; '), 'bash', REDEPLOY], {
      encoding: 'utf8',
      env: { ...process.env, FIREISP_LIB_ONLY: '1', FIREISP_DIR: dir },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('redeploy preserves the installer topology', () => {
  test('explicit host-nginx installs use the overlay on every redeploy step', () => {
    const output = topology('FIREISP_HOST_NGINX=1\n');
    expect(output).toContain('docker-compose.prod.yml');
    expect(output).toContain('docker-compose.host-nginx.yml');
  });

  test('explicit bundled-nginx installs use only the production Compose file', () => {
    const output = topology('FIREISP_HOST_NGINX=0\n');
    expect(output).toContain('docker-compose.prod.yml');
    expect(output).not.toContain('docker-compose.host-nginx.yml');
  });

  test('an invalid persisted topology fails instead of guessing at production ports', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fireisp-topology-invalid-'));
    fs.writeFileSync(path.join(dir, '.env.prod'), 'FIREISP_HOST_NGINX=maybe\n');
    fs.writeFileSync(path.join(dir, 'docker-compose.prod.yml'), 'services: {}\n');
    try {
      const result = spawnSync('bash', ['-c', 'source "$1"; resolve_host_nginx_mode', 'bash', REDEPLOY], {
        encoding: 'utf8',
        env: { ...process.env, FIREISP_LIB_ONLY: '1', FIREISP_DIR: dir },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/not a recognised boolean/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fresh env files persist the topology and management commands install before TLS/startup', () => {
    const install = fs.readFileSync(INSTALL, 'utf8');
    expect(install).toContain('FIREISP_HOST_NGINX=${USE_HOST_NGINX}');
    const commandAt = install.indexOf('REDEPLOY_BIN="/usr/local/bin/redeploy"');
    const tlsAt = install.indexOf('── TLS Certificates');
    const startAt = install.indexOf('── Starting FireISP');
    expect(commandAt).toBeGreaterThan(0);
    expect(commandAt).toBeLessThan(tlsAt);
    expect(commandAt).toBeLessThan(startAt);
  });

  test('a pulled redeploy-script change re-execs before selecting the image', () => {
    const script = fs.readFileSync(REDEPLOY, 'utf8');
    const pullAt = script.indexOf('git -C "$APP_DIR" pull --ff-only origin main');
    const reexecAt = script.indexOf('FIREISP_REDEPLOY_REEXEC=1');
    const tagAt = script.indexOf('TAG="${1:-');
    expect(pullAt).toBeGreaterThan(0);
    expect(reexecAt).toBeGreaterThan(pullAt);
    expect(reexecAt).toBeLessThan(tagAt);
    expect(script).toContain('docker compose "${COMPOSE_ARGS[@]}"');
  });
});
