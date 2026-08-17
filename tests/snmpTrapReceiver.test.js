// =============================================================================
// FireISP 5.0 — SNMP Trap Receiver Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
// Keep one stable spy across resetModules() calls. Returning a new jest.fn()
// from the mock factory can leave the freshly required service and the test
// observing different mock instances when this file runs in a larger suite.
const mockCreateReceiver = jest.fn();
jest.mock('net-snmp', () => ({
  createReceiver: mockCreateReceiver,
}));
jest.mock('../src/services/eventBus', () => ({
  emit: jest.fn(),
  on:   jest.fn(),
}));
jest.mock('../src/services/trapForwardingService', () => ({
  forwardTrap: jest.fn().mockResolvedValue({
    matched_rules: 0,
    queued_deliveries: 0,
    selected_webhook_ids: [],
    errors: 0,
  }),
  prepareTrapDeliveries: jest.fn().mockResolvedValue({
    matched_rules: 0,
    queued_deliveries: 0,
    delivery_ids: [],
    selected_webhook_ids: [],
    errors: 0,
  }),
  enqueuePreparedDeliveries: jest.fn().mockResolvedValue({ queued: 0, failed: 0, total: 0 }),
}));
jest.mock('../src/services/tenantDeviceResolverService', () => ({
  resolveDeviceByIp: jest.fn(),
  lockSharedDeviceByIp: jest.fn(),
}));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const db       = require('../src/config/database');
const snmp     = require('net-snmp');
const eventBus = require('../src/services/eventBus');
const trapForwardingService = require('../src/services/trapForwardingService');
const tenantDeviceResolver = require('../src/services/tenantDeviceResolverService');
const logger = require('../src/utils/logger');

const {
  lookupDevice,
  storeTrap,
  reserveTrapIngestUsage,
  reserveTrapForwardingUsage,
  refundTrapForwardingUsage,
  getDailyIngestUsage,
  boundedVarbindPayload,
  extractTrapInfo,
  serializeVarbind,
  handleTrap,
  start,
  stop,
  getStatus,
  configuredTrapBindIp,
  MAX_IN_FLIGHT,
  RATE_BURST,
  MAX_VARBIND_COUNT,
  MAX_VARBIND_VALUE_BYTES,
  MAX_VARBINDS_JSON_BYTES,
  DAILY_TRAP_ROW_LIMIT,
  DAILY_VARBIND_BYTE_LIMIT,
  ORG_DAILY_TRAP_ROW_LIMIT,
  GLOBAL_DAILY_TRAP_ROW_LIMIT,
  ORG_DAILY_VARBIND_BYTE_LIMIT,
  GLOBAL_DAILY_VARBIND_BYTE_LIMIT,
  ORG_DAILY_DELIVERY_LIMIT,
  GLOBAL_DAILY_DELIVERY_LIMIT,
  SOURCE_RATE_BURST,
  SNMP_TRAP_OID_MAP,
  V1_GENERIC_TRAP_MAP,
} = require('../src/services/snmpTrapReceiver');
const trapForwardingReadiness = require('../src/services/trapForwardingReadinessService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrapV2(trapOid, extraVarbinds = []) {
  return {
    // net-snmp exposes the UDP peer through notification.rinfo.
    rinfo: { address: '10.0.0.1', port: 162 },
    accept: jest.fn(),
    pdu: {
      community: 'public',
      varbinds: [
        { oid: '1.3.6.1.2.1.1.3.0', type: 67, value: '12345' }, // sysUpTime
        { oid: '1.3.6.1.6.3.1.1.4.1.0', type: 6, value: trapOid }, // snmpTrapOID
        ...extraVarbinds,
      ],
    },
  };
}

function makeV1Trap(genericTrap, enterprise = '1.3.6.1.4.1.99', specific = 0, varbinds = []) {
  return {
    rinfo: { address: '10.0.0.2', port: 162 },
    accept: jest.fn(),
    pdu: {
      community: 'private',
      generic:    genericTrap,
      enterprise,
      specific,
      varbinds,
    },
  };
}

