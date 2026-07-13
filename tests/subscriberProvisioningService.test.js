// =============================================================================
// FireISP 5.0 — Subscriber Provisioning Service Tests
// =============================================================================
// Covers PPPoE credential generation, IPv6 line enablement on IPv4 -> DUAL
// upgrades, and duplicate IP-address prevention.
// =============================================================================

const { ConflictError } = require('../src/utils/errors');
const svc = require('../src/services/subscriberProvisioningService');

/** Build a runner whose `query` returns successive mocked results. */
function makeRunner(results) {
  const calls = [];
  const queue = [...results];
  return {
    calls,
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      return queue.length ? queue.shift() : [[]];
    }),
  };
}

describe('subscriberProvisioningService', () => {
  describe('connection-type helpers', () => {
    test('classifies PPPoE / dual / IPv4-only types', () => {
      expect(svc.isPppoe('pppoe')).toBe(true);
      expect(svc.isPppoe('pppoe_dual')).toBe(true);
      expect(svc.isPppoe('static')).toBe(false);
      expect(svc.isDual('pppoe_dual')).toBe(true);
      expect(svc.isDual('dual')).toBe(true);
      expect(svc.isDual('pppoe')).toBe(false);
      expect(svc.isIpv4Only('pppoe')).toBe(true);
      expect(svc.isIpv4Only('static')).toBe(true);
      expect(svc.isIpv4Only('dual')).toBe(false);
    });

    test('isIpv4ToDualUpgrade detects the window change', () => {
      expect(svc.isIpv4ToDualUpgrade('pppoe', 'pppoe_dual')).toBe(true);
      expect(svc.isIpv4ToDualUpgrade('static', 'dual')).toBe(true);
      expect(svc.isIpv4ToDualUpgrade('pppoe', 'pppoe')).toBe(false);
      expect(svc.isIpv4ToDualUpgrade('pppoe_dual', 'pppoe')).toBe(false);
      expect(svc.isIpv4ToDualUpgrade(undefined, 'dual')).toBe(false);
    });
  });

  describe('generatePassword()', () => {
    test('returns a non-empty string of the requested length', () => {
      expect(svc.generatePassword()).toHaveLength(14);
      expect(svc.generatePassword(20)).toHaveLength(20);
      expect(svc.generatePassword()).not.toEqual(svc.generatePassword());
    });
  });

  describe('generatePppoeCredentials()', () => {
    test('generates a unique username when the first candidate is free', async () => {
      const runner = makeRunner([[[]]]); // username lookup -> no collision
      const creds = await svc.generatePppoeCredentials(runner, { seed: 'Acme Corp' });
      expect(creds.username).toMatch(/^acmecorp-[a-z0-9]+$/);
      expect(typeof creds.password).toBe('string');
      expect(creds.password.length).toBeGreaterThanOrEqual(14);
      expect(runner.query).toHaveBeenCalledTimes(1);
    });

    test('retries on username collision', async () => {
      const runner = makeRunner([
        [[{ id: 1 }]], // first candidate taken
        [[]],          // second candidate free
      ]);
      const creds = await svc.generatePppoeCredentials(runner, { seed: 'bob' });
      expect(creds.username).toBeTruthy();
      expect(runner.query).toHaveBeenCalledTimes(2);
    });
  });

  describe('assertUsernameAvailable()', () => {
    test('passes when the username is free', async () => {
      const runner = makeRunner([[[]]]);
      await expect(svc.assertUsernameAvailable(runner, 'alice-01')).resolves.toBeUndefined();
      expect(runner.calls[0].sql).toMatch(/^SELECT id FROM radius WHERE username = \? LIMIT 1$/);
      expect(runner.calls[0].params).toEqual(['alice-01']);
    });

    test('throws ConflictError when the username is already taken', async () => {
      const runner = makeRunner([[[{ id: 4 }]]]);
      await expect(svc.assertUsernameAvailable(runner, 'alice-01'))
        .rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('assertIpAvailable()', () => {
    test('passes when the IP is free', async () => {
      const runner = makeRunner([[[]], [[]]]);
      await expect(svc.assertIpAvailable(runner, { ip: '10.0.0.5', organizationId: 1 })).resolves.toBeUndefined();
    });

    test('throws when another contract owns the IP', async () => {
      const runner = makeRunner([[[{ id: 7 }]]]);
      await expect(svc.assertIpAvailable(runner, { ip: '10.0.0.5' }))
        .rejects.toBeInstanceOf(ConflictError);
    });

    test('throws when an active IP assignment holds the IP', async () => {
      const runner = makeRunner([[[]], [[{ id: 3 }]]]);
      await expect(svc.assertIpAvailable(runner, { ip: '10.0.0.5' }))
        .rejects.toBeInstanceOf(ConflictError);
    });

    test('is a no-op when no IP is supplied', async () => {
      const runner = makeRunner([]);
      await expect(svc.assertIpAvailable(runner, { ip: null })).resolves.toBeUndefined();
      expect(runner.query).not.toHaveBeenCalled();
    });
  });

  describe('provisionNewContract()', () => {
    test('creates a RADIUS account with generated credentials for pppoe', async () => {
      const runner = makeRunner([
        [[]],                       // username uniqueness check
        [[{ id: 11 }]],             // ipv4 pool lookup
        [{ insertId: 99 }],         // radius insert
      ]);
      const result = await svc.provisionNewContract(
        runner,
        { id: 5, client_id: 2, connection_type: 'pppoe', organization_id: 1 },
      );
      expect(result.pppoe.username).toBeTruthy();
      expect(result.pppoe.password).toBeTruthy();
      expect(result.pppoe.radius_id).toBe(99);
      expect(result.pppoe.ipv4_pool_id).toBe(11);
      expect(result.pppoe.ipv6_pool_id).toBeNull();
      const insert = runner.calls.find(c => /INSERT INTO radius/.test(c.sql));
      expect(insert).toBeDefined();
      expect(insert.params).toEqual(expect.arrayContaining([2, 5]));
    });

    test('attaches an IPv6 pool for dual-stack pppoe', async () => {
      const runner = makeRunner([
        [[]],                       // username uniqueness check
        [[{ id: 11 }]],             // ipv4 pool lookup
        [[{ id: 22 }]],             // ipv6 pool lookup
        [{ insertId: 100 }],        // radius insert
      ]);
      const result = await svc.provisionNewContract(
        runner,
        { id: 6, client_id: 2, connection_type: 'pppoe_dual', organization_id: 1 },
      );
      expect(result.pppoe.ipv6_pool_id).toBe(22);
      expect(result.pppoe.ipv6_enabled).toBe(true);
    });

    test('validates static IP uniqueness without creating a RADIUS account', async () => {
      const runner = makeRunner([[[]], [[]]]); // contract + assignment checks both free
      const result = await svc.provisionNewContract(
        runner,
        { id: 7, client_id: 2, connection_type: 'static', ip_address: '192.0.2.10', organization_id: 1 },
      );
      expect(result.pppoe).toBeUndefined();
      expect(result.ip_tracked).toBe('192.0.2.10');
      expect(runner.calls.some(c => /INSERT INTO radius/.test(c.sql))).toBe(false);
    });

    test('rejects a duplicate static IP on creation', async () => {
      const runner = makeRunner([[[{ id: 1 }]]]); // contract already owns the IP
      await expect(svc.provisionNewContract(
        runner,
        { id: 8, client_id: 2, connection_type: 'static', ip_address: '192.0.2.10' },
      )).rejects.toBeInstanceOf(ConflictError);
    });

    test('uses caller-supplied username+password when both are provided, skipping generatePppoeCredentials', async () => {
      const runner = makeRunner([
        [[]],                       // assertUsernameAvailable — free
        [[{ id: 11 }]],             // ipv4 pool lookup
        [{ insertId: 200 }],        // radius insert
      ]);
      const result = await svc.provisionNewContract(
        runner,
        { id: 12, client_id: 3, connection_type: 'pppoe', organization_id: 1 },
        { pppoeUsername: 'carried-over', pppoePassword: 'S3cretPass!' },
      );
      expect(result.pppoe.username).toBe('carried-over');
      expect(result.pppoe.password).toBe('S3cretPass!');
      // Exactly 3 queries total (uniqueness check + pool lookup + insert) —
      // generatePppoeCredentials's own retry-loop query never ran.
      expect(runner.query).toHaveBeenCalledTimes(3);
      const uniquenessCheck = runner.calls[0];
      expect(uniquenessCheck.sql).toMatch(/^SELECT id FROM radius WHERE username = \? LIMIT 1$/);
      expect(uniquenessCheck.params).toEqual(['carried-over']);
      const insert = runner.calls.find(c => /INSERT INTO radius/.test(c.sql));
      expect(insert.params).toEqual(expect.arrayContaining(['carried-over', 'S3cretPass!']));
    });

    test('falls back to generatePppoeCredentials when neither pppoeUsername nor pppoePassword is supplied', async () => {
      const runner = makeRunner([
        [[]],                       // generatePppoeCredentials's username uniqueness check
        [[{ id: 11 }]],             // ipv4 pool lookup
        [{ insertId: 201 }],        // radius insert
      ]);
      const result = await svc.provisionNewContract(
        runner,
        { id: 13, client_id: 3, connection_type: 'pppoe', organization_id: 1 },
        {},
      );
      expect(result.pppoe.username).not.toBe('carried-over');
      expect(result.pppoe.username).toBeTruthy();
      expect(result.pppoe.password).toBeTruthy();
    });

    test('rejects a duplicate caller-supplied username with ConflictError, without an INSERT INTO radius', async () => {
      const runner = makeRunner([[[{ id: 9 }]]]); // assertUsernameAvailable — already taken
      await expect(svc.provisionNewContract(
        runner,
        { id: 14, client_id: 3, connection_type: 'pppoe', organization_id: 1 },
        { pppoeUsername: 'taken-user', pppoePassword: 'whatever' },
      )).rejects.toBeInstanceOf(ConflictError);
      expect(runner.calls.some(c => /INSERT INTO radius/.test(c.sql))).toBe(false);
    });
  });

  describe('enableIpv6Line()', () => {
    test('attaches an IPv6 pool to an existing RADIUS account', async () => {
      const runner = makeRunner([
        [[{ id: 50, ipv6_pool_id: null }]], // radius lookup
        [[{ id: 22 }]],                     // ipv6 pool lookup
        [{ affectedRows: 1 }],              // radius update
      ]);
      const result = await svc.enableIpv6Line(runner, { id: 9, organization_id: 1 });
      expect(result.ipv6_enabled).toBe(true);
      expect(result.radius).toBe(true);
      expect(result.ipv6_pool_id).toBe(22);
      const update = runner.calls.find(c => /UPDATE radius SET ipv6_pool_id/.test(c.sql));
      expect(update.params).toEqual([22, 'active', 50]);
    });

    test('reports a static dual upgrade when no RADIUS account exists', async () => {
      const runner = makeRunner([[[]]]); // no radius row
      const result = await svc.enableIpv6Line(runner, { id: 10, organization_id: 1 });
      expect(result).toEqual({ ipv6_enabled: true, radius: false });
    });
  });
});
