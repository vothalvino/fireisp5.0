// =============================================================================
// FireISP 5.0 — CoA / Disconnect NAS targeting tests
// =============================================================================
// Authentication is NAS-agnostic (any registered NAS can authenticate any
// account), so CoA/Disconnect must follow the subscriber to the NAS its open
// sessions actually live on (connection_logs), with the home NAS
// (radius.nas_id) as a safety net — not blindly target the home NAS.
//
// dgram is mocked with a fake socket that records every outbound packet and
// answers with the matching ACK code, so the full send path (target
// resolution → attribute encoding → UDP dispatch → response handling) runs
// without real network I/O or 5s timeouts.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

// Outbound packets recorded by the fake dgram socket, per-address behavior
// overrides ('ack' default | 'nak' | 'error' | 'silent'), and per-address
// shared secrets so replies carry a VALID Response Authenticator — the send
// path now verifies MD5(Code+ID+Length+RequestAuth+Attrs+Secret) and ignores
// replies that fail it, so an unauthenticated fake reply reads as silence.
const mockSentPackets = [];
const mockNasBehavior = {};
const mockNasSecrets = {};

jest.mock('dgram', () => ({
  createSocket: jest.fn(() => {
    const crypto = require('crypto');
    const handlers = {};
    return {
      on: (event, cb) => { handlers[event] = cb; },
      close: () => {},
      send: (buf, port, address) => {
        mockSentPackets.push({ buf: Buffer.from(buf), port, address });
        const behavior = mockNasBehavior[address] || 'ack';
        // Microtask, not setImmediate — handlers are registered synchronously
        // before send(), and the test eslint config has no node globals.
        Promise.resolve().then(() => {
          if (behavior === 'error') {
            if (handlers.error) handlers.error(new Error('EHOSTUNREACH'));
            return;
          }
          if (behavior === 'silent') return; // dead NAS / wrong secret — no reply
          // Disconnect-Request (40) → ACK 41 / NAK 42; CoA (43) → ACK 44 / NAK 45
          const respCode = behavior === 'nak'
            ? (buf[0] === 40 ? 42 : 45)
            : (buf[0] === 40 ? 41 : 44);
          const resp = Buffer.alloc(20);
          resp[0] = respCode;
          resp[1] = buf[1];
          resp.writeUInt16BE(20, 2);
          const md5 = crypto.createHash('md5');
          md5.update(resp.subarray(0, 4));
          md5.update(buf.subarray(4, 20)); // echo the Request Authenticator
          md5.update(Buffer.from(mockNasSecrets[address] || '', 'utf8'));
          md5.digest().copy(resp, 4);
          if (handlers.message) handlers.message(resp);
        });
      },
    };
  }),
}));

const db = require('../src/config/database');
const suspensionService = require('../src/services/suspensionService');

/** Parse the attribute TLVs out of a raw RADIUS packet (skips 20-byte header). */
function parseAttrs(buf) {
  const attrs = [];
  let off = 20;
  while (off < buf.length) {
    const type = buf[off];
    const len = buf[off + 1];
    attrs.push({ type, value: buf.slice(off + 2, off + len) });
    off += len;
  }
  return attrs;
}