function quotaSqlResult(sql, organizationUsage = {}, globalUsage = {}) {
  if (/INSERT IGNORE INTO snmp_trap_ingest_daily_usage/.test(sql)) {
    return [{ affectedRows: 1 }];
  }
  if (/FROM snmp_trap_ingest_daily_usage/.test(sql)) {
    const defaults = {
      usage_date: '2026-08-17',
      trap_count: 0,
      varbind_bytes: 0,
      delivery_count: 0,
      metadata_only_count: 0,
      dropped_trap_count: 0,
      forwarding_skipped_count: 0,
    };
    return [[
      { ...defaults, scope_type: 'global', scope_id: 0, ...globalUsage },
      { ...defaults, scope_type: 'organization', scope_id: 2, ...organizationUsage },
    ]];
  }
  if (/UPDATE snmp_trap_ingest_daily_usage/.test(sql)) {
    return [{ affectedRows: 1 }];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// SNMP_TRAP_OID_MAP
// ---------------------------------------------------------------------------

describe('SNMP_TRAP_OID_MAP', () => {
  test('contains 6 standard trap entries', () => {
    expect(Object.keys(SNMP_TRAP_OID_MAP)).toHaveLength(6);
  });

  test('maps linkDown OID correctly', () => {
    expect(SNMP_TRAP_OID_MAP['1.3.6.1.6.3.1.1.5.3']).toBe('linkDown');
  });

  test('maps linkUp OID correctly', () => {
    expect(SNMP_TRAP_OID_MAP['1.3.6.1.6.3.1.1.5.4']).toBe('linkUp');
  });
});

// ---------------------------------------------------------------------------
// V1_GENERIC_TRAP_MAP
// ---------------------------------------------------------------------------

describe('V1_GENERIC_TRAP_MAP', () => {
  test('index 2 is linkDown', () => {
    expect(V1_GENERIC_TRAP_MAP[2]).toBe('linkDown');
  });

  test('index 0 is coldStart', () => {
    expect(V1_GENERIC_TRAP_MAP[0]).toBe('coldStart');
  });
});

// ---------------------------------------------------------------------------
// serializeVarbind
// ---------------------------------------------------------------------------

describe('serializeVarbind()', () => {
  test('converts numeric value to string', () => {
    const result = serializeVarbind({ oid: '1.2.3', type: 2, value: 42 });
    expect(result).toEqual({ oid: '1.2.3', type: 2, value: '42' });
  });

  test('hex-encodes Buffer values', () => {
    const buf = Buffer.from('hello');
    const result = serializeVarbind({ oid: '1.2.3', type: 4, value: buf });
    expect(result.value).toBe(buf.toString('hex'));
  });

  test('passes through string values unchanged', () => {
    const result = serializeVarbind({ oid: '1.2.3', type: 6, value: '1.3.6.1.6.3.1.1.5.3' });
    expect(result.value).toBe('1.3.6.1.6.3.1.1.5.3');
  });

  test('handles null value', () => {
    const result = serializeVarbind({ oid: '1.2.3', type: 5, value: null });
    expect(result.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractTrapInfo — SNMPv2c
// ---------------------------------------------------------------------------

describe('extractTrapInfo() — SNMPv2c', () => {
  test('extracts trapType=linkDown from v2c notification', () => {
    const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.3');
    const info = extractTrapInfo(notification);
    expect(info.trapType).toBe('linkDown');
    expect(info.trapOid).toBe('1.3.6.1.6.3.1.1.5.3');
    expect(info.snmpVersion).toBe(2);
  });

  test('extracts trapType=enterpriseSpecific for unknown OID', () => {
    const notification = makeTrapV2('1.3.6.1.4.1.9999.1.2.3');
    const info = extractTrapInfo(notification);
    expect(info.trapType).toBe('enterpriseSpecific');
  });

  test('includes all varbinds in output', () => {
    const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.4', [
      { oid: '1.3.6.1.2.1.2.2.1.7.1', type: 2, value: 2 },
    ]);
    const info = extractTrapInfo(notification);
    expect(info.varbinds).toHaveLength(3);
  });

  test('returns unknown when no snmpTrapOID varbind present', () => {
    const notification = {
      rinfo: { address: '10.0.0.1', port: 162 },
      accept: jest.fn(),
      pdu: { community: 'public', varbinds: [] },
    };
    const info = extractTrapInfo(notification);
    expect(info.trapType).toBe('unknown');
    expect(info.trapOid).toBeNull();
  });

  test('returns defaults when pdu is absent', () => {
    const info = extractTrapInfo({ pdu: null, rinfo: { address: '10.0.0.1' } });
    expect(info.trapType).toBe('unknown');
    expect(info.snmpVersion).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// extractTrapInfo — SNMPv1
// ---------------------------------------------------------------------------

describe('extractTrapInfo() — SNMPv1', () => {
  test('maps generic-trap 2 → linkDown', () => {
    const notification = makeV1Trap(2);
    const info = extractTrapInfo(notification);
    expect(info.trapType).toBe('linkDown');
    expect(info.snmpVersion).toBe(1);
    expect(info.trapOid).toBe('1.3.6.1.6.3.1.1.5.3');
  });

  test('maps enterprise-specific trap (generic=6)', () => {
    const notification = makeV1Trap(6, '1.3.6.1.4.1.9999', 42);
    const info = extractTrapInfo(notification);
    expect(info.trapType).toBe('enterpriseSpecific');
    expect(info.trapOid).toBe('1.3.6.1.4.1.9999.0.42');
  });

  test('does not retain the SNMP community in the normalized trap object', () => {
    const notification = makeV1Trap(0);
    const info = extractTrapInfo(notification);
    expect(info).not.toHaveProperty('community');
    expect(JSON.stringify(info)).not.toContain('private');
  });

  test('bounds varbind count, each value, and the complete serialized payload', () => {
    expect(MAX_VARBIND_COUNT).toBeGreaterThan(0);
    expect(MAX_VARBIND_VALUE_BYTES).toBeGreaterThan(0);
    expect(MAX_VARBINDS_JSON_BYTES).toBeGreaterThan(MAX_VARBIND_VALUE_BYTES);
    const notification = makeTrapV2(
      '1.3.6.1.6.3.1.1.5.3',
      Array.from({ length: MAX_VARBIND_COUNT + 50 }, (_, index) => ({
        oid: `1.3.6.1.4.1.9999.${index}`,
        type: 4,
        value: `sensitive-${index}-`.padEnd(MAX_VARBIND_VALUE_BYTES * 3, '🔒'),
      })),
    );

    const info = extractTrapInfo(notification);

    expect(info.varbinds.length).toBeLessThanOrEqual(MAX_VARBIND_COUNT);
    for (const varbind of info.varbinds) {
      if (typeof varbind.value === 'string') {
        expect(Buffer.byteLength(varbind.value, 'utf8')).toBeLessThanOrEqual(MAX_VARBIND_VALUE_BYTES);
      }
    }
    expect(Buffer.byteLength(JSON.stringify(info.varbinds), 'utf8'))
      .toBeLessThanOrEqual(MAX_VARBINDS_JSON_BYTES);
  });
});

// ---------------------------------------------------------------------------
// lookupDevice
// ---------------------------------------------------------------------------

describe('lookupDevice()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns device row when found', async () => {
    db.query.mockResolvedValueOnce([[{ id: 5, organization_id: 1, name: 'router-1' }]]);
    const device = await lookupDevice('10.0.0.1');
    expect(device).toEqual({ id: 5, organization_id: 1, name: 'router-1' });
  });

  test('returns null when device not found', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const device = await lookupDevice('192.168.99.99');
    expect(device).toBeNull();
  });

  test('fails closed when the same management IP belongs to more than one organization', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 5, organization_id: 1, name: 'router-org-1' },
      { id: 9, organization_id: 2, name: 'router-org-2' },
    ]]);

    await expect(lookupDevice('10.0.0.1')).resolves.toBeNull();
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM devices'),
      ['10.0.0.1'],
    );
  });
});

// ---------------------------------------------------------------------------
// storeTrap
// ---------------------------------------------------------------------------

describe('storeTrap()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('inserts trap row and returns insertId', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 77 }]);
    const id = await storeTrap({
      organizationId: 1,
      deviceId:       5,
      sourceIp:       '10.0.0.1',
      trapType:       'linkDown',
      trapOid:        '1.3.6.1.6.3.1.1.5.3',
      varbinds:       [],
      community:      'public',
      snmpVersion:    2,
    });
    expect(id).toBe(77);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO snmp_traps'),
      expect.any(Array),
    );
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).not.toMatch(/\bcommunity\b/);
    expect(params).not.toContain('public');
  });

  test('stores null for missing optional fields', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 1 }]);
    await storeTrap({ sourceIp: '1.2.3.4', trapType: 'unknown' });
    const callArgs = db.query.mock.calls[0][1];
    expect(callArgs[0]).toBeNull(); // organizationId
    expect(callArgs[1]).toBeNull(); // deviceId
  });

  test('defensively re-applies varbind byte caps at the persistence boundary', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 2 }]);
    const untrustedVarbinds = Array.from({ length: MAX_VARBIND_COUNT * 2 }, (_, index) => ({
      oid: `1.3.6.1.4.1.4242.${index}`,
      type: 4,
      value: 'x'.repeat(MAX_VARBIND_VALUE_BYTES * 4),
    }));

    await storeTrap({
      organizationId: 1,
      deviceId: 5,
      sourceIp: '10.0.0.1',
      trapType: 'enterpriseSpecific',
      trapOid: '1.3.6.1.4.1.4242.1',
      varbinds: untrustedVarbinds,
      snmpVersion: 2,
      community: 'must-never-be-stored',
    });

    const [sql, params] = db.query.mock.calls[0];
    const persisted = JSON.parse(params[5]);
    expect(sql).not.toMatch(/community/i);
    expect(JSON.stringify(params)).not.toContain('must-never-be-stored');
    expect(persisted.length).toBeLessThanOrEqual(MAX_VARBIND_COUNT);
    expect(Buffer.byteLength(params[5], 'utf8')).toBeLessThanOrEqual(MAX_VARBINDS_JSON_BYTES);
    for (const varbind of persisted) {
      expect(Buffer.byteLength(String(varbind.value ?? ''), 'utf8'))
        .toBeLessThanOrEqual(MAX_VARBIND_VALUE_BYTES);
    }
  });
});

// ---------------------------------------------------------------------------
// durable daily ingest quota
// ---------------------------------------------------------------------------

