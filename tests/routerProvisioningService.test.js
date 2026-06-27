// =============================================================================
// FireISP 5.0 — Router Provisioning Service Tests
// =============================================================================
// Covers nasToConn (default port, decrypt usage, validation), testConnection
// (parses /system/resource/print + best-effort identity) and pushSubscriber
// (delegates to ros.pppoeUpsert). routerosService and encryption are mocked so
// no real RouterOS connection or crypto runs.
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

jest.mock('../src/services/routerosService');
jest.mock('../src/utils/encryption');

const ros = require('../src/services/routerosService');
const { decrypt } = require('../src/utils/encryption');
const {
  nasToConn,
  testConnection,
  pushSubscriber,
  seedDevice,
} = require('../src/services/routerProvisioningService');

// The real DEFAULT_PORT constant the service falls back to.
const DEFAULT_PORT = 8728;

beforeEach(() => {
  jest.clearAllMocks();
  // The mocked routerosService loses its real DEFAULT_PORT export — restore it.
  ros.DEFAULT_PORT = DEFAULT_PORT;
  // By default decrypt is the identity function (passthrough).
  decrypt.mockImplementation((v) => v);
});

const BASE_NAS = {
  ip_address: '10.0.0.1',
  api_username: 'apiuser',
  api_password_encrypted: 'enc:secret',
  api_use_tls: 0,
};

// =============================================================================
// nasToConn
// =============================================================================

describe('nasToConn', () => {
  test('builds a connection descriptor with the default port when api_port is unset', () => {
    const conn = nasToConn({ ...BASE_NAS });

    expect(conn).toEqual({
      host: '10.0.0.1',
      port: DEFAULT_PORT,
      user: 'apiuser',
      password: 'enc:secret',
      secure: false,
      timeoutMs: 12000,
    });
  });

  test('uses the configured api_port when present', () => {
    const conn = nasToConn({ ...BASE_NAS, api_port: 8729 });
    expect(conn.port).toBe(8729);
  });

  test('decrypts the stored api password', () => {
    decrypt.mockReturnValue('plain-pass');

    const conn = nasToConn({ ...BASE_NAS });

    expect(decrypt).toHaveBeenCalledWith('enc:secret');
    expect(conn.password).toBe('plain-pass');
  });

  test('falls back to empty string when decrypt yields a falsy value', () => {
    decrypt.mockReturnValue(null);

    const conn = nasToConn({ ...BASE_NAS, api_password_encrypted: null });

    expect(conn.password).toBe('');
  });

  test('sets secure=true when api_use_tls is truthy', () => {
    const conn = nasToConn({ ...BASE_NAS, api_use_tls: 1 });
    expect(conn.secure).toBe(true);
  });

  test('throws ValidationError when nas is null', () => {
    expect(() => nasToConn(null)).toThrow('NAS has no IP address configured');
  });

  test('throws ValidationError naming the IP address when ip_address is missing', () => {
    expect(() => nasToConn({ ...BASE_NAS, ip_address: undefined }))
      .toThrow('NAS has no IP address configured');
  });

  test('throws ValidationError naming the API username when api_username is missing', () => {
    expect(() => nasToConn({ ...BASE_NAS, api_username: undefined }))
      .toThrow('NAS has no RouterOS API username configured');
  });
});

// =============================================================================
// testConnection
// =============================================================================

