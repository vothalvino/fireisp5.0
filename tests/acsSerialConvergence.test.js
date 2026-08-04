'use strict';
// =============================================================================
// FireISP 5.0 — TR-069 identity convergence: Inform serial → inventory unit
// =============================================================================
// The inventory flow mints cpe_devices rows with oui = NULL (PO receive and
// install-time registration both hardcode it), while the ACS resolved devices
// by serial+oui — so the first Inform of every inventory-tracked unit created
// a DUPLICATE row and the serial the tech recorded at install did nothing for
// TR-069. These tests pin the fix:
//   * an Inform whose serial matches a NULL-OUI inventory row ADOPTS that row
//     (no duplicate insert) and backfills OUI/identity;
//   * a row whose OUI is already known and DIFFERENT is a different physical
//     device — never adopted (no cross-vendor serial hijack);
//   * auto-link strategy 0: a row assigned to a contract links straight to
//     that contract's client, and refuses on an org mismatch.
// =============================================================================

const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/services/cwmpSessionService', () => ({
  handleInform: jest.fn().mockResolvedValue({ tasks: [] }),
  getNextTask: jest.fn().mockResolvedValue(null),
  buildResponseForTask: jest.fn().mockReturnValue(null),
  processTaskResponse: jest.fn().mockResolvedValue(undefined),
  applyZeroTouchProvisioning: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/cpeSessionLogService', () => ({
  logSessionEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/cpeDiagnosticsService', () => ({
  handleDiagnosticsComplete: jest.fn().mockResolvedValue(undefined),
}));

const db = require('../src/config/database');
const app = require('../src/app');
const cpeInventoryService = require('../src/services/cpeInventoryService');

const INFORM = (serial, oui) => `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header><cwmp:ID soapenv:mustUnderstand="1">1</cwmp:ID></soapenv:Header>
  <soapenv:Body>
    <cwmp:Inform>
      <DeviceId>
        <Manufacturer>Acme</Manufacturer>
        <OUI>${oui}</OUI>
        <ProductClass>RGEW1300G</ProductClass>
        <SerialNumber>${serial}</SerialNumber>
      </DeviceId>
      <Event><EventStruct><EventCode>1 BOOT</EventCode><CommandKey></CommandKey></EventStruct></Event>
      <MaxEnvelopes>1</MaxEnvelopes>
      <CurrentTime>2026-08-04T12:00:00</CurrentTime>
      <RetryCount>0</RetryCount>
      <ParameterList></ParameterList>
    </cwmp:Inform>
  </soapenv:Body>
</soapenv:Envelope>`;

const INV_ROW = {
  id: 42, organization_id: 1, serial_number: 'RGEW-0001', oui: null,
  product_class: null, manufacturer: null, hardware_version: null, software_version: null,
  inventory_item_id: 9, contract_id: 7, subscriber_id: null, acs_username: null,
  lifecycle_state: 'assigned', deleted_at: null,
};

beforeEach(() => jest.clearAllMocks());

function callsMatching(re) {
  return db.query.mock.calls.filter(([sql]) => re.test(sql));
}

describe('Inform resolution', () => {
  it('adopts the NULL-OUI inventory row for its serial and backfills identity — no duplicate', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/serial_number = \? AND oui = \?/.test(sql)) return [[]];
      if (/oui IS NULL/.test(sql)) return [[{ ...INV_ROW }]];
      if (/^UPDATE cpe_devices SET\s+oui = \?/m.test(sql) || /oui = \?,/.test(sql)) return [{ affectedRows: 1 }];
      if (/SELECT \* FROM cpe_devices WHERE id = \?/.test(sql)) return [[{ ...INV_ROW, oui: 'EC1724' }]];
      if (/UPDATE cpe_devices SET last_inform_ip/.test(sql)) return [{ affectedRows: 1 }];
      if (/FROM contracts c/.test(sql)) return [[{ client_id: 99, organization_id: 1 }]];
      if (/SET subscriber_id = \?/.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    });

    const res = await request(app)
      .post('/acs/cwmp')
      .set('Content-Type', 'text/xml')
      .send(INFORM('RGEW-0001', 'EC1724'));

    expect(res.status).toBe(200);
    // Adopted, not duplicated:
    expect(callsMatching(/INSERT INTO `?cpe_devices`?/i)).toHaveLength(0);
    // OUI backfilled onto the inventory row:
    const backfill = callsMatching(/oui = \?/).find(([sql]) => /^UPDATE cpe_devices/i.test(sql.trim()));
    expect(backfill).toBeDefined();
    expect(backfill[1]).toContain('EC1724');
    // Strategy 0 linked the contract's client:
    const link = callsMatching(/SET subscriber_id = \?/);
    expect(link).toHaveLength(1);
    expect(link[0][1][0]).toBe(99);
  });

  it('never adopts a row whose OUI is known and different — auto-registers instead', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/serial_number = \? AND oui = \?/.test(sql)) return [[]];
      // NULL-OUI lookup finds nothing: the only row with this serial has a
      // DIFFERENT recorded OUI, which the query's `oui IS NULL` excludes.
      if (/oui IS NULL/.test(sql)) return [[]];
      if (/^INSERT INTO `?cpe_devices`?/i.test(sql.trim())) return [{ insertId: 77, affectedRows: 1 }];
      if (/SELECT \* FROM `?cpe_devices`?.*WHERE.*id/i.test(sql)) {
        return [[{ id: 77, serial_number: 'RGEW-0001', oui: 'AABBCC', contract_id: null, subscriber_id: null, organization_id: null }]];
      }
      if (/UPDATE cpe_devices SET last_inform_ip/.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    });

    const res = await request(app)
      .post('/acs/cwmp')
      .set('Content-Type', 'text/xml')
      .send(INFORM('RGEW-0001', 'AABBCC'));

    expect(res.status).toBe(200);
    expect(callsMatching(/INSERT INTO `?cpe_devices`?/i).length).toBeGreaterThan(0);
  });
});

describe('tryAutoLinkSubscriber strategy 0 — the row own contract', () => {
  it('links to the contract client', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM contracts c/.test(sql)) return [[{ client_id: 55, organization_id: 1 }]];
      if (/SET subscriber_id = \?/.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    });
    await cpeInventoryService.tryAutoLinkSubscriber({ ...INV_ROW });
    const link = callsMatching(/SET subscriber_id = \?/);
    expect(link).toHaveLength(1);
    expect(link[0][1][0]).toBe(55);
  });

  it('refuses on an org mismatch and falls through without linking', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM contracts c/.test(sql)) return [[{ client_id: 55, organization_id: 2 }]];
      return [[]];
    });
    await cpeInventoryService.tryAutoLinkSubscriber({ ...INV_ROW, organization_id: 1 });
    expect(callsMatching(/SET subscriber_id = \?/)).toHaveLength(0);
  });

  it('does nothing when the row is already linked', async () => {
    await cpeInventoryService.tryAutoLinkSubscriber({ ...INV_ROW, subscriber_id: 99 });
    expect(db.query).not.toHaveBeenCalled();
  });
});
