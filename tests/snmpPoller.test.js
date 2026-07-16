// =============================================================================
// FireISP 5.0 — SNMP Poller Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/utils/encryption', () => ({
  decrypt: jest.fn(v => v),  // identity by default (no ENCRYPTION_KEY in tests)
}));

jest.mock('net-snmp', () => ({
  Version1: 0,
  Version2c: 1,
  Version3: 3,
  SecurityLevel: { noAuthNoPriv: 1, authNoPriv: 2, authPriv: 3 },
  AuthProtocols:  { none: 1, md5: 2, sha: 3, sha224: 4, sha256: 5, sha384: 6, sha512: 7 },
  PrivProtocols:  { none: 1, des: 2, aes: 4, aes256b: 6, aes256r: 8 },
  createSession:   jest.fn(),
  createV3Session: jest.fn(),
  isVarbindError:  jest.fn(),
}));

jest.mock('../src/utils/logger', () => {
  const mock = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => mock),
  };
  return mock;
});

const db = require('../src/config/database');
const snmp = require('net-snmp');
const { decrypt } = require('../src/utils/encryption');
const logger = require('../src/utils/logger');
const snmpPoller = require('../src/services/snmpPoller');

describe('snmpPoller', () => {
  let mockSession;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSession = {
      get: jest.fn(),
      subtree: jest.fn(),
      close: jest.fn(),
    };
    snmp.createSession.mockReturnValue(mockSession);
    snmp.createV3Session.mockReturnValue(mockSession);
    snmp.isVarbindError.mockReturnValue(false);
  });

  // =========================================================================
  // poll
  // =========================================================================
  describe('poll()', () => {
    test('returns counts when no devices are SNMP-enabled', async () => {
      db.query.mockResolvedValueOnce([[]]);

      const result = await snmpPoller.poll();
      expect(result).toEqual({ polled: 0, errors: 0, total: 0 });
    });

    test('polls devices and returns success counts', async () => {
      const device = {
        id: 1, ip_address: '192.168.1.1', snmp_community: 'public',
        snmp_version: 'v2c', snmp_port: 161, snmp_profile_id: 10,
      };
      db.query
        .mockResolvedValueOnce([[device]])  // devices list
        .mockResolvedValueOnce([[{           // profile OIDs
          id: 1, oid: '1.3.6.1.2.1.1.3', metric_column: 'cpu_usage',
          label: 'CPU', oid_type: 'gauge', is_per_interface: false,
        }]])
        .mockResolvedValueOnce([])           // INSERT metric row
        // deviceStatusService.recordPollResult(1, true):
        .mockResolvedValueOnce([{ affectedRows: 0 }]) // flip-to-online UPDATE (already online, no match)
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // quiet bookkeeping UPDATE (last_polled_at/status)

      mockSession.get.mockImplementation((oids, cb) => {
        cb(null, [{ oid: '1.3.6.1.2.1.1.3', value: 55 }]);
      });

      const result = await snmpPoller.poll();
      expect(result.polled).toBe(1);
      expect(result.errors).toBe(0);
      expect(mockSession.close).toHaveBeenCalled();
    });

    test('counts errors when device polling fails', async () => {
      const device = {
        id: 2, ip_address: '10.0.0.1', snmp_community: 'private',
        snmp_version: 'v1', snmp_port: 161, snmp_profile_id: 5,
      };
      db.query
        .mockResolvedValueOnce([[device]])
        .mockResolvedValueOnce([[{
          id: 1, oid: '1.3.6.1.2.1.1.3', metric_column: 'cpu_usage',
          label: 'CPU', oid_type: 'gauge', is_per_interface: false,
        }]])
        // deviceStatusService.recordPollResult(2, false, ...):
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // increment UPDATE (last_poll_error/consecutive_poll_failures)
        .mockResolvedValueOnce([{ affectedRows: 0 }]); // flip-to-offline UPDATE (below threshold, no match)

      mockSession.get.mockImplementation((oids, cb) => {
        cb(new Error('SNMP timeout'));
      });

      const result = await snmpPoller.poll();
      expect(result.errors).toBe(1);
      expect(result.polled).toBe(0);
    });
  });

  // =========================================================================
  // pollDevice
  // =========================================================================
  describe('pollDevice()', () => {
    test('skips device with no active OIDs', async () => {
      db.query.mockResolvedValueOnce([[]]);

      const device = { id: 1, ip_address: '10.0.0.1', snmp_community: 'public', snmp_version: 'v2c', snmp_port: 161, snmp_profile_id: 1 };
      await snmpPoller.pollDevice(device);

      expect(snmp.createSession).not.toHaveBeenCalled();
      expect(snmp.createV3Session).not.toHaveBeenCalled();
    });

    test('handles per-interface OIDs via subtree walk', async () => {
      const device = {
        id: 3, ip_address: '10.0.0.2', snmp_community: 'public',
        snmp_version: 'v2c', snmp_port: 161, snmp_profile_id: 2,
      };
      db.query
        .mockResolvedValueOnce([[{
          id: 1, oid: '1.3.6.1.2.1.2.2.1.10', metric_column: 'if_in_octets',
          label: 'In Octets', oid_type: 'counter', is_per_interface: true,
        }]])
        .mockResolvedValueOnce([]);  // INSERT metric row

      mockSession.subtree.mockImplementation((oid, feedCb, doneCb) => {
        feedCb([{ oid: '1.3.6.1.2.1.2.2.1.10.1', value: 12345 }]);
        doneCb(null);
      });

      await snmpPoller.pollDevice(device);
      expect(mockSession.subtree).toHaveBeenCalled();
      const insertCall = db.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO snmp_metrics'));
      expect(insertCall).toBeDefined();
      const [insertSql, insertParams] = insertCall;
      // Regression guard: §9.1 wireless cols + uptime must be in the INSERT list
      // (they were previously in VALID_METRIC_COLUMNS but silently dropped).
      expect(insertSql).toContain('noise_floor_dbm');
      expect(insertSql).toContain('uptime_ticks');
      // Placeholder count must match the params array length.
      expect((insertSql.match(/\?/g) || []).length).toBe(insertParams.length);
    });
  });

  // =========================================================================
  // pollDevice() — metric sanitation, ingest/reachability decoupling,
  // and honest reachability (migration 398)
  // =========================================================================
  describe('pollDevice() — sanitation & reachability (migration 398)', () => {
    test('nulls an out-of-range scalar value but still inserts the row with the other valid columns; poll succeeds', async () => {
      const device = {
        id: 20, ip_address: '10.0.1.1', snmp_community: 'public',
        snmp_version: 'v2c', snmp_port: 161, snmp_profile_id: 1,
      };
      db.query
        .mockResolvedValueOnce([[
          { id: 1, oid: '1.3.6.1.2.1.25.3.3.1.2', metric_column: 'cpu_usage', label: 'CPU', oid_type: 'gauge', is_per_interface: false, transform: null },
          { id: 2, oid: '1.3.6.1.2.1.25.2.3.1.6', metric_column: 'memory_usage', label: 'Mem', oid_type: 'gauge', is_per_interface: false, transform: null },
        ]])
        .mockResolvedValueOnce([]); // INSERT metric row

      mockSession.get.mockImplementation((oids, cb) => {
        cb(null, [
          { oid: '1.3.6.1.2.1.25.3.3.1.2', value: 42 },
          // Raw hrStorageUsed allocation units (migration 031's broken seed,
          // removed by migration 398) — must never overflow the SMALLINT
          // memory_usage column and abort the poll.
          { oid: '1.3.6.1.2.1.25.2.3.1.6', value: 302552 },
        ]);
      });

      await expect(snmpPoller.pollDevice(device)).resolves.toBeUndefined();

      const insertCall = db.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO snmp_metrics'));
      expect(insertCall).toBeDefined();
      const [, params] = insertCall;
      // Param order: deviceId, interfaceId, if_in_octets, if_out_octets,
      // if_in_errors, if_out_errors, cpu_usage(6), memory_usage(7), ...
      expect(params[6]).toBe(42);
      expect(params[7]).toBeNull();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ column: 'memory_usage', value: 302552 }),
        expect.stringContaining('out of range'),
      );
    });

    test('a scalar metric ingest (DB) failure does not abort per-interface polling and does not fail the poll', async () => {
      const device = {
        id: 21, ip_address: '10.0.1.2', snmp_community: 'public',
        snmp_version: 'v2c', snmp_port: 161, snmp_profile_id: 2,
      };
      db.query
        .mockResolvedValueOnce([[
          { id: 1, oid: '1.3.6.1.2.1.1.3.0', metric_column: 'uptime_ticks', label: 'Uptime', oid_type: 'timeticks', is_per_interface: false, transform: null },
          { id: 2, oid: '1.3.6.1.2.1.2.2.1.10', metric_column: 'if_in_octets', label: 'In Octets', oid_type: 'counter', is_per_interface: true, transform: null },
        ]])
        .mockRejectedValueOnce(new Error('DB write failed'))   // scalar INSERT rejects
        .mockResolvedValueOnce([]);                             // per-interface INSERT succeeds

      mockSession.get.mockImplementation((oids, cb) => {
        cb(null, [{ oid: '1.3.6.1.2.1.1.3.0', value: 12345 }]);
      });
      mockSession.subtree.mockImplementation((oid, feedCb, doneCb) => {
        feedCb([{ oid: '1.3.6.1.2.1.2.2.1.10.1', value: 999 }]);
        doneCb(null);
      });

      await expect(snmpPoller.pollDevice(device)).resolves.toBeUndefined();

      expect(mockSession.subtree).toHaveBeenCalled(); // pollInterfaces still ran
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 21 }),
        expect.stringContaining('scalar metric ingest failed'),
      );
    });

    test('a per-interface-only profile with every subtree walk failing is reported unreachable', async () => {
      const device = {
        id: 22, ip_address: '10.0.1.3', snmp_community: 'public',
        snmp_version: 'v2c', snmp_port: 161, snmp_profile_id: 3,
      };
      db.query.mockResolvedValueOnce([[
        { id: 1, oid: '1.3.6.1.2.1.2.2.1.10', metric_column: 'if_in_octets', label: 'In Octets', oid_type: 'counter', is_per_interface: true, transform: null },
      ]]);

      mockSession.subtree.mockImplementation((oid, feedCb, doneCb) => {
        doneCb(new Error('timeout'));
      });

      await expect(snmpPoller.pollDevice(device)).rejects.toThrow(/unreachable/);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 22 }),
        expect.stringContaining('subtree walk failed'),
      );
    });

    test('a per-interface-only profile with a successful walk succeeds and inserts rows', async () => {
      const device = {
        id: 23, ip_address: '10.0.1.4', snmp_community: 'public',
        snmp_version: 'v2c', snmp_port: 161, snmp_profile_id: 4,
      };
      db.query
        .mockResolvedValueOnce([[
          { id: 1, oid: '1.3.6.1.2.1.2.2.1.10', metric_column: 'if_in_octets', label: 'In Octets', oid_type: 'counter', is_per_interface: true, transform: null },
        ]])
        .mockResolvedValueOnce([]);

      mockSession.subtree.mockImplementation((oid, feedCb, doneCb) => {
        feedCb([{ oid: '1.3.6.1.2.1.2.2.1.10.7', value: 555 }]);
        doneCb(null);
      });

      await expect(snmpPoller.pollDevice(device)).resolves.toBeUndefined();
      const insertCall = db.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO snmp_metrics'));
      expect(insertCall).toBeDefined();
    });

    test('a scalar varbind value of 0 (e.g. sysUpTime right after reboot) counts as reachable, not unreachable', async () => {
      const device = {
        id: 24, ip_address: '10.0.1.5', snmp_community: 'public',
        snmp_version: 'v2c', snmp_port: 161, snmp_profile_id: 5,
      };
      db.query
        .mockResolvedValueOnce([[
          { id: 1, oid: '1.3.6.1.2.1.1.3.0', metric_column: 'uptime_ticks', label: 'Uptime', oid_type: 'timeticks', is_per_interface: false, transform: null },
        ]])
        .mockResolvedValueOnce([]);

      mockSession.get.mockImplementation((oids, cb) => {
        cb(null, [{ oid: '1.3.6.1.2.1.1.3.0', value: 0 }]);
      });

      await expect(snmpPoller.pollDevice(device)).resolves.toBeUndefined();

      const insertCall = db.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO snmp_metrics'));
      expect(insertCall).toBeDefined();
      const [, params] = insertCall;
      expect(params[params.length - 1]).toBe(0); // uptime_ticks is the last bound column
    });
  });

  // =========================================================================
  // poll() — reachability failure still reports through recordPollResult
  // =========================================================================
  describe('poll() — reachability (migration 398)', () => {
    test('a device that answers no OIDs at all is recorded as a poll failure', async () => {
      const device = {
        id: 25, ip_address: '10.0.1.6', snmp_community: 'public',
        snmp_version: 'v2c', snmp_port: 161, snmp_profile_id: 6,
      };
      db.query
        .mockResolvedValueOnce([[device]]) // devices list
        .mockResolvedValueOnce([[           // profile OIDs — scalar only
          { id: 1, oid: '1.3.6.1.2.1.1.3.0', metric_column: 'uptime_ticks', label: 'Uptime', oid_type: 'timeticks', is_per_interface: false, transform: null },
        ]])
        // deviceStatusService.recordPollResult(25, false, ...):
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([{ affectedRows: 0 }]);

      // Every varbind comes back as an SNMP error (isVarbindError=true) —
      // nothing actually responded, even though session.get() itself succeeds.
      snmp.isVarbindError.mockReturnValue(true);
      mockSession.get.mockImplementation((oids, cb) => {
        cb(null, [{ oid: '1.3.6.1.2.1.1.3.0', value: null }]);
      });

      const result = await snmpPoller.poll();
      expect(result.errors).toBe(1);
      expect(result.polled).toBe(0);
    });
  });

  // =========================================================================
  // applyTransform() — snmp_profile_oids.transform expression parser
  // =========================================================================
  describe('applyTransform()', () => {
    test('applies a division transform', () => {
      expect(snmpPoller.applyTransform(1000, 'value / 10')).toBe(100);
    });

    test('applies a multiplication transform', () => {
      expect(snmpPoller.applyTransform(5, 'value * -1')).toBe(-5);
    });

    test('is whitespace-tolerant', () => {
      expect(snmpPoller.applyTransform(20, '  value/4  ')).toBe(5);
    });

    test('falls back to the raw value and warns on an unrecognized expression', () => {
      expect(snmpPoller.applyTransform(42, 'value + 1')).toBe(42);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ expr: 'value + 1' }),
        expect.stringContaining('unrecognized transform expression'),
      );
    });

    test('never evaluates an injection attempt — falls back to the raw value', () => {
      const malicious = 'value; require("child_process").execSync("id")';
      expect(snmpPoller.applyTransform(7, malicious)).toBe(7);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ expr: malicious }),
        expect.any(String),
      );
    });

    test('rejects a division by zero operand and falls back to the raw value', () => {
      expect(snmpPoller.applyTransform(9, 'value / 0')).toBe(9);
    });

    test('returns null/undefined values unchanged without consulting the expression', () => {
      expect(snmpPoller.applyTransform(null, 'value / 10')).toBeNull();
      expect(snmpPoller.applyTransform(undefined, 'value / 10')).toBeUndefined();
    });

    test('passes through when there is no transform expression', () => {
      expect(snmpPoller.applyTransform(15, null)).toBe(15);
      expect(snmpPoller.applyTransform(15, undefined)).toBe(15);
    });
  });

  // =========================================================================
  // SNMPv3 session creation
  // =========================================================================
  describe('createSnmpSession()', () => {
    test('uses createV3Session for snmp_version=v3', () => {
      const device = {
        id: 10, ip_address: '10.0.0.10', snmp_version: 'v3', snmp_port: 161,
        snmp_v3_security_name: 'fireadmin',
        snmp_v3_auth_protocol: 'sha',
        snmp_v3_auth_key_encrypted: 'authsecret',
        snmp_v3_priv_protocol: 'aes128',
        snmp_v3_priv_key_encrypted: 'privsecret',
        snmp_v3_context_name: '',
      };
      decrypt.mockImplementation(v => v + '_decrypted');

      snmpPoller.createSnmpSession(device);

      expect(snmp.createV3Session).toHaveBeenCalledWith(
        '10.0.0.10',
        expect.objectContaining({
          name: 'fireadmin',
          level: snmp.SecurityLevel.authPriv,
          authProtocol: snmp.AuthProtocols.sha,
          authKey: 'authsecret_decrypted',
          privProtocol: snmp.PrivProtocols.aes,
          privKey: 'privsecret_decrypted',
        }),
        expect.objectContaining({ port: 161 }),
      );
      expect(snmp.createSession).not.toHaveBeenCalled();
    });

    test('uses createV3Session with AES-256 priv protocol', () => {
      const device = {
        id: 11, ip_address: '10.0.0.11', snmp_version: 'v3', snmp_port: 161,
        snmp_v3_security_name: 'admin256',
        snmp_v3_auth_protocol: 'sha256',
        snmp_v3_auth_key_encrypted: 'authkey256',
        snmp_v3_priv_protocol: 'aes256',
        snmp_v3_priv_key_encrypted: 'privkey256',
        snmp_v3_context_name: 'ctx1',
      };
      decrypt.mockImplementation(v => v);

      snmpPoller.createSnmpSession(device);

      expect(snmp.createV3Session).toHaveBeenCalledWith(
        '10.0.0.11',
        expect.objectContaining({
          authProtocol: snmp.AuthProtocols.sha256,
          privProtocol: snmp.PrivProtocols.aes256b,
          level: snmp.SecurityLevel.authPriv,
        }),
        expect.objectContaining({ context: 'ctx1' }),
      );
    });

    test('resolves authNoPriv level when no priv key present', () => {
      const device = {
        id: 12, ip_address: '10.0.0.12', snmp_version: 'v3', snmp_port: 161,
        snmp_v3_security_name: 'authonly',
        snmp_v3_auth_protocol: 'sha',
        snmp_v3_auth_key_encrypted: 'authsecret',
        snmp_v3_priv_protocol: 'none',
        snmp_v3_priv_key_encrypted: null,
        snmp_v3_context_name: '',
      };
      decrypt.mockImplementation(v => v);

      snmpPoller.createSnmpSession(device);

      expect(snmp.createV3Session).toHaveBeenCalledWith(
        '10.0.0.12',
        expect.objectContaining({ level: snmp.SecurityLevel.authNoPriv }),
        expect.anything(),
      );
    });

    test('resolves noAuthNoPriv level when no credentials set', () => {
      const device = {
        id: 13, ip_address: '10.0.0.13', snmp_version: 'v3', snmp_port: 161,
        snmp_v3_security_name: 'noauth',
        snmp_v3_auth_protocol: 'none',
        snmp_v3_auth_key_encrypted: null,
        snmp_v3_priv_protocol: 'none',
        snmp_v3_priv_key_encrypted: null,
        snmp_v3_context_name: '',
      };

      snmpPoller.createSnmpSession(device);

      expect(snmp.createV3Session).toHaveBeenCalledWith(
        '10.0.0.13',
        expect.objectContaining({ level: snmp.SecurityLevel.noAuthNoPriv }),
        expect.anything(),
      );
    });

    test('falls back to createSession for v2c', () => {
      const device = {
        id: 14, ip_address: '10.0.0.14', snmp_community: 'public',
        snmp_version: 'v2c', snmp_port: 161,
      };

      snmpPoller.createSnmpSession(device);

      expect(snmp.createSession).toHaveBeenCalledWith(
        '10.0.0.14', 'public',
        expect.objectContaining({ version: snmp.Version2c }),
      );
      expect(snmp.createV3Session).not.toHaveBeenCalled();
    });

    test('falls back to createSession for v1', () => {
      const device = {
        id: 15, ip_address: '10.0.0.15', snmp_community: 'private',
        snmp_version: 'v1', snmp_port: 161,
      };

      snmpPoller.createSnmpSession(device);

      expect(snmp.createSession).toHaveBeenCalledWith(
        '10.0.0.15', 'private',
        expect.objectContaining({ version: snmp.Version1 }),
      );
    });
  });

  // =========================================================================
  // mapAuthProtocol / mapPrivProtocol / resolveSecurityLevel
  // =========================================================================
  describe('mapAuthProtocol()', () => {
    test('maps md5', () => expect(snmpPoller.mapAuthProtocol('md5')).toBe(snmp.AuthProtocols.md5));
    test('maps sha (default)', () => expect(snmpPoller.mapAuthProtocol('sha')).toBe(snmp.AuthProtocols.sha));
    test('maps sha256', () => expect(snmpPoller.mapAuthProtocol('sha256')).toBe(snmp.AuthProtocols.sha256));
    test('maps sha512', () => expect(snmpPoller.mapAuthProtocol('sha512')).toBe(snmp.AuthProtocols.sha512));
    test('defaults to sha for unknown', () => expect(snmpPoller.mapAuthProtocol(null)).toBe(snmp.AuthProtocols.sha));
  });

  describe('mapPrivProtocol()', () => {
    test('maps des', () => expect(snmpPoller.mapPrivProtocol('des')).toBe(snmp.PrivProtocols.des));
    test('maps aes128 (default)', () => expect(snmpPoller.mapPrivProtocol('aes128')).toBe(snmp.PrivProtocols.aes));
    test('maps aes256 to aes256b', () => expect(snmpPoller.mapPrivProtocol('aes256')).toBe(snmp.PrivProtocols.aes256b));
    test('defaults to aes for unknown', () => expect(snmpPoller.mapPrivProtocol(null)).toBe(snmp.PrivProtocols.aes));
  });

  describe('resolveSecurityLevel()', () => {
    test('authPriv when both keys set', () => {
      expect(snmpPoller.resolveSecurityLevel('authkey', 'privkey', 'sha', 'aes128'))
        .toBe(snmp.SecurityLevel.authPriv);
    });
    test('authNoPriv when only auth key set', () => {
      expect(snmpPoller.resolveSecurityLevel('authkey', '', 'sha', 'none'))
        .toBe(snmp.SecurityLevel.authNoPriv);
    });
    test('noAuthNoPriv when neither key set', () => {
      expect(snmpPoller.resolveSecurityLevel('', '', 'none', 'none'))
        .toBe(snmp.SecurityLevel.noAuthNoPriv);
    });
    test('noAuthNoPriv when auth proto is none even with key', () => {
      expect(snmpPoller.resolveSecurityLevel('somekey', 'privkey', 'none', 'aes128'))
        .toBe(snmp.SecurityLevel.noAuthNoPriv);
    });
  });
});