describe('testConnection', () => {
  function makeClient(runImpl) {
    return {
      run: jest.fn(runImpl),
      close: jest.fn().mockResolvedValue(undefined),
    };
  }

  test('parses version, board-name and identity from the router', async () => {
    ros.parseAttrs.mockImplementation((words) => {
      const obj = {};
      for (const w of words) {
        const eq = w.indexOf('=', 1);
        if (w.startsWith('=') && eq !== -1) obj[w.slice(1, eq)] = w.slice(eq + 1);
      }
      return obj;
    });

    const client = makeClient((words) => {
      if (words[0] === '/system/resource/print') {
        return Promise.resolve([
          ['!re', '=version=7.14.3', '=board-name=hAP ax3'],
          ['!done'],
        ]);
      }
      if (words[0] === '/system/identity/print') {
        return Promise.resolve([['!re', '=name=core-router'], ['!done']]);
      }
      return Promise.resolve([['!done']]);
    });
    ros.createClient.mockResolvedValue(client);

    const result = await testConnection({ ...BASE_NAS });

    expect(result).toEqual({
      ok: true,
      host: '10.0.0.1',
      port: DEFAULT_PORT,
      tls: false,
      version: '7.14.3',
      boardName: 'hAP ax3',
      identity: 'core-router',
    });
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  test('still succeeds when the identity probe fails', async () => {
    ros.parseAttrs.mockImplementation((words) => {
      const obj = {};
      for (const w of words) {
        const eq = w.indexOf('=', 1);
        if (w.startsWith('=') && eq !== -1) obj[w.slice(1, eq)] = w.slice(eq + 1);
      }
      return obj;
    });

    const client = makeClient((words) => {
      if (words[0] === '/system/resource/print') {
        return Promise.resolve([['!re', '=version=7.1'], ['!done']]);
      }
      return Promise.reject(new Error('identity blocked'));
    });
    ros.createClient.mockResolvedValue(client);

    const result = await testConnection({ ...BASE_NAS });

    expect(result.version).toBe('7.1');
    expect(result.identity).toBe('');
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  test('closes the client even when the resource probe throws', async () => {
    const client = makeClient(() => Promise.reject(new Error('boom')));
    ros.createClient.mockResolvedValue(client);

    await expect(testConnection({ ...BASE_NAS })).rejects.toThrow('boom');
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  test('propagates connection errors from createClient', async () => {
    ros.createClient.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(testConnection({ ...BASE_NAS })).rejects.toThrow('ECONNREFUSED');
  });
});

// =============================================================================
// pushSubscriber
// =============================================================================

describe('pushSubscriber', () => {
  test('delegates to ros.pppoeUpsert with name=username, secretPassword=password, service=pppoe', async () => {
    ros.pppoeUpsert.mockResolvedValue({ id: '*1', created: true, updated: false });

    const result = await pushSubscriber(
      { ...BASE_NAS, api_port: 8729 },
      { username: 'sub1', password: 'pw1', profile: 'gold', comment: 'note' },
    );

    expect(result).toEqual({ id: '*1', created: true, updated: false });
    expect(ros.pppoeUpsert).toHaveBeenCalledTimes(1);

    const [conn, params] = ros.pppoeUpsert.mock.calls[0];
    expect(conn).toEqual({
      host: '10.0.0.1',
      port: 8729,
      user: 'apiuser',
      password: 'enc:secret',
      secure: false,
      timeoutMs: 12000,
    });
    expect(params).toEqual({
      name: 'sub1',
      secretPassword: 'pw1',
      profile: 'gold',
      comment: 'note',
      service: 'pppoe',
    });
  });

  test('throws when the NAS has no api_username (via nasToConn)', async () => {
    await expect(
      pushSubscriber({ ...BASE_NAS, api_username: undefined }, { username: 'x', password: 'y' }),
    ).rejects.toThrow('NAS has no RouterOS API username configured');
    expect(ros.pppoeUpsert).not.toHaveBeenCalled();
  });
});

// =============================================================================
// seedDevice
// =============================================================================

describe('seedDevice', () => {
  const SEED_NAS = { ...BASE_NAS, secret: 'radsecret', coa_port: 3799 };

  // Real parseAttrs so the findId mock can pull `.id` out of !re sentences.
  function realParseAttrs(words) {
    const obj = {};
    for (const w of words) {
      if (typeof w !== 'string') continue;
      const eq = w.indexOf('=', 1);
      if (w.startsWith('=') && eq !== -1) obj[w.slice(1, eq)] = w.slice(eq + 1);
    }
    return obj;
  }

  // Real rosBool — seedDevice reads API booleans ("true"/"false") through it.
  function realRosBool(value) {
    if (value === true) return true;
    if (typeof value !== 'string') return false;
    const v = value.trim().toLowerCase();
    return v === 'true' || v === 'yes';
  }

  // Fake client recording every command. `handler` decides each command's reply;
  // anything it doesn't answer defaults to a bare !done (printed → "not found").
  function makeSeedClient(handler = () => null) {
    const calls = [];
    const client = {
      run: jest.fn(async (words) => {
        calls.push(words);
        const reply = handler(words);
        return reply || [['!done']];
      }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    return { client, calls };
  }

  const callTo = (calls, path) => calls.find((c) => c[0] === path);
  const stepStatus = (steps, name) => (steps.find((s) => s.step === name) || {}).status;

  beforeEach(() => {
    ros.parseAttrs.mockImplementation(realParseAttrs);
    ros.rosBool.mockImplementation(realRosBool);
    // upsertByComment now delegates the .id lookup to ros.findId (deduped into
    // routerosService). routerosService is mocked here, so supply the real scan
    // behaviour against the mock client's replies.
    ros.findId.mockImplementation(async (client, basePath, queries = []) => {
      const sentences = await client.run([`${basePath}/print`, ...queries]);
      for (const s of sentences) {
        if (s[0] === '!re') {
          const a = realParseAttrs(s.slice(1));
          if (a['.id']) return a['.id'];
        }
      }
      return null;
    });
  });

  test('throws ValidationError (no router connection) when radiusAddress is missing', async () => {
    await expect(seedDevice(SEED_NAS, {})).rejects.toThrow('radiusAddress is required');
    expect(ros.createClient).not.toHaveBeenCalled();
  });

  test('throws ValidationError when the NAS has no RADIUS secret', async () => {
    await expect(
      seedDevice({ ...SEED_NAS, secret: undefined }, { radiusAddress: '203.0.113.10' }),
    ).rejects.toThrow('no RADIUS shared secret');
    expect(ros.createClient).not.toHaveBeenCalled();
  });

  test('creates the RADIUS client, CoA listener and PPP AAA on a fresh router', async () => {
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);

    const result = await seedDevice(SEED_NAS, { radiusAddress: '203.0.113.10' });

    expect(result.ok).toBe(true);
    expect(stepStatus(result.steps, 'radius-client')).toBe('created');
    expect(stepStatus(result.steps, 'radius-incoming')).toBe('updated');
    expect(stepStatus(result.steps, 'ppp-aaa')).toBe('updated');

    // RADIUS client added with the NAS secret + service=ppp pointing at FireISP.
    const add = callTo(calls, '/radius/add');
    expect(add).toContain('=service=ppp');
    expect(add).toContain('=address=203.0.113.10');
    expect(add).toContain('=secret=radsecret');
    expect(add).toContain('=comment=fireisp-radius');

    // CoA listener + AAA toggled on.
    expect(callTo(calls, '/radius/incoming/set')).toEqual(
      expect.arrayContaining(['=accept=yes', '=port=3799']),
    );
    expect(callTo(calls, '/ppp/aaa/set')).toEqual(
      expect.arrayContaining(['=use-radius=yes', '=accounting=yes', '=interim-update=5m']),
    );
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  test('is idempotent — updates the existing tagged RADIUS entry instead of adding', async () => {
    const { client, calls } = makeSeedClient((words) => {
      if (words[0] === '/radius/print') return [['!re', '=.id=*5', '=comment=fireisp-radius'], ['!done']];
      return null;
    });
    ros.createClient.mockResolvedValue(client);

    const result = await seedDevice(SEED_NAS, { radiusAddress: '203.0.113.10' });

    expect(stepStatus(result.steps, 'radius-client')).toBe('updated');
    const set = callTo(calls, '/radius/set');
    expect(set).toContain('=.id=*5');
    expect(set).toContain('=address=203.0.113.10');
    expect(callTo(calls, '/radius/add')).toBeUndefined();
  });

  test('seeds a queue-tree skeleton when requested (Mbps → RouterOS rate string)', async () => {
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);

    const result = await seedDevice(SEED_NAS, {
      radiusAddress: '203.0.113.10',
      seedQueueTree: true,
      queueParent: 'global',
      totalDownloadMbps: 500,
      totalUploadMbps: 200,
    });

    expect(stepStatus(result.steps, 'queue-tree:download')).toBe('created');
    expect(stepStatus(result.steps, 'queue-tree:upload')).toBe('created');
    const adds = calls.filter((c) => c[0] === '/queue/tree/add');
    expect(adds).toHaveLength(2);
    expect(adds[0]).toEqual(expect.arrayContaining(['=name=fireisp-total-download', '=parent=global', '=max-limit=500M']));
    expect(adds[1]).toEqual(expect.arrayContaining(['=name=fireisp-total-upload', '=max-limit=200M']));
  });

  test('skips the queue tree when enabled but no bandwidth is supplied', async () => {
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);

    const result = await seedDevice(SEED_NAS, { radiusAddress: '203.0.113.10', seedQueueTree: true });

    expect(stepStatus(result.steps, 'queue-tree')).toBe('skipped');
    expect(calls.find((c) => c[0] === '/queue/tree/add')).toBeUndefined();
  });

  test('seeds a walled-garden firewall hook and a DISABLED portal redirect', async () => {
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);

    const result = await seedDevice(SEED_NAS, {
      radiusAddress: '203.0.113.10',
      seedWalledGarden: true,
      suspendedListName: 'fireisp-suspended',
      portalAddress: '203.0.113.10',
    });

    expect(stepStatus(result.steps, 'walled-garden:block')).toBe('created');
    const filter = callTo(calls, '/ip/firewall/filter/add');
    expect(filter).toEqual(expect.arrayContaining([
      '=chain=forward', '=src-address-list=fireisp-suspended', '=action=reject',
    ]));
    // Portal redirect is laid down but disabled (admin must order it correctly).
    const nat = callTo(calls, '/ip/firewall/nat/add');
    expect(nat).toEqual(expect.arrayContaining(['=action=dst-nat', '=to-addresses=203.0.113.10', '=disabled=yes']));
  });

  test('captures a per-step RouterOS error without aborting the rest', async () => {
    const { client } = makeSeedClient((words) => {
      if (words[0] === '/ppp/aaa/set') throw new Error('no permission (9)');
      return null;
    });
    ros.createClient.mockResolvedValue(client);

    const result = await seedDevice(SEED_NAS, { radiusAddress: '203.0.113.10' });

    expect(result.ok).toBe(false);
    expect(stepStatus(result.steps, 'radius-client')).toBe('created'); // still ran
    expect(stepStatus(result.steps, 'ppp-aaa')).toBe('error');
    expect(result.steps.find((s) => s.step === 'ppp-aaa').detail).toMatch(/no permission/);
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  test('propagates connection errors from createClient (router unreachable)', async () => {
    ros.createClient.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(seedDevice(SEED_NAS, { radiusAddress: '203.0.113.10' })).rejects.toThrow('ECONNREFUSED');
  });

  test('skips a queue node whose Mbps is 0 (never emits max-limit=0 = unlimited)', async () => {
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);

    const result = await seedDevice(SEED_NAS, {
      radiusAddress: '203.0.113.10',
      seedQueueTree: true,
      totalDownloadMbps: 0,   // operator typed 0 — must be skipped, not max-limit=0M
      totalUploadMbps: 200,
    });

    expect(result.steps.find((s) => s.step === 'queue-tree:download')).toBeUndefined();
    expect(stepStatus(result.steps, 'queue-tree:upload')).toBe('created');
    const adds = calls.filter((c) => c[0] === '/queue/tree/add');
    expect(adds).toHaveLength(1);
    expect(adds[0]).toEqual(expect.arrayContaining(['=name=fireisp-total-upload', '=max-limit=200M']));
    expect(calls.some((c) => c.includes('=max-limit=0M'))).toBe(false);
  });

  test('records queue-tree skipped when both totals are 0', async () => {
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);

    const result = await seedDevice(SEED_NAS, {
      radiusAddress: '203.0.113.10', seedQueueTree: true, totalDownloadMbps: 0, totalUploadMbps: 0,
    });

    expect(stepStatus(result.steps, 'queue-tree')).toBe('skipped');
    expect(calls.find((c) => c[0] === '/queue/tree/add')).toBeUndefined();
  });

  test('inserts the walled-garden block at the TOP of the forward chain (place-before)', async () => {
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);

    await seedDevice(SEED_NAS, { radiusAddress: '203.0.113.10', seedWalledGarden: true });

    const filterAdd = callTo(calls, '/ip/firewall/filter/add');
    expect(filterAdd).toContain('=place-before=0');
  });

  test('lays the portal redirect down disabled on create, but never re-disables it on a re-run', async () => {
    // First run — rule absent → /add carries disabled=yes.
    const fresh = makeSeedClient();
    ros.createClient.mockResolvedValue(fresh.client);
    await seedDevice(SEED_NAS, {
      radiusAddress: '203.0.113.10', seedWalledGarden: true, portalAddress: '203.0.113.10',
    });
    expect(callTo(fresh.calls, '/ip/firewall/nat/add')).toContain('=disabled=yes');

    // Re-run — rule exists (matched by comment) → /set must NOT carry disabled,
    // or it would silently turn off a redirect the admin has since enabled.
    const rerun = makeSeedClient((words) => {
      if (words[0] === '/ip/firewall/nat/print') {
        return [['!re', '=.id=*7', '=comment=fireisp-suspended-redirect'], ['!done']];
      }
      return null;
    });
    ros.createClient.mockResolvedValue(rerun.client);
    await seedDevice(SEED_NAS, {
      radiusAddress: '203.0.113.10', seedWalledGarden: true, portalAddress: '203.0.113.10',
    });
    const natSet = callTo(rerun.calls, '/ip/firewall/nat/set');
    expect(natSet).toBeDefined();
    expect(natSet).not.toContain('=disabled=yes');
    expect(callTo(rerun.calls, '/ip/firewall/nat/add')).toBeUndefined();
  });

  test('reports radius-incoming and ppp-aaa as unchanged when already configured', async () => {
    const { client } = makeSeedClient((words) => {
      // The ROS API reports booleans as "true"/"false" (not the CLI's yes/no).
      if (words[0] === '/radius/incoming/print') {
        return [['!re', '=accept=true', '=port=3799'], ['!done']];
      }
      if (words[0] === '/ppp/aaa/print') {
        return [['!re', '=use-radius=true', '=accounting=true', '=interim-update=5m'], ['!done']];
      }
      return null;
    });
    ros.createClient.mockResolvedValue(client);

    const result = await seedDevice(SEED_NAS, { radiusAddress: '203.0.113.10' });

    expect(stepStatus(result.steps, 'radius-incoming')).toBe('unchanged');
    expect(stepStatus(result.steps, 'ppp-aaa')).toBe('unchanged');
  });

  test('flags when ppp-aaa overrides a deliberate accounting=no', async () => {
    const { client } = makeSeedClient((words) => {
      // accounting=false is how the API reports a deliberate accounting=no.
      if (words[0] === '/ppp/aaa/print') {
        return [['!re', '=use-radius=false', '=accounting=false', '=interim-update=0s'], ['!done']];
      }
      return null;
    });
    ros.createClient.mockResolvedValue(client);

    const result = await seedDevice(SEED_NAS, { radiusAddress: '203.0.113.10' });

    const ppp = result.steps.find((s) => s.step === 'ppp-aaa');
    expect(ppp.status).toBe('updated');
    expect(ppp.detail).toMatch(/overrode accounting=no/);
  });

  test('trims radiusAddress before pushing it to the RADIUS client =address=', async () => {
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);

    await seedDevice(SEED_NAS, { radiusAddress: '  203.0.113.10  ' });

    const add = callTo(calls, '/radius/add');
    expect(add).toContain('=address=203.0.113.10');
    expect(add).not.toContain('=address=  203.0.113.10  ');
  });

  test('trims portalAddress before pushing it to the redirect =to-addresses=', async () => {
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);

    await seedDevice(SEED_NAS, {
      radiusAddress: '203.0.113.10', seedWalledGarden: true, portalAddress: '  10.0.0.1  ',
    });

    const nat = callTo(calls, '/ip/firewall/nat/add');
    expect(nat).toContain('=to-addresses=10.0.0.1');
  });

  test('aborts (rejects) when a step hits a lost connection, so the route can map it to 502', async () => {
    const dropped = Object.assign(new Error('RouterOS connection closed'), { routerUnreachable: true });
    const { client } = makeSeedClient((words) => {
      if (words[0] === '/radius/print') throw dropped; // first managed op loses the link
      return null;
    });
    ros.createClient.mockResolvedValue(client);

    await expect(seedDevice(SEED_NAS, { radiusAddress: '203.0.113.10' }))
      .rejects.toThrow('RouterOS connection closed');
    expect(client.close).toHaveBeenCalledTimes(1); // finally still closed the client
  });
});
