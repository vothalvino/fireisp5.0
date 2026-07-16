// =============================================================================
// Tests: §7.4 Fiber Plant Management (fiberPlantService + fiber-plant routes)
// =============================================================================

'use strict';

const request = require('supertest');
const app = require('../src/app');

jest.mock('../src/config/database', () => ({
  query:         jest.fn(),
  queryReplica:  jest.fn(),
  execute:       jest.fn(),
  getConnection: jest.fn(),
  close:         jest.fn(),
  pool:          { end: jest.fn() },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 1, organization_id: 1, email: 'admin@test.com', role: 'admin' };
    req.userId = 1;
    next();
  },
}));

jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = 1; next(); },
}));

jest.mock('../src/middleware/rbac', () => ({
  userHasPermission: async () => true,
  requirePermission: () => (_req, _res, next) => next(),
  requireRole:       () => (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/ipAllowlist', () => ({
  createIpAllowlist: () => (_req, _res, next) => next(),
  parseAllowlist:    () => [],
}));

const db = require('../src/config/database');

beforeEach(() => {
  jest.resetAllMocks();
});

// Alias for convenience
const mockQuery = db.query;

// ---------------------------------------------------------------------------
// Fiber Routes
// ---------------------------------------------------------------------------

describe('Fiber Routes API', () => {
  describe('GET /api/fiber-plant/fiber-routes', () => {
    it('returns paginated fiber routes', async () => {
      db.query
        .mockResolvedValueOnce([[{ total: 1 }]])
        .mockResolvedValueOnce([[{ id: 1, name: 'CO-1 → SPL-001', route_type: 'trunk', status: 'active' }]]);

      const res = await request(app)
        .get('/api/fiber-plant/fiber-routes')
        .set('Authorization', 'Bearer test');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('CO-1 → SPL-001');
    });
  });

  describe('POST /api/fiber-plant/fiber-routes', () => {
    it('creates a fiber route segment', async () => {
      db.query
        .mockResolvedValueOnce([{ insertId: 10 }])
        .mockResolvedValueOnce([[{ id: 10, name: 'Drop-001', route_type: 'drop', cable_length_m: 150 }]]);

      const res = await request(app)
        .post('/api/fiber-plant/fiber-routes')
        .set('Authorization', 'Bearer test')
        .send({ name: 'Drop-001', route_type: 'drop', cable_length_m: 150 });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(10);
    });

    it('returns 422 when name is missing', async () => {
      const res = await request(app)
        .post('/api/fiber-plant/fiber-routes')
        .set('Authorization', 'Bearer test')
        .send({ route_type: 'trunk' });
      expect(res.status).toBe(422);
    });
  });

  describe('GET /api/fiber-plant/fiber-routes/port/:portId/path', () => {
    it('returns fiber path segments for a PON port', async () => {
      db.query.mockResolvedValueOnce([[
        { id: 1, name: 'CO-1 → SPL-001', route_type: 'trunk' },
        { id: 2, name: 'SPL-001 → SPL-010', route_type: 'distribution' },
      ]]);

      const res = await request(app)
        .get('/api/fiber-plant/fiber-routes/port/5/path')
        .set('Authorization', 'Bearer test');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });
  });

  describe('DELETE /api/fiber-plant/fiber-routes/:id', () => {
    it('soft-deletes a fiber route', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1 }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .delete('/api/fiber-plant/fiber-routes/1')
        .set('Authorization', 'Bearer test');

      expect(res.status).toBe(204);
    });
  });
});

// ---------------------------------------------------------------------------
// ODF Frames
// ---------------------------------------------------------------------------

