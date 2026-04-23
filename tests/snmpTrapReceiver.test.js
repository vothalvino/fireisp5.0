// =============================================================================
// FireISP 5.0 — SNMP Trap Receiver Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('net-snmp', () => ({
  createReceiver: jest.fn(),
}));
jest.mock('../src/services/eventBus', () => ({
  emit: jest.fn(),
  on:   jest.fn(),
}));

const db       = require('../src/config/database');
const snmp     = require('net-snmp');
const eventBus = require('../src/services/eventBus');

const {
  lookupDevice,
  storeTrap,
  extractTrapInfo,
  serializeVarbind,
  handleTrap,
  start,
  stop,
  SNMP_TRAP_OID_MAP,
  V1_GENERIC_TRAP_MAP,
} = require('../src/services/snmpTrapReceiver');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrapV2(trapOid, extraVarbinds = []) {
  return {
    sender: { address: '10.0.0.1', port: 162 },
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
    sender: { address: '10.0.0.2', port: 162 },
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
      sender: { address: '10.0.0.1', port: 162 },
      accept: jest.fn(),
      pdu: { community: 'public', varbinds: [] },
    };
    const info = extractTrapInfo(notification);
    expect(info.trapType).toBe('unknown');
    expect(info.trapOid).toBeNull();
  });

  test('returns defaults when pdu is absent', () => {
    const info = extractTrapInfo({ pdu: null, sender: { address: '10.0.0.1' } });
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

  test('sets community from pdu', () => {
    const notification = makeV1Trap(0);
    const info = extractTrapInfo(notification);
    expect(info.community).toBe('private');
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
  });

  test('stores null for missing optional fields', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 1 }]);
    await storeTrap({ sourceIp: '1.2.3.4', trapType: 'unknown' });
    const callArgs = db.query.mock.calls[0][1];
    expect(callArgs[0]).toBeNull(); // organizationId
    expect(callArgs[1]).toBeNull(); // deviceId
  });
});

// ---------------------------------------------------------------------------
// handleTrap
// ---------------------------------------------------------------------------

describe('handleTrap()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('logs error and returns when error is passed', async () => {
    const err = new Error('UDP error');
    await handleTrap(err, null);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('calls accept() on notification', async () => {
    const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.4');
    db.query
      .mockResolvedValueOnce([[]])         // lookupDevice
      .mockResolvedValueOnce([{ insertId: 10 }]); // storeTrap

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
  });

  test('does NOT emit event when device is unknown', async () => {
    const notification = makeTrapV2('1.3.6.1.6.3.1.1.5.3');
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 21 }]);

    await handleTrap(null, notification);
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  test('strips IPv4-mapped prefix from source IP', async () => {
    const notification = {
      sender: { address: '::ffff:10.0.0.1', port: 162 },
      accept: jest.fn(),
      pdu: { community: 'public', varbinds: [] },
    };
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 30 }]);

    await handleTrap(null, notification);
    const insertCall = db.query.mock.calls[1];
    expect(insertCall[1][2]).toBe('10.0.0.1');
  });
});

// ---------------------------------------------------------------------------
// start / stop lifecycle
// ---------------------------------------------------------------------------

describe('start() / stop()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the module-level `receiver` reference between tests
    stop(); // Ensure stopped before each test
  });

  test('start() calls snmp.createReceiver', () => {
    const mockReceiver = { close: jest.fn() };
    snmp.createReceiver.mockReturnValue(mockReceiver);
    start();
    expect(snmp.createReceiver).toHaveBeenCalledWith(
      expect.objectContaining({ disableAuthorization: true }),
      expect.any(Function),
    );
  });

  test('stop() closes the receiver and sets it to null', () => {
    const mockReceiver = { close: jest.fn() };
    snmp.createReceiver.mockReturnValue(mockReceiver);
    start();
    stop();
    expect(mockReceiver.close).toHaveBeenCalled();
    // Second stop should be a no-op (no error)
    expect(() => stop()).not.toThrow();
  });

  test('start() is idempotent — only creates one receiver', () => {
    const mockReceiver = { close: jest.fn() };
    snmp.createReceiver.mockReturnValue(mockReceiver);
    start();
    start(); // second call should be a no-op
    expect(snmp.createReceiver).toHaveBeenCalledTimes(1);
    stop();
  });
});
