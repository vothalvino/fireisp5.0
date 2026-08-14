// =============================================================================
// RADIUS accounting M2M mount-order and tenant-attribution regression
// =============================================================================

const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(),
  pool: { end: jest.fn() },
}));
jest.mock('../src/services/radiusAccountingService', () => ({ ingestAccounting: jest.fn() }));

const db = require('../src/config/database');
const accountingService = require('../src/services/radiusAccountingService');
const app = require('../src/app');

describe('RADIUS accounting route mount order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RADIUS_ACCOUNTING_SECRET = 'accounting-secret';
    db.query.mockResolvedValue([[{ id: 12, organization_id: 88 }]]);
    accountingService.ingestAccounting.mockResolvedValue({ action: 'insert', id: 91, macMove: false });
  });

  afterAll(() => { delete process.env.RADIUS_ACCOUNTING_SECRET; });

  test('shared-secret POST reaches M2M handler without JWT and uses NAS tenant ownership', async () => {
    const res = await request(app)
      .post('/api/v1/radius/accounting')
      .set('X-Radius-Secret', 'accounting-secret')
      .send({
        'Acct-Status-Type': 'Start',
        'User-Name': 'alice',
        'Acct-Session-Id': 'session-1',
        'NAS-IP-Address': '10.0.0.12',
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, action: 'insert', id: 91 });
    expect(accountingService.ingestAccounting).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 88,
      nasId: 12,
      nasIpAddress: '10.0.0.12',
      userName: 'alice',
    }));
    expect(db.query.mock.calls[0][0]).toContain("odc.isolation_mode = 'isolated'");
  });

  test('accepts the native FreeRADIUS 3 rlm_rest JSON attribute envelope', async () => {
    const attr = (type, value) => ({ type, value: [value] });
    const res = await request(app)
      .post('/api/v1/radius/accounting')
      .set('X-Radius-Secret', 'accounting-secret')
      .send({
        'Acct-Status-Type': attr('string', 'Interim-Update'),
        'User-Name': attr('string', 'alice'),
        'Acct-Session-Id': attr('string', 'session-1'),
        'NAS-IP-Address': attr('ipaddr', '10.0.0.12'),
        'Acct-Input-Octets': attr('integer', 2048),
      });

    expect(res.status).toBe(200);
    expect(accountingService.ingestAccounting).toHaveBeenCalledWith(expect.objectContaining({
      acctStatusType: 'Interim-Update',
      userName: 'alice',
      acctSessionId: 'session-1',
      nasIpAddress: '10.0.0.12',
      acctInputOctets: 2048,
      organizationId: 88,
      nasId: 12,
    }));
  });

  test.each(['Accounting-On', 'Accounting-Off'])(
    'accepts a minimal native %s infrastructure event as a no-op',
    async (status) => {
      const res = await request(app)
        .post('/api/v1/radius/accounting')
        .set('X-Radius-Secret', 'accounting-secret')
        .send({
          'Acct-Status-Type': { type: 'string', value: [status] },
        });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, action: 'noop', reason: status });
      expect(db.query).not.toHaveBeenCalled();
      expect(accountingService.ingestAccounting).not.toHaveBeenCalled();
    },
  );

  test('rejects unknown or ambiguous NAS addresses before accounting ingest', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const res = await request(app)
      .post('/api/v1/radius/accounting')
      .set('X-Radius-Secret', 'accounting-secret')
      .send({
        'Acct-Status-Type': 'Start',
        'User-Name': 'alice',
        'Acct-Session-Id': 'session-1',
        'NAS-IP-Address': '10.0.0.99',
      });

    expect(res.status).toBe(422);
    expect(accountingService.ingestAccounting).not.toHaveBeenCalled();
  });
});
