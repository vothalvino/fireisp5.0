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

  test('throws ValidationError (no router connection) when radiusAddress is a hostname', async () => {
    // RouterOS's /radius `address` accepts an IP only — a DNS name traps on the
    // device ("invalid or unexpected argument base"). We reject it before connecting.
    await expect(
      seedDevice(SEED_NAS, { radiusAddress: 'radius.myisp.net' }),
    ).rejects.toThrow('must be an IP address');
    expect(ros.createClient).not.toHaveBeenCalled();
  });

  test('accepts an IPv6 literal for radiusAddress', async () => {
    const { client } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);
    const result = await seedDevice(SEED_NAS, { radiusAddress: '2001:db8::1' });
    expect(stepStatus(result.steps, 'radius-client')).toBe('created');
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

  test('seeds a walled-garden firewall hook and an ENABLED 80,443 portal redirect by default', async () => {
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
    // With an ENABLED portal redirect, the reject must spare the portal destination
    // so the (off-router) captive portal stays reachable through the forward chain.
    expect(filter).toContain('=dst-address=!203.0.113.10');
    // Permanent redirect (§5): 80+443 → portal:80, laid down live (no disabled=yes).
    const nat = callTo(calls, '/ip/firewall/nat/add');
    expect(nat).toEqual(expect.arrayContaining([
      '=action=dst-nat', '=to-addresses=203.0.113.10', '=dst-port=80,443', '=to-ports=80',
    ]));
    expect(nat).not.toContain('=disabled=yes');
  });

  test('does NOT add a portal exemption to the block rule when there is no portal', async () => {
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);

    await seedDevice(SEED_NAS, { radiusAddress: '203.0.113.10', seedWalledGarden: true });

    const filter = callTo(calls, '/ip/firewall/filter/add');
    expect(filter.some((w) => w.startsWith('=dst-address='))).toBe(false);
  });

  test('does NOT spare the portal when the redirect is laid down disabled', async () => {
    // redirect disabled ⇒ admin owns ordering ⇒ no auto-exemption on the reject.
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);

    await seedDevice(SEED_NAS, {
      radiusAddress: '203.0.113.10', seedWalledGarden: true, portalAddress: '203.0.113.10', redirectEnabled: false,
    });

    const filter = callTo(calls, '/ip/firewall/filter/add');
    expect(filter.some((w) => w.startsWith('=dst-address='))).toBe(false);
  });

  test('honors custom redirect ports and to-port', async () => {
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);

    await seedDevice(SEED_NAS, {
      radiusAddress: '203.0.113.10',
      seedWalledGarden: true,
      portalAddress: '10.0.0.1',
      redirectPorts: '80',
      redirectToPort: 8080,
    });

    const nat = callTo(calls, '/ip/firewall/nat/add');
    expect(nat).toContain('=dst-port=80');
    expect(nat).toContain('=to-ports=8080');
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

  test('lays the portal redirect down disabled on create when redirectEnabled=false, but never re-disables it on a re-run', async () => {
    // First run — rule absent, conservative path → /add carries disabled=yes.
    const fresh = makeSeedClient();
    ros.createClient.mockResolvedValue(fresh.client);
    await seedDevice(SEED_NAS, {
      radiusAddress: '203.0.113.10', seedWalledGarden: true, portalAddress: '203.0.113.10', redirectEnabled: false,
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
      radiusAddress: '203.0.113.10', seedWalledGarden: true, portalAddress: '203.0.113.10', redirectEnabled: false,
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

  // ── §3 fq-codel queue types ────────────────────────────────────────────────
  test('sets default and default-small queue types to fq-codel (§3)', async () => {
    const { client, calls } = makeSeedClient((words) => {
      if (words[0] === '/queue/type/print') {
        const nameQ = words.find((w) => typeof w === 'string' && w.startsWith('?name='));
        const name = nameQ ? nameQ.slice('?name='.length) : '';
        const id = name === 'default' ? '*1' : '*FE';
        return [['!re', `=.id=${id}`, `=name=${name}`, '=kind=pfifo'], ['!done']];
      }
      return null;
    });
    ros.createClient.mockResolvedValue(client);

    const result = await seedDevice(SEED_NAS, { radiusAddress: '203.0.113.10', seedQueueTypes: true });

    expect(stepStatus(result.steps, 'queue-type:default')).toBe('updated');
    expect(stepStatus(result.steps, 'queue-type:default-small')).toBe('updated');
    const sets = calls.filter((c) => c[0] === '/queue/type/set');
    expect(sets).toHaveLength(2);
    expect(sets[0]).toEqual(expect.arrayContaining(['=.id=*1', '=kind=fq-codel']));
  });

  test('reports queue types unchanged when already fq-codel', async () => {
    const { client, calls } = makeSeedClient((words) => {
      if (words[0] === '/queue/type/print') {
        return [['!re', '=.id=*1', '=name=default', '=kind=fq-codel'], ['!done']];
      }
      return null;
    });
    ros.createClient.mockResolvedValue(client);

    const result = await seedDevice(SEED_NAS, { radiusAddress: '203.0.113.10', seedQueueTypes: true });

    expect(stepStatus(result.steps, 'queue-type:default')).toBe('unchanged');
    expect(calls.some((c) => c[0] === '/queue/type/set')).toBe(false);
  });

  test('skips a queue type that is not present on the device', async () => {
    // Default handler → bare !done → no !re rows → readRow null → skipped.
    const { client } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);
    const result = await seedDevice(SEED_NAS, { radiusAddress: '203.0.113.10', seedQueueTypes: true });
    expect(stepStatus(result.steps, 'queue-type:default')).toBe('skipped');
  });

  // ── §4 Business/Residential priority simple queues ─────────────────────────
  test('seeds the Business/Residential priority simple-queue hierarchy (§4)', async () => {
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);

    const result = await seedDevice(SEED_NAS, {
      radiusAddress: '203.0.113.10',
      seedPriorityQueues: true,
      totalDownloadMbps: 1000,
      totalUploadMbps: 1000,
    });

    expect(stepStatus(result.steps, 'priority-queues:pop')).toBe('created');
    expect(stepStatus(result.steps, 'priority-queues:business')).toBe('created');
    expect(stepStatus(result.steps, 'priority-queues:residential')).toBe('created');

    const adds = calls.filter((c) => c[0] === '/queue/simple/add');
    expect(adds).toHaveLength(3);
    // POP master: empty target, no priority on the root node.
    expect(adds[0]).toEqual(expect.arrayContaining(['=name=01-GLOBAL-POP-LIMIT', '=max-limit=1000M/1000M', '=target=']));
    expect(adds[0].some((w) => w.startsWith('=priority='))).toBe(false);
    // Business = dual priority 2/2 under the POP master. /queue/simple priority is a
    // DUAL up/down field on ROS7 (a single "2" is stored "2/8"), so both must be set.
    expect(adds[1]).toEqual(expect.arrayContaining(['=name=02-BUSINESS-CLASS', '=parent=01-GLOBAL-POP-LIMIT', '=priority=2/2']));
    // Residential = priority 5/5.
    expect(adds[2]).toEqual(expect.arrayContaining(['=name=03-RESIDENTIAL-CLASS', '=priority=5/5']));
  });

  test('skips the priority queues when no POP bandwidth is supplied', async () => {
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);
    const result = await seedDevice(SEED_NAS, { radiusAddress: '203.0.113.10', seedPriorityQueues: true });
    expect(stepStatus(result.steps, 'priority-queues')).toBe('skipped');
    expect(calls.some((c) => c[0] === '/queue/simple/add')).toBe(false);
  });

  // ── §2 PPPoE server + base profile ─────────────────────────────────────────
  test('seeds the PPPoE base profile and server, defaulting parent-queue to the POP limit (§2)', async () => {
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);

    const result = await seedDevice(SEED_NAS, {
      radiusAddress: '203.0.113.10',
      seedPriorityQueues: true,
      totalDownloadMbps: 500,
      totalUploadMbps: 500,
      seedPppoeServer: true,
      pppoeInterface: 'ether2',
      pppoeLocalAddress: '10.0.0.1',
    });

    expect(stepStatus(result.steps, 'pppoe-profile')).toBe('created');
    expect(stepStatus(result.steps, 'pppoe-server')).toBe('created');

    const profileAdd = callTo(calls, '/ppp/profile/add');
    expect(profileAdd).toEqual(expect.arrayContaining([
      '=name=fireisp-pppoe', '=change-tcp-mss=yes', '=local-address=10.0.0.1', '=parent-queue=01-GLOBAL-POP-LIMIT',
    ]));
    // The blueprint's invalid "remote-pool" token is never sent (real prop is remote-address).
    expect(profileAdd.some((w) => w.startsWith('=remote-pool='))).toBe(false);

    const serverAdd = callTo(calls, '/interface/pppoe-server/server/add');
    expect(serverAdd).toEqual(expect.arrayContaining([
      '=service-name=FireISP-Internet', '=interface=ether2', '=default-profile=fireisp-pppoe', '=disabled=no',
    ]));
  });

  test('does NOT set profile parent-queue to the POP limit when §4 was skipped for lack of bandwidth', async () => {
    // seedPriorityQueues is on but no POP bandwidth → the POP queue is never created.
    // The profile must NOT reference it, or RouterOS rejects the /ppp/profile/add.
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);

    const result = await seedDevice(SEED_NAS, {
      radiusAddress: '203.0.113.10',
      seedPriorityQueues: true, // flag on…
      // …but no totalDownloadMbps/totalUploadMbps → priority queues skipped
      seedPppoeServer: true,
      pppoeInterface: 'ether2',
    });

    expect(stepStatus(result.steps, 'priority-queues')).toBe('skipped');
    expect(stepStatus(result.steps, 'pppoe-profile')).toBe('created');
    const profileAdd = callTo(calls, '/ppp/profile/add');
    expect(profileAdd.some((w) => w.startsWith('=parent-queue='))).toBe(false);
    // No dangling reference means the server add still succeeds.
    expect(stepStatus(result.steps, 'pppoe-server')).toBe('created');
  });

  test('skips the PPPoE server when no interface is supplied', async () => {
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);
    const result = await seedDevice(SEED_NAS, { radiusAddress: '203.0.113.10', seedPppoeServer: true });
    expect(stepStatus(result.steps, 'pppoe-server')).toBe('skipped');
    expect(calls.some((c) => c[0] === '/ppp/profile/add')).toBe(false);
    expect(calls.some((c) => c[0] === '/interface/pppoe-server/server/add')).toBe(false);
  });

  test('updates the PPPoE server in place on a re-run without re-toggling disabled', async () => {
    const { client, calls } = makeSeedClient((words) => {
      if (words[0] === '/interface/pppoe-server/server/print') {
        return [['!re', '=.id=*3', '=interface=ether2'], ['!done']];
      }
      if (words[0] === '/ppp/profile/print') {
        return [['!re', '=.id=*9', '=name=fireisp-pppoe'], ['!done']];
      }
      return null;
    });
    ros.createClient.mockResolvedValue(client);

    const result = await seedDevice(SEED_NAS, {
      radiusAddress: '203.0.113.10', seedPppoeServer: true, pppoeInterface: 'ether2',
    });

    expect(stepStatus(result.steps, 'pppoe-server')).toBe('updated');
    const serverSet = callTo(calls, '/interface/pppoe-server/server/set');
    expect(serverSet).toContain('=.id=*3');
    expect(serverSet).not.toContain('=disabled=no'); // respect an admin's disabled state on re-run
  });

  // ── Real-time / VoIP priority ──────────────────────────────────────────────
  test('seeds the realtime/VoIP priority chain (mangle + DSCP + priority-1 queue)', async () => {
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);

    const result = await seedDevice(SEED_NAS, {
      radiusAddress: '203.0.113.10',
      seedRealtimePriority: true,
      voipNetworks: '157.240.0.0/16, 142.250.0.0/15',
      realtimeMaxMbps: 50,
    });

    // OTT provider networks land in the fireisp-voip address-list.
    const alAdds = calls.filter((c) => c[0] === '/ip/firewall/address-list/add');
    expect(alAdds).toHaveLength(2);
    expect(alAdds[0]).toEqual(expect.arrayContaining(['=list=fireisp-voip', '=address=157.240.0.0/16']));
    expect(alAdds[1]).toEqual(expect.arrayContaining(['=address=142.250.0.0/15']));

    // Mangle chain: mark-connection (ports/voip-src/voip-dst) → mark-packet → change-dscp.
    const mangleAdds = calls.filter((c) => c[0] === '/ip/firewall/mangle/add');
    const byComment = (frag) => mangleAdds.find((c) => c.includes(`=comment=${frag}`));
    expect(byComment('fireisp-rt-ports')).toEqual(expect.arrayContaining(['=protocol=udp', '=dst-port=5060,5061,10000-20000', '=action=mark-connection']));
    expect(byComment('fireisp-rt-voip-src')).toEqual(expect.arrayContaining(['=src-address-list=fireisp-voip']));
    expect(byComment('fireisp-rt-voip-dst')).toEqual(expect.arrayContaining(['=dst-address-list=fireisp-voip']));
    expect(byComment('fireisp-rt-packet')).toEqual(expect.arrayContaining(['=action=mark-packet', '=new-packet-mark=fireisp-realtime']));
    expect(byComment('fireisp-rt-setdscp')).toEqual(expect.arrayContaining(['=action=change-dscp', '=new-dscp=46']));
    // trust-client-DSCP is OFF by default → no such rule.
    expect(byComment('fireisp-rt-dscp')).toBeUndefined();

    // Priority-1 queue-tree node (single-value priority) with the anti-abuse cap.
    const qAdd = callTo(calls, '/queue/tree/add');
    expect(qAdd).toEqual(expect.arrayContaining([
      '=name=fireisp-realtime', '=parent=global', '=packet-mark=fireisp-realtime', '=priority=1', '=max-limit=50M',
    ]));
    expect(result.ok).toBe(true);
  });

  test('adds the client-DSCP trust rule only when trustClientDscp is set', async () => {
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);
    await seedDevice(SEED_NAS, { radiusAddress: '203.0.113.10', seedRealtimePriority: true, trustClientDscp: true });
    const dscpRule = calls.filter((c) => c[0] === '/ip/firewall/mangle/add')
      .find((c) => c.includes('=comment=fireisp-rt-dscp'));
    expect(dscpRule).toEqual(expect.arrayContaining(['=dscp=46', '=action=mark-connection']));
    // Fresh device: rt-packet not created yet when rt-dscp is added → no place-before needed.
    expect(dscpRule.some((w) => w.startsWith('=place-before='))).toBe(false);
  });

  test('anchors the trust-DSCP rule before rt-packet when enabled on a re-run (ordering)', async () => {
    // Device already has rt-packet (prior seed); now trustClientDscp is turned on.
    // The new rt-dscp mark-connection must be placed BEFORE rt-packet, not appended.
    const { client, calls } = makeSeedClient((words) => {
      if (words[0] === '/ip/firewall/mangle/print' && words.includes('?comment=fireisp-rt-packet')) {
        return [['!re', '=.id=*77', '=comment=fireisp-rt-packet'], ['!done']];
      }
      return null;
    });
    ros.createClient.mockResolvedValue(client);

    await seedDevice(SEED_NAS, { radiusAddress: '203.0.113.10', seedRealtimePriority: true, trustClientDscp: true });

    const dscpAdd = calls.filter((c) => c[0] === '/ip/firewall/mangle/add')
      .find((c) => c.includes('=comment=fireisp-rt-dscp'));
    expect(dscpAdd).toEqual(expect.arrayContaining(['=dscp=46', '=place-before=*77']));
  });

  test('omits the realtime queue cap and address-list when none are given', async () => {
    const { client, calls } = makeSeedClient();
    ros.createClient.mockResolvedValue(client);
    await seedDevice(SEED_NAS, { radiusAddress: '203.0.113.10', seedRealtimePriority: true });
    const qAdd = callTo(calls, '/queue/tree/add');
    expect(qAdd).toEqual(expect.arrayContaining(['=name=fireisp-realtime', '=priority=1']));
    expect(qAdd.some((w) => w.startsWith('=max-limit='))).toBe(false);
    expect(calls.some((c) => c[0] === '/ip/firewall/address-list/add')).toBe(false);
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