const nasRow = (id, ip, overrides = {}) => {
  const row = {
    id,
    ip_address: ip,
    coa_port: 3799,
    secret: `secret-${id}`,
    secondary_nas_id: null,
    ...overrides,
  };
  // Register the secret so the fake socket can authenticate its reply.
  mockNasSecrets[ip] = row.secret;
  return row;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSentPackets.length = 0;
  for (const key of Object.keys(mockNasBehavior)) delete mockNasBehavior[key];
  for (const key of Object.keys(mockNasSecrets)) delete mockNasSecrets[key];
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// resolveCoaTargets
// ---------------------------------------------------------------------------
describe('resolveCoaTargets()', () => {
  test('roaming: returns the open-session NAS plus the home NAS', async () => {
    db.query
      .mockResolvedValueOnce([[nasRow(2, '10.0.0.2')]])   // open-session NASes
      .mockResolvedValueOnce([[nasRow(1, '10.0.0.1')]]);  // home NAS lookup
    const targets = await suspensionService.resolveCoaTargets({
      username: 'roamer', nas_id: 1, organization_id: 1,
    });
    expect(targets.map((t) => t.id)).toEqual([2, 1]);
    expect(db.query).toHaveBeenCalledTimes(2);
    // Session query filters open sessions for the username
    const sessionSql = db.query.mock.calls[0][0];
    expect(db.query.mock.calls[0][1]).toEqual([1, 'roamer']);
    expect(sessionSql).toMatch(/interim-update/);
    // The NAS join must be an UNGATED OR: FreeRADIUS-SQL recipes historically
    // stamped nas_id with the HOME NAS, so a `cl.nas_id IS NULL` gate on the
    // ip_address branch would re-create the home-NAS-only targeting bug.
    expect(sessionSql).toMatch(/n\.id = cl\.nas_id OR n\.ip_address = cl\.nas_ip_address/);
    expect(sessionSql).not.toMatch(/nas_id IS NULL/);
    expect(sessionSql).toMatch(/cl\.organization_id = \?/);
    expect(sessionSql).toMatch(/DATE_SUB\(NOW\(\), INTERVAL 60 MINUTE\)/);
    expect(db.query.mock.calls[1][1]).toEqual([1, 1]);
  });

  test('home NAS already among session NASes is not duplicated (no second lookup)', async () => {
    db.query.mockResolvedValueOnce([[nasRow(1, '10.0.0.1')]]);
    const targets = await suspensionService.resolveCoaTargets({
      username: 'u', nas_id: 1, organization_id: 1,
    });
    expect(targets).toHaveLength(1);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('no open sessions falls back to the home NAS alone', async () => {
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[nasRow(1, '10.0.0.1')]]);
    const targets = await suspensionService.resolveCoaTargets({
      username: 'u', nas_id: 1, organization_id: 1,
    });
    expect(targets.map((t) => t.id)).toEqual([1]);
  });

  test('no sessions and no home NAS returns an empty target list', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const targets = await suspensionService.resolveCoaTargets({
      username: 'u', nas_id: null, organization_id: 1,
    });
    expect(targets).toEqual([]);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// sendRadiusDisconnect
// ---------------------------------------------------------------------------
describe('sendRadiusDisconnect()', () => {
  test('no RADIUS account → early return after a single query, nothing sent', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const r = await suspensionService.sendRadiusDisconnect(7);
    expect(r).toEqual({ sent: false, response: 'No RADIUS account found for contract', outcome: 'no_account' });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(mockSentPackets).toHaveLength(0);
  });

  test('roaming subscriber: Disconnect goes to BOTH the session NAS and the home NAS', async () => {
    db.query
      .mockResolvedValueOnce([[{ username: 'roamer', nas_id: 1, organization_id: 1 }]]) // account
      .mockResolvedValueOnce([[nasRow(2, '10.0.0.2')]])                       // session NAS
      .mockResolvedValueOnce([[nasRow(1, '10.0.0.1', { coa_port: 1700 })]]); // home NAS
    const r = await suspensionService.sendRadiusDisconnect(7);
    expect(r.sent).toBe(true);
    const addrs = mockSentPackets.map((p) => `${p.address}:${p.port}`).sort();
    expect(addrs).toEqual(['10.0.0.1:1700', '10.0.0.2:3799']);
    for (const p of mockSentPackets) {
      expect(p.buf[0]).toBe(40); // Disconnect-Request
      const userName = parseAttrs(p.buf).find((a) => a.type === 1);
      expect(userName.value.toString()).toBe('roamer');
    }
    // Multi-target response reports per-NAS results
    expect(r.response).toContain('10.0.0.2: Disconnect-ACK');
    expect(r.response).toContain('10.0.0.1: Disconnect-ACK');
  });

  test('single target keeps the bare response string', async () => {
    db.query
      .mockResolvedValueOnce([[{ username: 'u', nas_id: null, organization_id: 1 }]])
      .mockResolvedValueOnce([[nasRow(2, '10.0.0.2')]]);
    const r = await suspensionService.sendRadiusDisconnect(7);
    expect(r).toEqual({ sent: true, response: 'Disconnect-ACK', outcome: 'ack' });
  });

  test('per-session targeting sends only to that NAS and includes Acct-Session-Id', async () => {
    db.query
      .mockResolvedValueOnce([[{ username: 'u', nas_id: 1, organization_id: 1 }]])
      .mockResolvedValueOnce([[nasRow(2, '10.0.0.2')]]); // NAS-by-ip lookup
    const r = await suspensionService.sendRadiusDisconnect(7, {
      acctSessionId: '8100000a',
      nasIpAddress: '10.0.0.2',
    });
    expect(r.sent).toBe(true);
    expect(db.query).toHaveBeenCalledTimes(2); // account + NAS by ip (no session resolution)
    expect(db.query.mock.calls[1][1]).toEqual([1, '10.0.0.2']);
    expect(mockSentPackets).toHaveLength(1);
    expect(mockSentPackets[0].address).toBe('10.0.0.2');
    const attrs = parseAttrs(mockSentPackets[0].buf);
    expect(attrs.find((a) => a.type === 1).value.toString()).toBe('u');
    expect(attrs.find((a) => a.type === 44).value.toString()).toBe('8100000a');
  });

  test('per-session targeting with an unregistered NAS falls back to resolved targets', async () => {
    db.query
      .mockResolvedValueOnce([[{ username: 'u', nas_id: 1, organization_id: 1 }]])
      .mockResolvedValueOnce([[]])                        // NAS-by-ip: not registered
      .mockResolvedValueOnce([[]])                        // no open-session NASes
      .mockResolvedValueOnce([[nasRow(1, '10.0.0.1')]]);  // home NAS safety net
    const r = await suspensionService.sendRadiusDisconnect(7, {
      acctSessionId: 'x',
      nasIpAddress: '203.0.113.9',
    });
    expect(r.sent).toBe(true);
    expect(mockSentPackets).toHaveLength(1);
    expect(mockSentPackets[0].address).toBe('10.0.0.1');
    // Still narrowed to the one session
    const attrs = parseAttrs(mockSentPackets[0].buf);
    expect(attrs.find((a) => a.type === 44).value.toString()).toBe('x');
  });

  test('per-session targeting with an unregistered NAS and no fallback targets returns sent:false', async () => {
    db.query
      .mockResolvedValueOnce([[{ username: 'u', nas_id: null, organization_id: 1 }]])
      .mockResolvedValueOnce([[]])  // NAS-by-ip: not registered
      .mockResolvedValueOnce([[]]); // no open-session NASes, no home NAS
    const r = await suspensionService.sendRadiusDisconnect(7, {
      acctSessionId: 'x',
      nasIpAddress: '203.0.113.9',
    });
    expect(r.sent).toBe(false);
    expect(r.response).toMatch(/No target NAS/);
    expect(mockSentPackets).toHaveLength(0);
  });

  test('acctSessionId without nasIpAddress still narrows via Acct-Session-Id on resolved targets', async () => {
    db.query
      .mockResolvedValueOnce([[{ username: 'u', nas_id: null, organization_id: 1 }]])
      .mockResolvedValueOnce([[nasRow(2, '10.0.0.2')]]); // session NASes
    const r = await suspensionService.sendRadiusDisconnect(7, { acctSessionId: 'sess42' });
    expect(r.sent).toBe(true);
    const attrs = parseAttrs(mockSentPackets[0].buf);
    expect(attrs.find((a) => a.type === 44).value.toString()).toBe('sess42');
  });

  test('no target NAS at all → sent:false with explanatory message', async () => {
    db.query
      .mockResolvedValueOnce([[{ username: 'u', nas_id: null, organization_id: 1 }]])
      .mockResolvedValueOnce([[]]);
    const r = await suspensionService.sendRadiusDisconnect(7);
    expect(r.sent).toBe(false);
    expect(r.response).toMatch(/No target NAS/);
    expect(mockSentPackets).toHaveLength(0);
  });

  test('one unreachable NAS does not mask the successful one', async () => {
    mockNasBehavior['10.0.0.3'] = 'error';
    db.query
      .mockResolvedValueOnce([[{ username: 'u', nas_id: null, organization_id: 1 }]])
      .mockResolvedValueOnce([[nasRow(2, '10.0.0.2'), nasRow(3, '10.0.0.3')]]);
    const r = await suspensionService.sendRadiusDisconnect(7);
    expect(r.sent).toBe(true);
    expect(r.response).toContain('10.0.0.2: Disconnect-ACK');
    expect(r.response).toContain('10.0.0.3: Socket error');
  });

  test('failed primary fails over to its secondary NAS', async () => {
    mockNasBehavior['10.0.0.9'] = 'error';
    db.query
      .mockResolvedValueOnce([[{ username: 'u', nas_id: 1, organization_id: 1 }]])      // account
      .mockResolvedValueOnce([[]])                                                       // no open sessions
      .mockResolvedValueOnce([[nasRow(1, '10.0.0.9', { secondary_nas_id: 5 })]])         // home NAS
      .mockResolvedValueOnce([[{ ip_address: '10.0.0.5', coa_port: 3799, secret: 's5' }]]); // secondary
    mockNasSecrets['10.0.0.5'] = 's5';
    const r = await suspensionService.sendRadiusDisconnect(7);
    expect(r.sent).toBe(true);
    expect(mockSentPackets.map((p) => p.address)).toEqual(['10.0.0.9', '10.0.0.5']);
  });

  // j64: RADIUS Disconnect is request/response (RFC 5176). Only a verified
  // Disconnect-ACK is success — a NAK, a timeout (dead or wrong-secret NAS
  // never answers) or an unauthenticated reply must read as failure, and
  // failover must fire on all of them. The old code resolved sent:true the
  // moment the packet left the socket, so batch results, audit rows and kick
  // counters claimed success for subscribers who were still online.
  test('a Disconnect-NAK is reported as failure, not success', async () => {
    mockNasBehavior['10.0.0.2'] = 'nak';
    db.query
      .mockResolvedValueOnce([[{ username: 'u', nas_id: null, organization_id: 1 }]])
      .mockResolvedValueOnce([[nasRow(2, '10.0.0.2')]]);
    const r = await suspensionService.sendRadiusDisconnect(7);
    expect(r).toEqual({ sent: false, response: 'Disconnect-NAK', outcome: 'nak' });
  });

  test('a NAK does NOT trigger failover — it is an authoritative answer from a live NAS', async () => {
    // Routine case: the subscriber is offline, the home NAS answers "no such
    // session". Failing over would send an extra packet to a NAS that was
    // never a resolved target — and for an Acct-Session-Id-scoped kill could
    // hit a colliding session there.
    mockNasBehavior['10.0.0.9'] = 'nak';
    db.query
      .mockResolvedValueOnce([[{ username: 'u', nas_id: 1, organization_id: 1 }]])      // account
      .mockResolvedValueOnce([[]])                                               // no open sessions
      .mockResolvedValueOnce([[nasRow(1, '10.0.0.9', { secondary_nas_id: 5 })]]); // home NAS
    const r = await suspensionService.sendRadiusDisconnect(7);
    expect(r).toEqual({ sent: false, response: 'Disconnect-NAK', outcome: 'nak' });
    expect(mockSentPackets.map((p) => p.address)).toEqual(['10.0.0.9']); // no secondary send
    expect(db.query).toHaveBeenCalledTimes(3); // secondary NAS never even looked up
  });

  test('a timeout (NAS never answers) is reported as failure and fails over', async () => {
    jest.useFakeTimers();
    mockNasBehavior['10.0.0.9'] = 'silent';
    db.query
      .mockResolvedValueOnce([[{ username: 'u', nas_id: 1, organization_id: 1 }]])      // account
      .mockResolvedValueOnce([[]])                                                       // no open sessions
      .mockResolvedValueOnce([[nasRow(1, '10.0.0.9', { secondary_nas_id: 5 })]])         // home NAS
      .mockResolvedValueOnce([[{ ip_address: '10.0.0.5', coa_port: 3799, secret: 's5' }]]); // secondary
    mockNasSecrets['10.0.0.5'] = 's5';
    const promise = suspensionService.sendRadiusDisconnect(7);
    await jest.advanceTimersByTimeAsync(5000);
    const r = await promise;
    expect(r.sent).toBe(true); // the secondary ACKed after the primary timed out
    expect(r.response).toContain('Disconnect-ACK');
    expect(r.response).toContain('primary: Timeout');
    expect(mockSentPackets.map((p) => p.address)).toEqual(['10.0.0.9', '10.0.0.5']);
  });

  test('a timeout with no secondary is reported as failure', async () => {
    jest.useFakeTimers();
    mockNasBehavior['10.0.0.2'] = 'silent';
    db.query
      .mockResolvedValueOnce([[{ username: 'u', nas_id: null, organization_id: 1 }]])
      .mockResolvedValueOnce([[nasRow(2, '10.0.0.2')]]);
    const promise = suspensionService.sendRadiusDisconnect(7);
    await jest.advanceTimersByTimeAsync(5000);
    const r = await promise;
    expect(r).toEqual({ sent: false, response: 'Timeout — no response from NAS', outcome: 'timeout' });
  });

  test('a reply that fails Response Authenticator verification is ignored (times out)', async () => {
    jest.useFakeTimers();
    db.query
      .mockResolvedValueOnce([[{ username: 'u', nas_id: null, organization_id: 1 }]])
      .mockResolvedValueOnce([[nasRow(2, '10.0.0.2')]]);
    // The NAS replies, but computes its authenticator with a different secret
    // than ours — a spoofed/corrupt reply must not resolve the send as an ACK.
    mockNasSecrets['10.0.0.2'] = 'not-the-configured-secret';
    const promise = suspensionService.sendRadiusDisconnect(7);
    await jest.advanceTimersByTimeAsync(5000);
    const r = await promise;
    expect(r).toEqual({ sent: false, response: 'Timeout — no response from NAS', outcome: 'timeout' });
  });

  test('targets without a configured secret are skipped', async () => {
    db.query
      .mockResolvedValueOnce([[{ username: 'u', nas_id: null, organization_id: 1 }]])
      .mockResolvedValueOnce([[nasRow(2, '10.0.0.2', { secret: '' })]]);
    const r = await suspensionService.sendRadiusDisconnect(7);
    expect(r).toEqual({ sent: false, response: 'NAS RADIUS secret not configured', outcome: 'no_secret' });
    expect(mockSentPackets).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// sendRadiusCoA
// ---------------------------------------------------------------------------
describe('sendRadiusCoA()', () => {
  test('sends code 43 with extra attributes to the open-session NAS', async () => {
    db.query
      .mockResolvedValueOnce([[{ username: 'u', nas_id: null, organization_id: 1 }]])
      .mockResolvedValueOnce([[nasRow(2, '10.0.0.2')]]);
    const r = await suspensionService.sendRadiusCoA(7, 'update', [
      { name: 'Mikrotik-Rate-Limit', value: '10M/5M' },
    ]);
    expect(r).toEqual({ sent: true, response: 'CoA-ACK', outcome: 'ack' });
    expect(mockSentPackets).toHaveLength(1);
    expect(mockSentPackets[0].buf[0]).toBe(43); // CoA-Request
    const attrs = parseAttrs(mockSentPackets[0].buf);
    expect(attrs.find((a) => a.type === 1).value.toString()).toBe('u');
    expect(attrs.some((a) => a.type === 26)).toBe(true); // Mikrotik VSA present
  });

  test('roaming: CoA reaches every open-session NAS plus home', async () => {
    db.query
      .mockResolvedValueOnce([[{ username: 'u', nas_id: 1, organization_id: 1 }]])
      .mockResolvedValueOnce([[nasRow(2, '10.0.0.2'), nasRow(3, '10.0.0.3')]])
      .mockResolvedValueOnce([[nasRow(1, '10.0.0.1')]]);
    const r = await suspensionService.sendRadiusCoA(7, 'reconnect');
    expect(r.sent).toBe(true);
    expect(mockSentPackets.map((p) => p.address).sort()).toEqual(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
  });

  test('no RADIUS account → early return', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const r = await suspensionService.sendRadiusCoA(7, 'reconnect');
    expect(r).toEqual({ sent: false, response: 'No RADIUS account found for contract', outcome: 'no_account' });
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// kickDuplicateSessions — per-session targeting through the real send path
// ---------------------------------------------------------------------------
describe('kickDuplicateSessions() — current session projection and per-session kicks', () => {
  const { kickDuplicateSessions } = require('../src/services/radiusService');

  test('active-session query reads the tenant-scoped current projection with canonical ids', async () => {
    db.query
      .mockResolvedValueOnce([[
        {
          radius_id: 1, username: 'u', allowed_sim_use: 2, contract_id: 10, organization_id: 1,
        },
      ]])
      .mockResolvedValueOnce([[{ session_id: 's1', event_at: '2026-01-01 08:00:00', nas_ip_address: '10.0.0.2' }]]);
    const result = await kickDuplicateSessions(1);
    expect(result).toEqual({ kicked: 0, errors: 0 });
    expect(mockSentPackets).toHaveLength(0);
    const sessionSql = db.query.mock.calls[1][0];
    expect(db.query.mock.calls[1][1]).toEqual([1, 'u']);
    expect(sessionSql).toMatch(/cl\.organization_id = \?/);
    expect(sessionSql).toMatch(/COALESCE\(cl\.acct_session_id, cl\.session_id\) IS NOT NULL/);
    expect(sessionSql).toMatch(/IN \('start', 'interim-update'\)/);
    expect(sessionSql).toMatch(/COALESCE\(cl\.last_accounting_received_at, cl\.last_accounting_at, cl\.event_at\)/);
    expect(sessionSql).toMatch(/DATE_SUB\(NOW\(\), INTERVAL 60 MINUTE\)/);
    expect(sessionSql).toMatch(/cl\.session_instance_id IS NOT NULL OR cl\.id =/);
    expect(sessionSql).not.toMatch(/GROUP BY|HAVING/);
  });

  test('kicks the oldest excess session at ITS NAS, narrowed by Acct-Session-Id', async () => {
    db.query
      .mockResolvedValueOnce([[
        {
          radius_id: 1, username: 'u', allowed_sim_use: 1, contract_id: 10, organization_id: 1,
        },
      ]])
      .mockResolvedValueOnce([[
        { session_id: 's-old', event_at: '2026-01-01 08:00:00', nas_ip_address: '10.0.0.2' },
        { session_id: 's-new', event_at: '2026-01-01 09:00:00', nas_ip_address: '10.0.0.3' },
      ]])
      // sendRadiusDisconnect for the kicked session:
      .mockResolvedValueOnce([[{ username: 'u', nas_id: null, organization_id: 1 }]]) // account
      .mockResolvedValueOnce([[nasRow(2, '10.0.0.2')]]);            // NAS by ip
    const result = await kickDuplicateSessions(1);
    expect(result).toEqual({ kicked: 1, errors: 0 });
    expect(mockSentPackets).toHaveLength(1);
    expect(mockSentPackets[0].address).toBe('10.0.0.2'); // oldest session's NAS, not s-new's
    expect(mockSentPackets[0].buf[0]).toBe(40);
    const attrs = parseAttrs(mockSentPackets[0].buf);
    expect(attrs.find((a) => a.type === 44).value.toString()).toBe('s-old');
  });

  test('an undeliverable kick counts as an error, not a kick', async () => {
    db.query
      .mockResolvedValueOnce([[
        {
          radius_id: 1, username: 'u', allowed_sim_use: 1, contract_id: 10, organization_id: 1,
        },
      ]])
      .mockResolvedValueOnce([[
        { session_id: 's1', event_at: '2026-01-01 08:00:00', nas_ip_address: '10.0.0.2' },
        { session_id: 's2', event_at: '2026-01-01 09:00:00', nas_ip_address: '10.0.0.3' },
      ]])
      .mockResolvedValueOnce([[]]); // no RADIUS account → {sent:false}
    const result = await kickDuplicateSessions(1);
    expect(result).toEqual({ kicked: 0, errors: 1 });
    expect(mockSentPackets).toHaveLength(0);
  });
});
