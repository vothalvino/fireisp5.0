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

const db = require('../src/config/database');
const snmp = require('net-snmp');
const { decrypt } = require('../src/utils/encryption');
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
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE last_polled_at

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
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE last_poll_error

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
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO snmp_metrics'),
        expect.any(Array),
      );
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
