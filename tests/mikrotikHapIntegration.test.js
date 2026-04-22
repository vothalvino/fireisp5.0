// =============================================================================
// FireISP 5.0 — MikroTik hAP Lab Integration Tests (Roadmap 3.1)
// =============================================================================
// These tests validate the RouterOS API service against a real MikroTik device.
//
// To run:
//   MIKROTIK_HAP_HOST=<ip> npx jest tests/mikrotikHapIntegration.test.js
//
// Optional overrides (all have sensible defaults for the lab router):
//   MIKROTIK_HAP_PORT  — RouterOS API port  (default: 8728)
//   MIKROTIK_HAP_USER  — API username       (default: ai_test)
//   MIKROTIK_HAP_PASS  — API password       (default: ai_test123)
//
// Tests are SKIPPED when MIKROTIK_HAP_HOST is not set so that normal CI runs
// are unaffected.
// =============================================================================

jest.mock('../src/utils/logger', () => ({
  child: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  }),
}));

const {
  RouterOSClient,
  parseAttrs,
  pppoeCreate,
  pppoeDelete,
  queueSet,
  addressListAdd,
  addressListRemove,
  configBackup,
} = require('../src/services/routerosService');

// ─── Connection parameters ────────────────────────────────────────────────────
const HAP_HOST = process.env.MIKROTIK_HAP_HOST || null;
const HAP_PORT = parseInt(process.env.MIKROTIK_HAP_PORT || '8728', 10);
const HAP_USER = process.env.MIKROTIK_HAP_USER || 'ai_test';
const HAP_PASS = process.env.MIKROTIK_HAP_PASS || 'ai_test123';

const CONN = { host: HAP_HOST, port: HAP_PORT, user: HAP_USER, password: HAP_PASS };

// Unique suffix per run to prevent name collisions on a shared lab router.
const SUFFIX = `fi_${Date.now()}`;

// Only execute when a real host is configured.
const describeHap = HAP_HOST ? describe : describe.skip;

// =============================================================================
describeHap('MikroTik hAP Lab Integration', () => {
  jest.setTimeout(30000);

  // ─── Connectivity ───────────────────────────────────────────────────────────

  describe('Connectivity', () => {
    test('connects and authenticates via RouterOS API', async () => {
      const client = new RouterOSClient(CONN);
      await expect(client.connect()).resolves.toBeUndefined();
      await client.close();
    });

    test('reads system resource info (version, platform, board-name)', async () => {
      const client = new RouterOSClient(CONN);
      await client.connect();
      const sentences = await client.run(['/system/resource/print']);
      await client.close();

      const re = sentences.find((s) => s[0] === '!re');
      expect(re).toBeDefined();
      const attrs = parseAttrs(re.slice(1));
      expect(attrs.version).toMatch(/\d+\.\d+/);
      expect(attrs.platform).toBeTruthy();
      expect(attrs['board-name']).toBeTruthy();
    });

    test('reads router identity via system/identity/print', async () => {
      const client = new RouterOSClient(CONN);
      await client.connect();
      const sentences = await client.run(['/system/identity/print']);
      await client.close();

      const re = sentences.find((s) => s[0] === '!re');
      expect(re).toBeDefined();
      const attrs = parseAttrs(re.slice(1));
      expect(typeof attrs.name).toBe('string');
      expect(attrs.name.length).toBeGreaterThan(0);
    });
  });

  // ─── PPPoE Secrets ──────────────────────────────────────────────────────────

  describe('PPPoE Secrets', () => {
    const secretName = `${SUFFIX}_ppp`;

    test('creates a PPPoE secret on the router', async () => {
      const result = await pppoeCreate(CONN, {
        name: secretName,
        secretPassword: 'TestPass!99',
        comment: 'FireISP lab test — auto-cleanup',
      });
      expect(result).toHaveProperty('id');
      expect(typeof result.id).toBe('string');
    });

    test('verifies the PPPoE secret is retrievable via /ppp/secret/print', async () => {
      const client = new RouterOSClient(CONN);
      await client.connect();
      const sentences = await client.run(['/ppp/secret/print', `?name=${secretName}`]);
      await client.close();

      const re = sentences.find((s) => s[0] === '!re');
      expect(re).toBeDefined();
      const attrs = parseAttrs(re.slice(1));
      expect(attrs.name).toBe(secretName);
    });

    test('deletes the PPPoE secret from the router', async () => {
      const result = await pppoeDelete(CONN, { name: secretName });
      expect(result).toEqual({ deleted: true, name: secretName });
    });

    test('pppoeDelete rejects when the secret does not exist', async () => {
      await expect(
        pppoeDelete(CONN, { name: `${SUFFIX}_nonexistent_ppp` })
      ).rejects.toThrow();
    });
  });

  // ─── Simple Queue ────────────────────────────────────────────────────────────

  describe('Simple Queue', () => {
    const queueName = `${SUFFIX}_q`;
    const queueTarget = '192.168.200.200';

    test('creates a new simple queue with a bandwidth limit', async () => {
      const result = await queueSet(CONN, {
        name: queueName,
        target: queueTarget,
        maxLimit: '10M/5M',
        comment: 'FireISP lab test — auto-cleanup',
      });
      expect(result.created).toBe(true);
      expect(typeof result.id).toBe('string');
    });

    test('updates the queue max-limit on an existing queue', async () => {
      const result = await queueSet(CONN, {
        name: queueName,
        target: queueTarget,
        maxLimit: '20M/10M',
        comment: 'FireISP lab test — updated',
      });
      expect(result.created).toBe(false);
      expect(typeof result.id).toBe('string');
    });

    test('removes the test queue (cleanup)', async () => {
      const client = new RouterOSClient(CONN);
      await client.connect();

      const sentences = await client.run(['/queue/simple/print', `?name=${queueName}`]);
      let queueId = null;
      for (const s of sentences) {
        if (s[0] === '!re') {
          queueId = parseAttrs(s.slice(1))['.id'];
        }
      }

      expect(queueId).not.toBeNull();
      await client.run(['/queue/simple/remove', `=.id=${queueId}`]);
      await client.close();

      // Verify it's gone
      const client2 = new RouterOSClient(CONN);
      await client2.connect();
      const check = await client2.run(['/queue/simple/print', `?name=${queueName}`]);
      await client2.close();

      const found = check.some((s) => s[0] === '!re');
      expect(found).toBe(false);
    });
  });

  // ─── Firewall Address-List ───────────────────────────────────────────────────

  describe('Firewall Address-List', () => {
    const testList = 'fireisp_lab_test';
    const testAddress = '10.99.88.77';

    test('adds an IP address to a firewall address-list', async () => {
      const result = await addressListAdd(CONN, {
        list: testList,
        address: testAddress,
        comment: 'FireISP lab test — auto-cleanup',
      });
      expect(result).toHaveProperty('id');
      expect(typeof result.id).toBe('string');
    });

    test('removes the address from the firewall address-list', async () => {
      const result = await addressListRemove(CONN, {
        list: testList,
        address: testAddress,
      });
      expect(result).toEqual({ deleted: true, list: testList, address: testAddress });
    });
  });

  // ─── Config Backup ────────────────────────────────────────────────────────────

  describe('Config Backup', () => {
    test('configBackup returns a valid response object from the router', async () => {
      const result = await configBackup(CONN, {});
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('configType');
      expect(typeof result.content).toBe('string');
      expect(result.configType).toBe('mikrotik_export');
    });
  });
});