describe('ODF Frames API', () => {
  describe('GET /api/fiber-plant/odf/frames', () => {
    it('returns list of ODF frames', async () => {
      db.query
        .mockResolvedValueOnce([[{ total: 2 }]])
        .mockResolvedValueOnce([[
          { id: 1, name: 'ODF-CO1-R01', frame_type: 'rack', port_count: 48 },
          { id: 2, name: 'ODF-CO1-R02', frame_type: 'rack', port_count: 48 },
        ]]);

      const res = await request(app)
        .get('/api/fiber-plant/odf/frames')
        .set('Authorization', 'Bearer test');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });
  });

  describe('GET /api/fiber-plant/odf/frames/:id', () => {
    it('returns frame with its ports', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, name: 'ODF-CO1-R01', port_count: 12 }]])
        .mockResolvedValueOnce([[
          { id: 1, port_number: 1, port_status: 'connected' },
          { id: 2, port_number: 2, port_status: 'empty' },
        ]]);

      const res = await request(app)
        .get('/api/fiber-plant/odf/frames/1')
        .set('Authorization', 'Bearer test');

      expect(res.status).toBe(200);
      expect(res.body.data.ports).toHaveLength(2);
    });

    it('returns 404 for unknown frame', async () => {
      db.query.mockResolvedValueOnce([[]]); // frame not found
      const res = await request(app)
        .get('/api/fiber-plant/odf/frames/9999')
        .set('Authorization', 'Bearer test');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/fiber-plant/odf/frames', () => {
    it('creates an ODF frame', async () => {
      db.query
        .mockResolvedValueOnce([{ insertId: 5 }])
        .mockResolvedValueOnce([[{ id: 5, name: 'ODF-SITE2-R01', port_count: 24 }]]);

      const res = await request(app)
        .post('/api/fiber-plant/odf/frames')
        .set('Authorization', 'Bearer test')
        .send({ name: 'ODF-SITE2-R01', port_count: 24 });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('ODF-SITE2-R01');
    });
  });
});

// ---------------------------------------------------------------------------
// ODF Ports
// ---------------------------------------------------------------------------

describe('ODF Ports API', () => {
  describe('POST /api/fiber-plant/odf/ports', () => {
    it('creates an ODF port', async () => {
      db.query
        .mockResolvedValueOnce([{ insertId: 20 }])
        .mockResolvedValueOnce([[{ id: 20, odf_frame_id: 1, port_number: 3, port_status: 'empty' }]]);

      const res = await request(app)
        .post('/api/fiber-plant/odf/ports')
        .set('Authorization', 'Bearer test')
        .send({ odf_frame_id: 1, port_number: 3 });

      expect(res.status).toBe(201);
      expect(res.body.data.port_number).toBe(3);
    });
  });

  describe('PATCH /api/fiber-plant/odf/ports/:id', () => {
    it('updates port status', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 20 }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ id: 20, port_status: 'connected', cable_label: 'C-042' }]]);

      const res = await request(app)
        .patch('/api/fiber-plant/odf/ports/20')
        .set('Authorization', 'Bearer test')
        .send({ port_status: 'connected', cable_label: 'C-042' });

      expect(res.status).toBe(200);
      expect(res.body.data.port_status).toBe('connected');
    });
  });
});

// ---------------------------------------------------------------------------
// ODF Cross-Connects
// ---------------------------------------------------------------------------

describe('ODF Cross-Connects API', () => {
  describe('POST /api/fiber-plant/odf/cross-connects', () => {
    it('creates a cross-connect between two ODF ports', async () => {
      db.query
        .mockResolvedValueOnce([{ insertId: 30 }])
        .mockResolvedValueOnce([[{ id: 30, port_a_id: 1, port_b_id: 2, status: 'active' }]]);

      const res = await request(app)
        .post('/api/fiber-plant/odf/cross-connects')
        .set('Authorization', 'Bearer test')
        .send({ port_a_id: 1, port_b_id: 2, patch_cord_label: 'yellow-01' });

      expect(res.status).toBe(201);
      expect(res.body.data.port_a_id).toBe(1);
    });

    it('returns 400 when port_a_id == port_b_id', async () => {
      const res = await request(app)
        .post('/api/fiber-plant/odf/cross-connects')
        .set('Authorization', 'Bearer test')
        .send({ port_a_id: 5, port_b_id: 5 });

      expect(res.status).toBe(400);
    });
  });
});

// ---------------------------------------------------------------------------
// OTDR Tests
// ---------------------------------------------------------------------------

