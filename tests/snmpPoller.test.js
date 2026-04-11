// =============================================================================
// FireISP 5.0 — SNMP Poller Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('net-snmp', () => ({
  Version1: 0,
  Version2c: 1,
  createSession: jest.fn(),
  isVarbindError: jest.fn(),
}));

const db = require('../src/config/database');
const snmp = require('net-snmp');
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
        .mockResolvedValueOnce([]);          // INSERT metric row

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
        }]]);

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
});