describe('reserveTrapIngestUsage()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('locks global then organization UTC-day rows before reserving a trap and its bytes', async () => {
    const exec = jest.fn(async sql => {
      const result = quotaSqlResult(
        sql,
        { scope_id: 42, trap_count: 17, varbind_bytes: 1024 },
        { trap_count: 100, varbind_bytes: 2048 },
      );
      if (result !== undefined) return result;
      throw new Error(`Unexpected quota SQL: ${sql}`);
    });

    await expect(reserveTrapIngestUsage(exec, 42, 512)).resolves.toEqual({
      accepted: true,
      store_varbinds: true,
      reason: null,
      usage_date: '2026-08-17',
      trap_count: 18,
      varbind_bytes: 1536,
      global: { trap_count: 101, varbind_bytes: 2560 },
    });

    expect(exec).toHaveBeenCalledTimes(3);
    expect(exec.mock.calls[0][0]).toMatch(/INSERT IGNORE[\s\S]*'global', 0[\s\S]*'organization', \?/);
    expect(exec.mock.calls[0][1]).toEqual([42]);
    expect(exec.mock.calls[1][0]).toMatch(
      /WHERE usage_date = UTC_DATE\(\)[\s\S]*ORDER BY scope_type ASC, scope_id ASC[\s\S]*FOR UPDATE/,
    );
    expect(exec.mock.calls[1][1]).toEqual([42]);
    expect(exec.mock.calls[2][0]).toMatch(/trap_count = trap_count \+ 1[\s\S]*varbind_bytes = varbind_bytes \+ \?/);
    expect(exec.mock.calls[2][1]).toEqual([512, 0, 42]);
  });

  test('same-organization workers serialize the final daily row slot so only one can persist', async () => {
    const organization = {
      usage_date: '2026-08-17',
      scope_type: 'organization',
      scope_id: 42,
      trap_count: ORG_DAILY_TRAP_ROW_LIMIT - 1,
      varbind_bytes: 0,
      metadata_only_count: 0,
      dropped_trap_count: 0,
    };
    const global = {
      usage_date: '2026-08-17',
      scope_type: 'global',
      scope_id: 0,
      trap_count: 100,
      varbind_bytes: 0,
      metadata_only_count: 0,
      dropped_trap_count: 0,
    };
    let locked = false;
    const waiters = [];
    const acquire = () => new Promise(resolve => {
      if (!locked) {
        locked = true;
        resolve();
      } else {
        waiters.push(resolve);
      }
    });
    const release = () => {
      const next = waiters.shift();
      if (next) next();
      else locked = false;
    };
    const makeExec = () => {
      let ownsLock = false;
      return jest.fn(async (sql) => {
        if (/INSERT IGNORE INTO snmp_trap_ingest_daily_usage/.test(sql)) {
          return [{ affectedRows: 0 }];
        }
        if (/FROM snmp_trap_ingest_daily_usage/.test(sql)) {
          expect(sql).toMatch(/FOR UPDATE/);
          await acquire();
          ownsLock = true;
          return [[{ ...global }, { ...organization }]];
        }
        if (/SET trap_count = trap_count \+ 1/.test(sql)) {
          organization.trap_count += 1;
          global.trap_count += 1;
        } else if (/SET dropped_trap_count = dropped_trap_count \+ 1/.test(sql)) {
          organization.dropped_trap_count += 1;
          global.dropped_trap_count += 1;
        } else {
          throw new Error(`Unexpected quota SQL: ${sql}`);
        }
        if (ownsLock) release();
        return [{ affectedRows: 1 }];
      });
    };

    const results = await Promise.all([
      reserveTrapIngestUsage(makeExec(), 42, 0),
      reserveTrapIngestUsage(makeExec(), 42, 0),
    ]);

    expect(results.filter(result => result.accepted)).toHaveLength(1);
    expect(results.filter(result => !result.accepted)).toEqual([
      expect.objectContaining({ reason: 'daily_trap_row_limit' }),
    ]);
    expect(organization.trap_count).toBe(ORG_DAILY_TRAP_ROW_LIMIT);
    expect(organization.dropped_trap_count).toBe(1);
    expect(global.trap_count).toBe(101);
    expect(global.dropped_trap_count).toBe(1);
  });

  test('different organizations serialize the final global row slot so only one can persist', async () => {
    const global = {
      usage_date: '2026-08-17',
      scope_type: 'global',
      scope_id: 0,
      trap_count: GLOBAL_DAILY_TRAP_ROW_LIMIT - 1,
      varbind_bytes: 0,
      dropped_trap_count: 0,
    };
    const organizations = new Map([11, 12].map(id => [id, {
      usage_date: '2026-08-17',
      scope_type: 'organization',
      scope_id: id,
      trap_count: 0,
      varbind_bytes: 0,
      dropped_trap_count: 0,
    }]));
    let locked = false;
    const waiters = [];
    const acquire = () => new Promise(resolve => {
      if (!locked) {
        locked = true;
        resolve();
      } else {
        waiters.push(resolve);
      }
    });
    const release = () => {
      const next = waiters.shift();
      if (next) next();
      else locked = false;
    };
    const makeExec = orgId => {
      let ownsLock = false;
      return jest.fn(async sql => {
        if (/INSERT IGNORE/.test(sql)) return [{ affectedRows: 0 }];
        if (/FROM snmp_trap_ingest_daily_usage/.test(sql)) {
          await acquire();
          ownsLock = true;
          return [[{ ...global }, { ...organizations.get(orgId) }]];
        }
        if (/SET trap_count = trap_count \+ 1/.test(sql)) {
          global.trap_count += 1;
          organizations.get(orgId).trap_count += 1;
        } else if (/SET dropped_trap_count = dropped_trap_count \+ 1/.test(sql)) {
          global.dropped_trap_count += 1;
          organizations.get(orgId).dropped_trap_count += 1;
        } else {
          throw new Error(`Unexpected quota SQL: ${sql}`);
        }
        if (ownsLock) release();
        return [{ affectedRows: 2 }];
      });
    };

    const results = await Promise.all([
      reserveTrapIngestUsage(makeExec(11), 11, 0),
      reserveTrapIngestUsage(makeExec(12), 12, 0),
    ]);

    expect(results.filter(result => result.accepted)).toHaveLength(1);
    expect(results.filter(result => !result.accepted)).toHaveLength(1);
    expect(global.trap_count).toBe(GLOBAL_DAILY_TRAP_ROW_LIMIT);
    expect(global.dropped_trap_count).toBe(1);
  });

  test('database state, not process memory, survives restarts and UTC day rollover', async () => {
    const snapshots = [
      [
        { usage_date: '2026-08-17', scope_type: 'global', scope_id: 0, trap_count: 10000, varbind_bytes: 500 },
        { usage_date: '2026-08-17', scope_type: 'organization', scope_id: 42, trap_count: 9998, varbind_bytes: 100 },
      ],
      [
        { usage_date: '2026-08-18', scope_type: 'global', scope_id: 0, trap_count: 0, varbind_bytes: 0 },
        { usage_date: '2026-08-18', scope_type: 'organization', scope_id: 42, trap_count: 0, varbind_bytes: 0 },
      ],
    ];
    const exec = jest.fn(async (sql) => {
      if (/INSERT IGNORE/.test(sql)) return [{ affectedRows: 0 }];
      if (/SELECT usage_date/.test(sql)) return [snapshots.shift()];
      if (/UPDATE snmp_trap_ingest_daily_usage/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected quota SQL: ${sql}`);
    });

    await expect(reserveTrapIngestUsage(exec, 42, 10)).resolves.toMatchObject({
      usage_date: '2026-08-17',
      trap_count: 9999,
      varbind_bytes: 110,
    });
    await expect(reserveTrapIngestUsage(exec, 42, 10)).resolves.toMatchObject({
      usage_date: '2026-08-18',
      trap_count: 1,
      varbind_bytes: 10,
    });
    for (const [sql] of exec.mock.calls) {
      expect(sql).toMatch(/UTC_DATE\(\)/);
    }
  });

  test('exhausted byte budget reserves only metadata without exceeding the durable byte cap', async () => {
    const exec = jest.fn(async (sql) => {
      const result = quotaSqlResult(sql, {
        scope_id: 42,
        trap_count: 10,
        varbind_bytes: ORG_DAILY_VARBIND_BYTE_LIMIT - 1,
      }, {
        trap_count: 100,
        varbind_bytes: 1024,
      });
      if (result !== undefined) return result;
      throw new Error(`Unexpected quota SQL: ${sql}`);
    });

    await expect(reserveTrapIngestUsage(exec, 42, 2)).resolves.toEqual({
      accepted: true,
      store_varbinds: false,
      reason: 'daily_varbind_byte_limit',
      usage_date: '2026-08-17',
      trap_count: 11,
      varbind_bytes: ORG_DAILY_VARBIND_BYTE_LIMIT - 1,
      global: { trap_count: 101, varbind_bytes: 1024 },
    });
    expect(exec.mock.calls[2][1]).toEqual([0, 1, 42]);
  });

  test('global byte exhaustion falls back to metadata without consuming another organization byte', async () => {
    const exec = jest.fn(async sql => {
      const result = quotaSqlResult(
        sql,
        { scope_id: 42, trap_count: 2, varbind_bytes: 100 },
        { trap_count: 99, varbind_bytes: GLOBAL_DAILY_VARBIND_BYTE_LIMIT },
      );
      if (result !== undefined) return result;
      throw new Error(`Unexpected quota SQL: ${sql}`);
    });

    await expect(reserveTrapIngestUsage(exec, 42, 512)).resolves.toMatchObject({
      accepted: true,
      store_varbinds: false,
      reason: 'daily_varbind_byte_limit',
      varbind_bytes: 100,
      global: { varbind_bytes: GLOBAL_DAILY_VARBIND_BYTE_LIMIT },
    });
    expect(exec.mock.calls[2][1]).toEqual([0, 1, 42]);
  });

  test('per-trap serialization stays below the operational 8 KiB ceiling before quota reservation', () => {
    const bounded = boundedVarbindPayload(Array.from({ length: MAX_VARBIND_COUNT * 2 }, (_, index) => ({
      oid: `1.3.6.1.4.1.555.${index}`,
      type: 4,
      value: 'x'.repeat(MAX_VARBIND_VALUE_BYTES * 4),
    })));

    expect(bounded.varbinds.length).toBeLessThanOrEqual(MAX_VARBIND_COUNT);
    expect(bounded.bytes).toBeLessThanOrEqual(MAX_VARBINDS_JSON_BYTES);
    expect(Buffer.byteLength(bounded.json, 'utf8')).toBe(bounded.bytes);
  });

  test('readiness usage is fetched from the current UTC day in primary storage', async () => {
    db.withPrimaryContext = jest.fn(callback => callback());
    db.query.mockResolvedValueOnce([[
      {
        usage_date: '2026-08-17', scope_type: 'global', scope_id: 0,
        trap_count: '1000', varbind_bytes: '9000', delivery_count: '300',
        metadata_only_count: '18', dropped_trap_count: '19', forwarding_skipped_count: '20',
      },
      {
        usage_date: '2026-08-17', scope_type: 'organization', scope_id: 42,
        trap_count: '123', varbind_bytes: '4567', delivery_count: '30',
        metadata_only_count: '8', dropped_trap_count: '9', forwarding_skipped_count: '10',
      },
    ]]);
    try {
      await expect(getDailyIngestUsage(42)).resolves.toEqual({
        organization: {
          usage_date: '2026-08-17',
          trap_count: 123,
          trap_limit: ORG_DAILY_TRAP_ROW_LIMIT,
          varbind_bytes: 4567,
          varbind_byte_limit: ORG_DAILY_VARBIND_BYTE_LIMIT,
          delivery_count: 30,
          delivery_limit: ORG_DAILY_DELIVERY_LIMIT,
          metadata_only_count: 8,
          dropped_trap_count: 9,
          forwarding_skipped_count: 10,
        },
        global: {
          usage_date: '2026-08-17',
          trap_count: 1000,
          trap_limit: GLOBAL_DAILY_TRAP_ROW_LIMIT,
          varbind_bytes: 9000,
          varbind_byte_limit: GLOBAL_DAILY_VARBIND_BYTE_LIMIT,
          delivery_count: 300,
          delivery_limit: GLOBAL_DAILY_DELIVERY_LIMIT,
          metadata_only_count: 18,
          dropped_trap_count: 19,
          forwarding_skipped_count: 20,
        },
      });
      expect(db.withPrimaryContext).toHaveBeenCalledWith(expect.any(Function));
      expect(db.query.mock.calls[0][0]).toMatch(/WHERE usage_date = UTC_DATE\(\)/);
      expect(db.query.mock.calls[0][1]).toEqual([42]);
    } finally {
      delete db.withPrimaryContext;
    }
  });
});

describe('reserveTrapForwardingUsage()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('reserves only the remaining organization delivery capacity on both locked scopes', async () => {
    const exec = jest.fn(async sql => {
      const result = quotaSqlResult(
        sql,
        { scope_id: 42, delivery_count: ORG_DAILY_DELIVERY_LIMIT - 2 },
        { delivery_count: 100 },
      );
      if (result !== undefined) return result;
      throw new Error(`Unexpected forwarding quota SQL: ${sql}`);
    });

    await expect(reserveTrapForwardingUsage(exec, 42, 3)).resolves.toEqual({
      allowed_count: 2,
      skipped_count: 1,
      reason: 'daily_forwarding_delivery_limit',
    });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[0][0]).toMatch(/ORDER BY scope_type ASC, scope_id ASC[\s\S]*FOR UPDATE/);
    expect(exec.mock.calls[0][1]).toEqual([42]);
    expect(exec.mock.calls[1][1]).toEqual([2, 1, 42]);
  });

  test('global delivery exhaustion skips every outbox while retaining the trap reservation', async () => {
    const exec = jest.fn(async sql => {
      const result = quotaSqlResult(
        sql,
        { scope_id: 42, delivery_count: 0 },
        { delivery_count: GLOBAL_DAILY_DELIVERY_LIMIT },
      );
      if (result !== undefined) return result;
      throw new Error(`Unexpected forwarding quota SQL: ${sql}`);
    });

    await expect(reserveTrapForwardingUsage(exec, 42, 4)).resolves.toEqual({
      allowed_count: 0,
      skipped_count: 4,
      reason: 'daily_forwarding_delivery_limit',
    });
    expect(exec.mock.calls[1][1]).toEqual([0, 4, 42]);
  });

  test('refunds unused durable-outbox reservations from both locked scopes without underflow', async () => {
    const exec = jest.fn().mockResolvedValue([{ affectedRows: 2 }]);

    await expect(refundTrapForwardingUsage(exec, 42, 3)).resolves.toEqual({
      refunded_count: 3,
    });
    expect(exec).toHaveBeenCalledWith(
      expect.stringMatching(
        /delivery_count = GREATEST\(0, delivery_count - \?\)[\s\S]*scope_type = 'global'[\s\S]*scope_type = 'organization'/,
      ),
      [3, 42],
    );
  });
});

// ---------------------------------------------------------------------------
// handleTrap
// ---------------------------------------------------------------------------

describe('handleTrap()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete db.getConnection;
    delete db.withPrimaryContext;
    delete db.withTenantContext;
    trapForwardingService.prepareTrapDeliveries.mockResolvedValue({
      matched_rules: 0,
      queued_deliveries: 0,
      delivery_ids: [],
      selected_webhook_ids: [],
      errors: 0,
    });
    trapForwardingService.enqueuePreparedDeliveries.mockResolvedValue({ queued: 0, failed: 0, total: 0 });
    tenantDeviceResolver.lockSharedDeviceByIp.mockResolvedValue({
      device: {
        id: 3,
        organization_id: 2,
        name: 'sw-01',
        ip_address: '10.0.0.1',
        database_scope: 'primary',
      },
      matches: 1,
      ambiguous: false,
      incomplete: false,
      reason: null,
    });
  });

  afterEach(() => {
    delete db.getConnection;
    delete db.withPrimaryContext;
    delete db.withTenantContext;
  });

  test('net-snmp parse errors are logged as safe sentinels without raw datagram secrets', async () => {
    const err = Object.assign(
      new Error('UDP parse failed community=PRIVATE_COMMUNITY varbind=ROUTER_PASSWORD'),
      {
        code: 'EBADMSG',
        rinfo: { address: '10.0.0.77' },
        buffer: Buffer.from('PRIVATE_COMMUNITY ROUTER_PASSWORD'),
        cause: new Error('NESTED_SECRET'),
      },
    );
    await handleTrap(err, null);

    expect(logger.error).toHaveBeenCalledWith(
      { error_name: 'Error', error_code: 'EBADMSG' },
      'SNMP trap receiver rejected a datagram',
    );
    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toMatch(
      /PRIVATE_COMMUNITY|ROUTER_PASSWORD|NESTED_SECRET|10\.0\.0\.77|UDP parse failed/,
    );
    expect(db.query).not.toHaveBeenCalled();
  });

  test('calls accept() on notification', async () => {
    const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.4');
    db.query.mockResolvedValueOnce([[]]);

    await handleTrap(null, notification);
    expect(notification.accept).toHaveBeenCalled();
  });

  test('emits device.trap event when device is found', async () => {
    const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.3');
    db.query
      .mockResolvedValueOnce([[{ id: 3, organization_id: 2, name: 'sw-01' }]])
      .mockResolvedValueOnce([{ insertId: 20 }]);

    await handleTrap(null, notification);
    expect(eventBus.emit).toHaveBeenCalledWith(
      'device.trap',
      expect.objectContaining({ trapType: 'linkDown', device: expect.objectContaining({ id: 3 }) }),
    );
    expect(trapForwardingService.forwardTrap).toHaveBeenCalledWith(
      expect.objectContaining({
        trapId: 20,
        organizationId: 2,
        sourceIp: '10.0.0.1',
        trapType: 'linkDown',
        trapOid: '1.3.6.1.6.3.1.1.5.3',
        snmpVersion: 2,
      }),
      expect.objectContaining({ id: 3, organization_id: 2 }),
    );
    const forwarded = JSON.stringify(trapForwardingService.forwardTrap.mock.calls[0]);
    expect(forwarded).not.toMatch(/community|private|public|varbind/i);
  });

  test('does not copy explicit forwarding destinations into the generic in-app event', async () => {
    const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.3');
    db.query
      .mockResolvedValueOnce([[{ id: 3, organization_id: 2, name: 'sw-01' }]])
      .mockResolvedValueOnce([{ insertId: 23 }]);
    trapForwardingService.forwardTrap.mockResolvedValueOnce({
      matched_rules: 1,
      queued_deliveries: 1,
      selected_webhook_ids: [44],
      errors: 0,
    });

    await handleTrap(null, notification);

    const event = eventBus.emit.mock.calls.find(([name]) => name === 'device.trap');
    expect(event[1]).not.toHaveProperty('skipWebhookIds');
    expect(event[1]).not.toHaveProperty('varbinds');
  });

  test('isolated-mode fallback drops unattributed payload without persistence or outbound effect', async () => {
    const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.3');
    tenantDeviceResolver.resolveDeviceByIp.mockResolvedValueOnce({
      device: null,
      matches: 0,
      ambiguous: false,
      incomplete: true,
      reason: 'isolated_tenant_attribution_unsupported',
    });
    db.withPrimaryContext = jest.fn(callback => callback());
    db.withTenantContext = jest.fn((_organizationId, callback) => callback());
    const beforeDropped = getStatus().dropped_unattributed_total;

    await handleTrap(null, notification);

    expect(tenantDeviceResolver.resolveDeviceByIp).toHaveBeenCalledWith('10.0.0.1');
    expect(db.withTenantContext).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
    expect(trapForwardingService.forwardTrap).not.toHaveBeenCalled();
    expect(trapForwardingService.prepareTrapDeliveries).not.toHaveBeenCalled();
    expect(trapForwardingService.enqueuePreparedDeliveries).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(getStatus().dropped_unattributed_total).toBe(beforeDropped + 1);
  });

  test('multi-organization fallback drops the trap before persistence, SSE, or outbound work', async () => {
    const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.3', [
      { oid: '1.3.6.1.4.1.9.9', type: 4, value: 'must-not-persist-or-forward' },
    ]);
    tenantDeviceResolver.resolveDeviceByIp.mockResolvedValueOnce({
      device: null,
      matches: 0,
      ambiguous: false,
      incomplete: true,
      reason: 'multi_organization_attribution_unsupported',
    });
    db.withPrimaryContext = jest.fn(callback => callback());
    db.withTenantContext = jest.fn((_organizationId, callback) => callback());
    const beforeDropped = getStatus().dropped_unattributed_total;

    await handleTrap(null, notification);

    expect(tenantDeviceResolver.resolveDeviceByIp).toHaveBeenCalledWith('10.0.0.1');
    expect(db.withPrimaryContext).not.toHaveBeenCalled();
    expect(db.withTenantContext).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
    expect(trapForwardingService.forwardTrap).not.toHaveBeenCalled();
    expect(trapForwardingService.prepareTrapDeliveries).not.toHaveBeenCalled();
    expect(trapForwardingService.enqueuePreparedDeliveries).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(getStatus().dropped_unattributed_total).toBe(beforeDropped + 1);
  });

  test('atomically stores the trap and every outbox row, then queues only after commit', async () => {
    const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.3');
    db.query.mockResolvedValueOnce([[{ id: 3, organization_id: 2, name: 'sw-01' }]]);
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn(async sql => {
        const quota = quotaSqlResult(sql);
        if (quota !== undefined) return quota;
        if (/INSERT INTO snmp_traps/.test(sql)) return [{ insertId: 80 }];
        if (/INSERT INTO snmp_trap_forwarding_deliveries/.test(sql)) return [{ insertId: 501 }];
        throw new Error(`Unexpected transaction SQL: ${sql}`);
      }),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    db.getConnection = jest.fn().mockResolvedValue(connection);
    trapForwardingService.prepareTrapDeliveries.mockImplementation(async (_trap, _device, options) => {
      await expect(options.reserveCapacity(1)).resolves.toEqual({
        allowed_count: 1,
        skipped_count: 0,
        reason: null,
      });
      await options.exec('INSERT INTO snmp_trap_forwarding_deliveries (...) VALUES (...)', []);
      return {
        matched_rules: 1,
        queued_deliveries: 1,
        delivery_ids: [501],
        selected_webhook_ids: [],
        errors: 0,
      };
    });
    trapForwardingService.enqueuePreparedDeliveries.mockResolvedValue({ queued: 0, failed: 1, total: 1 });

    await expect(handleTrap(null, notification)).resolves.toBeUndefined();

    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.execute).toHaveBeenCalledTimes(7);
    expect(connection.execute.mock.calls[0][0]).toMatch(/INSERT IGNORE INTO snmp_trap_ingest_daily_usage/);
    expect(connection.execute.mock.calls[1][0]).toMatch(/FOR UPDATE/);
    expect(connection.execute.mock.calls[2][0]).toMatch(/UPDATE snmp_trap_ingest_daily_usage/);
    expect(connection.execute.mock.calls[3][0]).toMatch(/INSERT INTO snmp_traps/);
    expect(connection.execute.mock.calls[4][0]).toMatch(/delivery_count[\s\S]*FOR UPDATE/);
    expect(connection.execute.mock.calls[5][0]).toMatch(/delivery_count = delivery_count \+ \?/);
    expect(connection.execute.mock.calls[6][0]).toMatch(/INSERT INTO snmp_trap_forwarding_deliveries/);
    expect(trapForwardingService.prepareTrapDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({ trapId: 80, organizationId: 2 }),
      expect.objectContaining({ id: 3, organization_id: 2 }),
      expect.objectContaining({
        exec: expect.any(Function),
        atomic: true,
        reserveCapacity: expect.any(Function),
        refundCapacity: expect.any(Function),
      }),
    );
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(trapForwardingService.enqueuePreparedDeliveries).toHaveBeenCalledWith([501], 2);
    expect(connection.commit.mock.invocationCallOrder[0]).toBeLessThan(
      trapForwardingService.enqueuePreparedDeliveries.mock.invocationCallOrder[0],
    );
    expect(connection.commit.mock.invocationCallOrder[0]).toBeLessThan(eventBus.emit.mock.invocationCallOrder[0]);
    expect(eventBus.emit).toHaveBeenCalledWith(
      'device.trap',
      expect.objectContaining({ organizationId: 2, trapId: 80 }),
    );
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  test('daily row exhaustion commits only the drop accounting and never forwards without a persisted trap', async () => {
    const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.3');
    db.query.mockResolvedValueOnce([[{ id: 3, organization_id: 2, name: 'sw-01' }]]);
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn(async sql => {
        const quota = quotaSqlResult(sql, { trap_count: DAILY_TRAP_ROW_LIMIT });
        if (quota !== undefined) return quota;
        throw new Error(`Trap storage must not run after row quota exhaustion: ${sql}`);
      }),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    db.getConnection = jest.fn().mockResolvedValue(connection);

    await expect(handleTrap(null, notification)).resolves.toBeUndefined();

    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.execute.mock.calls.some(([sql]) => /dropped_trap_count = dropped_trap_count \+ 1/.test(sql))).toBe(true);
    expect(connection.execute.mock.calls.some(([sql]) => /INSERT INTO snmp_traps/.test(sql))).toBe(false);
    expect(trapForwardingService.prepareTrapDeliveries).not.toHaveBeenCalled();
    expect(trapForwardingService.enqueuePreparedDeliveries).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  test('daily byte exhaustion stores bounded metadata only while preserving the trap row', async () => {
    const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.3', [
      { oid: '1.3.6.1.4.1.9.9', type: 4, value: 'private-varbind-value' },
    ]);
    db.query.mockResolvedValueOnce([[{ id: 3, organization_id: 2, name: 'sw-01' }]]);
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn(async (sql, params) => {
        const quota = quotaSqlResult(sql, { varbind_bytes: DAILY_VARBIND_BYTE_LIMIT });
        if (quota !== undefined) return quota;
        if (/INSERT INTO snmp_traps/.test(sql)) {
          expect(params[5]).toBe(JSON.stringify([]));
          expect(JSON.stringify(params)).not.toContain('private-varbind-value');
          return [{ insertId: 84 }];
        }
        throw new Error(`Unexpected metadata-only transaction SQL: ${sql}`);
      }),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    db.getConnection = jest.fn().mockResolvedValue(connection);

    await expect(handleTrap(null, notification)).resolves.toBeUndefined();

    const usageUpdate = connection.execute.mock.calls.find(
      ([sql]) => /SET trap_count = trap_count \+ 1/.test(sql),
    );
    expect(usageUpdate[1]).toEqual([0, 1, 2]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(trapForwardingService.prepareTrapDeliveries).toHaveBeenCalledWith(
      expect.objectContaining({ trapId: 84 }),
      expect.objectContaining({ id: 3, organization_id: 2 }),
      expect.objectContaining({ atomic: true }),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      'device.trap',
      expect.objectContaining({ trapId: 84, organizationId: 2 }),
    );
  });

  test('a unique-to-inactive-owner-duplicate race rolls back without persistence or egress', async () => {
    const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.3', [
      { oid: '1.3.6.1.4.1.9.9', type: 4, value: 'private-varbind-value' },
    ]);
    const initialDevice = {
      id: 3,
      organization_id: 2,
      name: 'Initially unique',
      ip_address: '10.0.0.1',
      database_scope: 'primary',
    };
    tenantDeviceResolver.resolveDeviceByIp.mockResolvedValueOnce({
      device: initialDevice,
      matches: 1,
      ambiguous: false,
      incomplete: false,
      reason: null,
    });
    tenantDeviceResolver.lockSharedDeviceByIp.mockResolvedValueOnce({
      device: null,
      matches: 2,
      ambiguous: true,
      incomplete: false,
      reason: 'ambiguous_source_ip',
    });
    db.withPrimaryContext = jest.fn(callback => callback());
    db.withTenantContext = jest.fn((_organizationId, callback) => callback());
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    db.getConnection = jest.fn().mockResolvedValue(connection);

    await expect(handleTrap(null, notification)).resolves.toBeUndefined();

    expect(tenantDeviceResolver.lockSharedDeviceByIp).toHaveBeenCalledWith(
      '10.0.0.1',
      expect.any(Function),
    );
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.execute).not.toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(trapForwardingService.prepareTrapDeliveries).not.toHaveBeenCalled();
    expect(trapForwardingService.enqueuePreparedDeliveries).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  test('commits the trap and valid outbox rows when one matching rule fails inside its savepoint', async () => {
    const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.3');
    db.query.mockResolvedValueOnce([[{ id: 3, organization_id: 2, name: 'sw-01' }]]);
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn(async sql => {
        const quota = quotaSqlResult(sql);
        if (quota !== undefined) return quota;
        if (/INSERT INTO snmp_traps/.test(sql)) return [{ insertId: 81 }];
        if (/INSERT INTO snmp_trap_forwarding_deliveries/.test(sql)) return [{ insertId: 510 }];
        throw new Error(`Unexpected transaction SQL: ${sql}`);
      }),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    db.getConnection = jest.fn().mockResolvedValue(connection);
    trapForwardingService.prepareTrapDeliveries.mockImplementation(async (_trap, _device, options) => {
      await options.exec('INSERT INTO snmp_trap_forwarding_deliveries (...) VALUES (...)', []);
      return {
        matched_rules: 2,
        queued_deliveries: 1,
        delivery_ids: [510],
        selected_webhook_ids: [],
        errors: 1,
      };
    });

    await expect(handleTrap(null, notification)).resolves.toBeUndefined();

    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(trapForwardingService.enqueuePreparedDeliveries).toHaveBeenCalledWith([510], 2);
    expect(eventBus.emit).toHaveBeenCalledWith(
      'device.trap',
      expect.objectContaining({ organizationId: 2, trapId: 81 }),
    );
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  test('rolls back quota reservation, trap, and outbox together when work crashes after reservation', async () => {
    const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.3');
    db.query.mockResolvedValueOnce([[{ id: 3, organization_id: 2, name: 'sw-01' }]]);
    const connection = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn(async sql => {
        const quota = quotaSqlResult(sql);
        if (quota !== undefined) return quota;
        if (/INSERT INTO snmp_traps/.test(sql)) return [{ insertId: 82 }];
        throw new Error(`Unexpected transaction SQL: ${sql}`);
      }),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    db.getConnection = jest.fn().mockResolvedValue(connection);
    trapForwardingService.prepareTrapDeliveries.mockRejectedValueOnce(
      Object.assign(new Error('forwarding table is not migrated'), { code: 'ER_NO_SUCH_TABLE' }),
    );

    await expect(handleTrap(null, notification)).resolves.toBeUndefined();

    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.execute.mock.calls.some(([sql]) => /UPDATE snmp_trap_ingest_daily_usage/.test(sql))).toBe(true);
    expect(connection.execute.mock.calls.some(([sql]) => /INSERT INTO snmp_traps/.test(sql))).toBe(true);
    const quotaUpdateOrder = connection.execute.mock.calls.findIndex(
      ([sql]) => /UPDATE snmp_trap_ingest_daily_usage/.test(sql),
    );
    const trapInsertOrder = connection.execute.mock.calls.findIndex(
      ([sql]) => /INSERT INTO snmp_traps/.test(sql),
    );
    expect(quotaUpdateOrder).toBeLessThan(trapInsertOrder);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(trapForwardingService.enqueuePreparedDeliveries).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  test('an unknown source creates no database row, event, or forwarding work', async () => {
    const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.3');
    db.query.mockResolvedValueOnce([[]]);

    await handleTrap(null, notification);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toMatch(/FROM devices/);
    expect(db.query.mock.calls.some(([sql]) => /INSERT INTO snmp_traps/.test(sql))).toBe(false);
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(trapForwardingService.forwardTrap).not.toHaveBeenCalled();
  });

  test('an ambiguous source IP creates no row and never emits a tenant event', async () => {
    const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.3');
    db.query.mockResolvedValueOnce([[
      { id: 3, organization_id: 2, name: 'sw-org-2' },
      { id: 8, organization_id: 7, name: 'sw-org-7' },
    ]]);

    await handleTrap(null, notification);

    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls.some(([sql]) => /INSERT INTO snmp_traps/.test(sql))).toBe(false);
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(trapForwardingService.forwardTrap).not.toHaveBeenCalled();
  });

  test('an incomplete isolated lookup drops the payload before any primary persistence', async () => {
    const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.3', [
      { oid: '1.3.6.1.4.1.9.9', type: 4, value: 'tenant-secret-varbind' },
    ]);
    notification.pdu.community = 'tenant-secret-community';
    tenantDeviceResolver.resolveDeviceByIp.mockResolvedValueOnce({
      device: null,
      matches: 0,
      ambiguous: false,
      incomplete: true,
    });
    db.withPrimaryContext = jest.fn(callback => callback());
    db.withTenantContext = jest.fn((_organizationId, callback) => callback());

    await handleTrap(null, notification);

    expect(db.query).not.toHaveBeenCalled();
    expect(db.withPrimaryContext).not.toHaveBeenCalled();
    expect(db.withTenantContext).not.toHaveBeenCalled();
    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(trapForwardingService.forwardTrap).not.toHaveBeenCalled();
  });

  test('strips IPv4-mapped prefix from source IP', async () => {
    const notification = {
      rinfo: { address: '::ffff:10.0.0.1', port: 162 },
      accept: jest.fn(),
      pdu: { community: 'public', varbinds: [] },
    };
    db.query.mockResolvedValueOnce([[]]);

    await handleTrap(null, notification);
    expect(db.query.mock.calls[0][1]).toEqual(['10.0.0.1']);
  });
});

// ---------------------------------------------------------------------------
// start / stop lifecycle
// ---------------------------------------------------------------------------

describe('start() / stop()', () => {
  let mod;
  let freshSnmp;

  beforeEach(async () => {
    // Use the same already-loaded module and dependency instance. resetModules
    // can make the service close over a different virtual net-snmp mock when
    // this file runs with route suites that load the application first.
    await stop();
    jest.clearAllMocks();
    trapForwardingReadiness.invalidateSchemaReadinessCache();
    delete db.withPrimaryContext;
    delete db.withTenantContext;
    freshSnmp = snmp;
    mod = { start, stop };
  });

  afterEach(async () => {
    try { await mod.stop(); } catch { /* the test may already have stopped it */ }
    delete db.withPrimaryContext;
    delete db.withTenantContext;
  });

  test('receiver starts out null — no residue from a previous test', async () => {
    // The guard that makes the other three deterministic. If this ever fails,
    // the isolation is broken and the rest are meaningless.
    freshSnmp.createReceiver.mockReturnValue({ close: jest.fn() });
    await mod.start();
    expect(freshSnmp.createReceiver).toHaveBeenCalledTimes(1);
  });

  test('start() defaults to loopback IPv4 and passes the exact bind contract to net-snmp', async () => {
    const previous = process.env.SNMP_TRAP_BIND_IP;
    delete process.env.SNMP_TRAP_BIND_IP;
    freshSnmp.createReceiver.mockReturnValue({ close: jest.fn() });
    try {
      expect(configuredTrapBindIp()).toBe('127.0.0.1');
      await mod.start();
      expect(freshSnmp.createReceiver).toHaveBeenCalledWith(
        {
          port: expect.any(Number),
          address: '127.0.0.1',
          transport: 'udp4',
          disableAuthorization: true,
        },
        expect.any(Function),
      );
      expect(getStatus()).toMatchObject({ bind_ip: '127.0.0.1', ready: true });
    } finally {
      if (previous === undefined) delete process.env.SNMP_TRAP_BIND_IP;
      else process.env.SNMP_TRAP_BIND_IP = previous;
    }
  });

  test('receiver callback uses the real rinfo source for attribution and explicit forwarding', async () => {
    let receiverCallback;
    freshSnmp.createReceiver.mockImplementation((_options, callback) => {
      receiverCallback = callback;
      return { close: jest.fn() };
    });
    db.query
      .mockResolvedValueOnce([[{ id: 9, organization_id: 4, name: 'Real UDP peer' }]])
      .mockResolvedValueOnce([{ insertId: 88 }]);

    await mod.start();
    expect(receiverCallback).toEqual(expect.any(Function));
    const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.3');
    notification.rinfo.address = '10.0.0.9';
    expect(receiverCallback(null, notification)).toBe(true);
    while (getStatus().in_flight > 0) {
      await new Promise(resolve => global.setImmediate(resolve));
    }

    expect(db.query).toHaveBeenNthCalledWith(1, expect.stringContaining('FROM devices'), ['10.0.0.9']);
    expect(trapForwardingService.forwardTrap).toHaveBeenCalledWith(
      expect.objectContaining({ trapId: 88, organizationId: 4, sourceIp: '10.0.0.9' }),
      expect.objectContaining({ id: 9, organization_id: 4 }),
    );
  });

  test('stop() closes the receiver and sets it to null', async () => {
    const mockReceiver = { close: jest.fn() };
    freshSnmp.createReceiver.mockReturnValue(mockReceiver);
    await mod.start();
    await mod.stop();
    expect(mockReceiver.close).toHaveBeenCalled();
    // Second stop should be a no-op (no error)
    await expect(mod.stop()).resolves.toMatchObject({ drained: true });
  });

  test('start() is idempotent — only creates one receiver', async () => {
    freshSnmp.createReceiver.mockReturnValue({ close: jest.fn() });
    await mod.start();
    await mod.start(); // second call should be a no-op
    expect(freshSnmp.createReceiver).toHaveBeenCalledTimes(1);
  });

  test('an invalid configured port fails readiness without falling back to privileged UDP 162', async () => {
    const previous = process.env.SNMP_TRAP_PORT;
    process.env.SNMP_TRAP_PORT = 'not-a-port';
    try {
      await expect(mod.start()).resolves.toMatchObject({
        configured: false,
        port: null,
        state: 'failed',
        listening: false,
        ready: false,
        reason: 'invalid_port',
      });
      expect(freshSnmp.createReceiver).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.SNMP_TRAP_PORT;
      else process.env.SNMP_TRAP_PORT = previous;
    }
  });

  test('an invalid or IPv6 bind address fails readiness before creating a UDP socket', async () => {
    const previous = process.env.SNMP_TRAP_BIND_IP;
    process.env.SNMP_TRAP_BIND_IP = '::1';
    try {
      expect(configuredTrapBindIp()).toBeNull();
      await expect(mod.start()).resolves.toMatchObject({
        configured: false,
        bind_ip: null,
        state: 'failed',
        listening: false,
        ready: false,
        reason: 'invalid_bind_ip',
      });
      expect(freshSnmp.createReceiver).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.SNMP_TRAP_BIND_IP;
      else process.env.SNMP_TRAP_BIND_IP = previous;
    }
  });

  test('a bind failure such as EADDRINUSE makes listener readiness false', async () => {
    freshSnmp.createReceiver.mockImplementation(() => {
      throw Object.assign(new Error('address already in use'), { code: 'EADDRINUSE' });
    });

    await expect(mod.start()).resolves.toMatchObject({
      state: 'failed',
      listening: false,
      ready: false,
      reason: 'bind_failed',
    });
  });

  test('missing migration 459 fails before opening the UDP listener', async () => {
    db.withPrimaryContext = jest.fn(callback => callback());
    db.query.mockResolvedValueOnce([[]]);

    await expect(mod.start()).resolves.toMatchObject({
      state: 'failed',
      listening: false,
      ready: false,
      reason: 'primary_schema_unavailable',
    });
    expect(freshSnmp.createReceiver).not.toHaveBeenCalled();
  });

  test('isolated mode keeps minimal ingest ready but reports attribution unavailable', async () => {
    db.withPrimaryContext = jest.fn(callback => callback());
    db.query.mockImplementation(async (sql) => {
      if (/FROM schema_migrations/.test(sql)) {
        return [[{ filename: '459_activate_snmp_trap_forwarding.sql' }]];
      }
      if (/FROM information_schema\.columns/.test(sql)) {
        return [[{ required_columns: 27 }]];
      }
      if (/FROM organization_database_configs odc/.test(sql)) {
        return [[{ organization_id: 22 }]];
      }
      throw new Error(`Unexpected listener readiness SQL: ${sql}`);
    });
    freshSnmp.createReceiver.mockReturnValue({ close: jest.fn() });

    await expect(mod.start()).resolves.toMatchObject({
      state: 'listening',
      listening: true,
      ready: true,
      reason: null,
      attribution_ready: false,
      attribution_reason: 'isolated_tenant_attribution_unsupported',
    });
  });

  test('uses one process-global fixed in-flight cap instead of an unbounded per-source map', async () => {
    let releaseLookups;
    const blockedLookups = new Promise(resolve => { releaseLookups = resolve; });
    db.query.mockImplementation(sql => {
      if (/FROM devices/.test(sql)) return blockedLookups;
      if (/INSERT INTO snmp_traps/.test(sql)) return Promise.resolve([{ insertId: 90 }]);
      throw new Error(`Unexpected overload SQL: ${sql}`);
    });
    let receiverCallback;
    freshSnmp.createReceiver.mockImplementation((_options, callback) => {
      receiverCallback = callback;
      return { close: jest.fn() };
    });
    await mod.start();

    const notifications = Array.from({ length: MAX_IN_FLIGHT + 1 }, (_, index) => {
      const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.3');
      notification.rinfo.address = `10.0.1.${index + 1}`;
      return notification;
    });
    const accepted = notifications.map(notification => receiverCallback(null, notification));
    await new Promise(resolve => global.setImmediate(resolve));

    expect(accepted.filter(Boolean)).toHaveLength(MAX_IN_FLIGHT);
    expect(accepted.at(-1)).toBe(false);
    expect(getStatus()).toMatchObject({
      in_flight: MAX_IN_FLIGHT,
      dropped_overload_total: expect.any(Number),
    });
    expect(getStatus().dropped_overload_total).toBeGreaterThanOrEqual(1);

    releaseLookups([[]]);
    while (getStatus().in_flight > 0) {
      await new Promise(resolve => global.setImmediate(resolve));
    }
  });

  test('an unknown-source flood is source-limited before global capacity and cannot silence a known device', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000);
    try {
      const knownSource = '203.0.113.200';
      db.query.mockImplementation((sql, params = []) => {
        if (/FROM devices/.test(sql)) {
          return Promise.resolve(params[0] === knownSource
            ? [[{ id: 303, organization_id: 44, name: 'known-edge' }]]
            : [[]]);
        }
        if (/INSERT INTO snmp_traps/.test(sql)) return Promise.resolve([{ insertId: 92 }]);
        throw new Error(`Unexpected fairness SQL: ${sql}`);
      });
      let receiverCallback;
      freshSnmp.createReceiver.mockImplementation((_options, callback) => {
        receiverCallback = callback;
        return { close: jest.fn() };
      });
      await mod.start();
      const sourceDropsBefore = getStatus().dropped_source_rate_total;
      const unknownAccepted = [];

      for (let index = 0; index < RATE_BURST + 5; index++) {
        const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.3');
        notification.rinfo.address = '198.18.0.9';
        unknownAccepted.push(receiverCallback(null, notification));
        while (getStatus().in_flight > 0) {
          await new Promise(resolve => global.setImmediate(resolve));
        }
      }

      const legitimate = makeTrapV2('1.3.6.1.6.3.1.1.5.4');
      legitimate.rinfo.address = knownSource;
      expect(receiverCallback(null, legitimate)).toBe(true);
      while (getStatus().in_flight > 0) {
        await new Promise(resolve => global.setImmediate(resolve));
      }

      expect(unknownAccepted.filter(Boolean).length).toBeLessThanOrEqual(SOURCE_RATE_BURST);
      expect(getStatus().dropped_source_rate_total).toBeGreaterThan(sourceDropsBefore);
      expect(db.query.mock.calls.some(
        ([sql, params]) => /FROM devices/.test(sql) && params[0] === knownSource,
      )).toBe(true);
      expect(db.query.mock.calls.some(([sql]) => /INSERT INTO snmp_traps/.test(sql))).toBe(true);
      expect(eventBus.emit).toHaveBeenCalledWith(
        'device.trap',
        expect.objectContaining({ organizationId: 44, trapId: 92 }),
      );
    } finally {
      now.mockRestore();
    }
  });

  test('sustained unique-source traffic uses fixed counters instead of allocating per-source limiter state', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000);
    try {
      db.query.mockImplementation(sql => {
        if (/FROM devices/.test(sql)) return Promise.resolve([[]]);
        if (/INSERT INTO snmp_traps/.test(sql)) return Promise.resolve([{ insertId: 91 }]);
        throw new Error(`Unexpected rate-limit SQL: ${sql}`);
      });
      let receiverCallback;
      freshSnmp.createReceiver.mockImplementation((_options, callback) => {
        receiverCallback = callback;
        return { close: jest.fn() };
      });
      await mod.start();
      const statusKeys = Object.keys(getStatus()).sort();

      for (let index = 0; index < RATE_BURST + 25; index++) {
        const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.3');
        notification.rinfo.address = `198.18.${Math.floor(index / 250)}.${(index % 250) + 1}`;
        receiverCallback(null, notification);
        while (getStatus().in_flight > 0) {
          await new Promise(resolve => global.setImmediate(resolve));
        }
      }

      const status = getStatus();
      expect(Object.keys(status).sort()).toEqual(statusKeys);
      expect(status.dropped_rate_total).toBeGreaterThanOrEqual(25);
      expect(status.in_flight).toBe(0);
      expect(Object.values(status).some(value => value instanceof Map || value instanceof Set)).toBe(false);
      expect(JSON.stringify(status)).not.toMatch(/198\.18\./);
    } finally {
      now.mockRestore();
    }
  });
});