describe('OTDR Tests API', () => {
  describe('GET /api/fiber-plant/otdr/tests', () => {
    it('returns OTDR test results list', async () => {
      db.query
        .mockResolvedValueOnce([[{ total: 1 }]])
        .mockResolvedValueOnce([[{
          id: 1, test_type: 'baseline', wavelength_nm: 1310,
          total_loss_db: 14.5, fault_detected: 0,
        }]]);

      const res = await request(app)
        .get('/api/fiber-plant/otdr/tests')
        .set('Authorization', 'Bearer test');

      expect(res.status).toBe(200);
      expect(res.body.data[0].test_type).toBe('baseline');
    });
  });

  describe('POST /api/fiber-plant/otdr/tests', () => {
    it('creates an OTDR test result record', async () => {
      db.query
        .mockResolvedValueOnce([{ insertId: 7 }])
        .mockResolvedValueOnce([[{
          id: 7, test_type: 'fault_locate', fault_detected: 1,
          fault_distance_m: 1250, fault_type: 'break',
        }]]);

      const res = await request(app)
        .post('/api/fiber-plant/otdr/tests')
        .set('Authorization', 'Bearer test')
        .send({
          fiber_route_id: 1,
          test_type: 'fault_locate',
          wavelength_nm: 1625,
          fault_detected: 1,
          fault_distance_m: 1250,
          fault_type: 'break',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.fault_detected).toBe(1);
      expect(res.body.data.fault_type).toBe('break');
    });
  });
});

// ---------------------------------------------------------------------------
// SFP Inventory
// ---------------------------------------------------------------------------

describe('SFP Inventory API', () => {
  describe('GET /api/fiber-plant/sfp', () => {
    it('returns SFP inventory list', async () => {
      db.query
        .mockResolvedValueOnce([[{ total: 3 }]])
        .mockResolvedValueOnce([[
          { id: 1, serial_number: 'SFP1234', lifecycle_status: 'installed', form_factor: 'sfp' },
          { id: 2, serial_number: 'SFP5678', lifecycle_status: 'in_stock', form_factor: 'sfp_plus' },
          { id: 3, serial_number: 'SFP9012', lifecycle_status: 'retired', form_factor: 'sfp' },
        ]]);

      const res = await request(app)
        .get('/api/fiber-plant/sfp')
        .set('Authorization', 'Bearer test');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
    });
  });

  describe('POST /api/fiber-plant/sfp', () => {
    it('adds an SFP module record', async () => {
      db.query
        .mockResolvedValueOnce([{ insertId: 15 }])
        .mockResolvedValueOnce([[{
          id: 15, serial_number: 'SFP-NEW-001', form_factor: 'sfp_plus',
          wavelength_nm: 1310, lifecycle_status: 'in_stock',
        }]]);

      const res = await request(app)
        .post('/api/fiber-plant/sfp')
        .set('Authorization', 'Bearer test')
        .send({ serial_number: 'SFP-NEW-001', form_factor: 'sfp_plus', wavelength_nm: 1310 });

      expect(res.status).toBe(201);
      expect(res.body.data.serial_number).toBe('SFP-NEW-001');
    });
  });

  describe('PATCH /api/fiber-plant/sfp/:id', () => {
    it('updates SFP lifecycle status to installed', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 15 }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ id: 15, lifecycle_status: 'installed', installed_device_id: 42 }]]);

      const res = await request(app)
        .patch('/api/fiber-plant/sfp/15')
        .set('Authorization', 'Bearer test')
        .send({ lifecycle_status: 'installed', installed_device_id: 42, port_name: '0/1/1' });

      expect(res.status).toBe(200);
      expect(res.body.data.lifecycle_status).toBe('installed');
    });
  });

  describe('GET /api/fiber-plant/sfp/:id/diagnostics', () => {
    it('returns diagnostics for an installed SFP', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 15, installed_device_id: 42 }]]) // sfp lookup
        .mockResolvedValueOnce([[{ id: 15, lifecycle_status: 'installed' }]]) // sfp_inventory for getSfpDiagnostics
        .mockResolvedValueOnce([[{ sfp_tx_power_dbm: 2.5, sfp_rx_power_dbm: -20.1, sfp_temperature_c: 35.2, polled_at: '2026-06-11T10:00:00Z' }]]);

      const res = await request(app)
        .get('/api/fiber-plant/sfp/15/diagnostics')
        .set('Authorization', 'Bearer test');

      expect(res.status).toBe(200);
      expect(res.body.data.diagnostics).toBeDefined();
    });

    it('returns null diagnostics for uninstalled SFP', async () => {
      db.query.mockResolvedValueOnce([[{ id: 20, installed_device_id: null }]]);

      const res = await request(app)
        .get('/api/fiber-plant/sfp/20/diagnostics')
        .set('Authorization', 'Bearer test');

      expect(res.status).toBe(200);
      expect(res.body.data.diagnostics).toBeNull();
    });
  });
});
