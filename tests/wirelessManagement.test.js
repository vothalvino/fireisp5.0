// =============================================================================
// FireISP 5.0 — Wireless Management route tests (ap-sectors: migration 388)
// =============================================================================
// Focused coverage for the 2 new per-sector diagnostic-threshold columns
// (signal_min_dbm, link_capacity_min_mbps) added to ap_sector_configs by
// migration 388 — the create/update round trip and validation bounds.
// Full CRUD/permissions coverage for /wireless/ap-sectors predates this file
// (routes + service + schema all existed since migration 279/281); this file
// only targets the new-field surface.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const app = require('../src/app');

function makeToken(payload = {}) {
  return jwt.sign(
    { sub: 1, email: 'test@example.com', role: 'admin', orgId: 1, ...payload },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const authToken = makeToken();

function mockAuthUser() {
  User.findById.mockResolvedValue({
    id: 1,
    email: 'test@example.com',
    status: 'active',
    role: 'admin',
    organization_id: 1,
  });
}

beforeEach(() => {
  jest.resetAllMocks();
});

const mockSector = {
  id: 1,
  organization_id: 1,
  device_id: 42,
  sector_azimuth_deg: 90,
  max_clients: 50,
  signal_min_dbm: null,
  link_capacity_min_mbps: null,
  status: 'active',
};

describe('Wireless AP Sectors — migration 388 threshold fields', () => {
  describe('POST /api/v1/wireless/ap-sectors', () => {
    test('persists signal_min_dbm and link_capacity_min_mbps on create', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ id: 42, type: 'ptmp_ap' }]])              // device type validation
        .mockResolvedValueOnce([{ insertId: 1 }])                            // INSERT ap_sector_configs
        .mockResolvedValueOnce([[{ ...mockSector, signal_min_dbm: -60, link_capacity_min_mbps: '25.00' }]]); // getApSectorConfig

      const res = await request(app)
        .post('/api/v1/wireless/ap-sectors')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ device_id: 42, signal_min_dbm: -60, link_capacity_min_mbps: 25 });

      expect(res.status).toBe(201);
      const insertCall = db.query.mock.calls.find(
        c => typeof c[0] === 'string' && c[0].startsWith('INSERT INTO ap_sector_configs'),
      );
      expect(insertCall).toBeTruthy();
      expect(insertCall[0]).toContain('`signal_min_dbm`');
      expect(insertCall[0]).toContain('`link_capacity_min_mbps`');
      expect(insertCall[1]).toEqual(expect.arrayContaining([-60, 25]));
      expect(res.body.data.signal_min_dbm).toBe(-60);
    });

    test('rejects an out-of-range signal_min_dbm (> 0) with 422, no INSERT issued', async () => {
      mockAuthUser();

      const res = await request(app)
        .post('/api/v1/wireless/ap-sectors')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ device_id: 42, signal_min_dbm: 5 });

      expect(res.status).toBe(422);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/v1/wireless/ap-sectors/:id', () => {
    test('persists signal_min_dbm and link_capacity_min_mbps on update', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockSector]])                                // getApSectorConfig (existing check)
        .mockResolvedValueOnce([{ affectedRows: 1 }])                        // UPDATE ap_sector_configs
        .mockResolvedValueOnce([[{ ...mockSector, signal_min_dbm: -65, link_capacity_min_mbps: '10.50' }]]); // getApSectorConfig (return)

      const res = await request(app)
        .put('/api/v1/wireless/ap-sectors/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ signal_min_dbm: -65, link_capacity_min_mbps: 10.5 });

      expect(res.status).toBe(200);
      const updateCall = db.query.mock.calls.find(
        c => typeof c[0] === 'string' && c[0].startsWith('UPDATE ap_sector_configs'),
      );
      expect(updateCall).toBeTruthy();
      expect(updateCall[0]).toContain('`signal_min_dbm` = ?');
      expect(updateCall[0]).toContain('`link_capacity_min_mbps` = ?');
      expect(updateCall[1]).toEqual(expect.arrayContaining([-65, 10.5]));
      expect(res.body.data.signal_min_dbm).toBe(-65);
    });

    test('rejects an out-of-range link_capacity_min_mbps (0, below the 0.1 minimum) with 422', async () => {
      mockAuthUser();

      const res = await request(app)
        .put('/api/v1/wireless/ap-sectors/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ link_capacity_min_mbps: 0 });

      expect(res.status).toBe(422);
      expect(db.query).not.toHaveBeenCalled();
    });
  });
});
