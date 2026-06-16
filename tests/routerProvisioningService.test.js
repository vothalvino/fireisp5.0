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
    expect(() => nasToConn(null)).toThrow('NAS has no RouterOS API username configured');
  });

  test('throws ValidationError when ip_address is missing', () => {
    expect(() => nasToConn({ ...BASE_NAS, ip_address: undefined }))
      .toThrow('NAS has no RouterOS API username configured');
  });

  test('throws ValidationError when api_username is missing', () => {
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
