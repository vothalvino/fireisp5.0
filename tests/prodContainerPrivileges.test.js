'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');

function readCompose(name) {
  return yaml.load(fs.readFileSync(path.join(ROOT, name), 'utf8'));
}

describe('production container least privilege', () => {
  const base = readCompose('docker-compose.prod.yml');
  const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');

  test('the default app uses the image non-root user without added capabilities', () => {
    const app = base.services.app;
    expect(app).not.toHaveProperty('user');
    expect(app).not.toHaveProperty('cap_add');
    expect(app.sysctls).toEqual({ 'net.ipv4.ip_forward': '1' });
    expect(app.environment.WG_SERVER_ENABLED).toBe('false');
    expect(app.volumes).not.toContain('wg_keys:/etc/wireguard');
    expect(app.volumes).toContain('wg_runtime:/run/fireisp-wireguard:ro');
    expect(dockerfile).toMatch(/\nUSER fireisp\n/);
  });

  test('only the isolated helper receives the one required capability', () => {
    const helper = base.services['wireguard-helper'];
    expect(helper.user).toBe('0:0');
    expect(helper.cap_drop).toEqual(['ALL']);
    expect(helper.cap_add).toEqual(['NET_ADMIN']);
    expect(helper.security_opt).toContain('no-new-privileges:true');
    expect(helper.read_only).toBe(true);
    expect(helper.network_mode).toBe('service:app');
    expect(helper.volumes).toContain('wg_keys:/etc/wireguard');
  });

  test('the helper receives no application or data-service credentials', () => {
    const helper = base.services['wireguard-helper'];
    expect(helper).not.toHaveProperty('env_file');
    for (const key of [
      'DB_HOST', 'DB_PASSWORD', 'REDIS_URL', 'REDIS_PASSWORD',
      'JWT_SECRET', 'ENCRYPTION_KEY',
    ]) {
      expect(helper.environment).not.toHaveProperty(key);
    }
  });

  test('MySQL and Redis remain internal and are never published on the host', () => {
    expect(base.networks.backend.internal).toBe(true);
    for (const serviceName of ['db-primary', 'db-replica', 'redis']) {
      expect(base.services[serviceName].networks).toContain('backend');
      expect(base.services[serviceName]).not.toHaveProperty('ports');
    }
  });
});
