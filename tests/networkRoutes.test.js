// =============================================================================
// FireISP 5.0 — Network Route Integration Tests
// =============================================================================
// Comprehensive tests for 5 network management route groups:
//   IP Pools, IP Assignments, VLANs, NAS, SNMP Profiles
// =============================================================================

// Mock the database module before requiring anything else
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.resetAllMocks();
});

// =============================================================================
// 1. IP POOL ROUTES — /api/ip-pools
// =============================================================================
describe('IP Pool Routes — /api/ip-pools', () => {

  const mockIpPool = {
    id: 1,
    organization_id: 1,
    name: 'LAN Pool',
    network: '192.168.1.0',
    subnet_mask: '255.255.255.0',
    gateway: '192.168.1.1',
    ip_version: 'ipv4',
    pool_type: 'dynamic',
    status: 'active',
  };

  // --- GET / ---
  describe('GET /api/ip-pools', () => {
    test('returns paginated list of IP pools', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockIpPool]])   // findAll
        .mockResolvedValueOnce([[{ total: 1 }]]);  // count

      const res = await request(app)
        .get('/api/ip-pools')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.total).toBe(1);
    });

    test('returns 401 without auth header', async () => {
      const res = await request(app).get('/api/ip-pools');
      expect(res.status).toBe(401);
    });
  });

  // --- GET /:id ---
  describe('GET /api/ip-pools/:id', () => {
    test('returns an IP pool by id', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[mockIpPool]]);

      const res = await request(app)
        .get('/api/ip-pools/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(1);
      expect(res.body.data.name).toBe('LAN Pool');
    });

    test('returns 404 when IP pool not found', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/ip-pools/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // --- POST / ---
  describe('POST /api/ip-pools', () => {
    test('creates an IP pool and returns 201', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([{ insertId: 2, affectedRows: 1 }])  // INSERT
        .mockResolvedValueOnce([[{ ...mockIpPool, id: 2 }]])         // findById
        .mockResolvedValueOnce([{ affectedRows: 1 }]);               // auditLog

      const res = await request(app)
        .post('/api/ip-pools')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'LAN Pool', network: '192.168.1.0', subnet_mask: '255.255.255.0', gateway: '192.168.1.1' });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(2);
    });
  });

  // --- PUT /:id ---
  describe('PUT /api/ip-pools/:id', () => {
    test('updates an IP pool', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockIpPool]])                                    // findByIdOrFail
        .mockResolvedValueOnce([{ affectedRows: 1 }])                            // UPDATE
        .mockResolvedValueOnce([[{ ...mockIpPool, name: 'WAN Pool' }]])           // findById
        .mockResolvedValueOnce([{ affectedRows: 1 }]);                           // auditLog

      const res = await request(app)
        .put('/api/ip-pools/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'WAN Pool' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('WAN Pool');
    });
  });

  // --- PUT /:id 404 ---
  describe('PUT /api/ip-pools/:id (not found)', () => {
    test('returns 404 when updating non-existent IP pool', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);  // findByIdOrFail → empty

      const res = await request(app)
        .put('/api/ip-pools/999')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Ghost Pool' });

      expect(res.status).toBe(404);
    });
  });

  // --- DELETE /:id ---
  describe('DELETE /api/ip-pools/:id', () => {
    test('deletes an IP pool and returns 204', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockIpPool]])       // findByIdOrFail
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // DELETE
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // auditLog

      const res = await request(app)
        .delete('/api/ip-pools/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });
  });

  // --- DELETE /:id 404 ---
  describe('DELETE /api/ip-pools/:id (not found)', () => {
    test('returns 404 when deleting non-existent IP pool', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);  // findByIdOrFail → empty

      const res = await request(app)
        .delete('/api/ip-pools/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // --- POST / auth ---
  describe('POST /api/ip-pools (unauthorized)', () => {
    test('returns 401 without auth header', async () => {
      const res = await request(app)
        .post('/api/ip-pools')
        .send({ name: 'Pool' });
      expect(res.status).toBe(401);
    });
  });
});

// =============================================================================
// 2. IP ASSIGNMENT ROUTES — /api/ip-assignments
// =============================================================================
describe('IP Assignment Routes — /api/ip-assignments', () => {

  const mockIpAssignment = {
    id: 1,
    organization_id: 1,
    pool_id: 1,
    ip_address: '192.168.1.10',
    prefix_len: 24,
    type: 'static',
    status: 'active',
  };

  // --- GET / ---
  describe('GET /api/ip-assignments', () => {
    test('returns paginated list of IP assignments', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockIpAssignment]])   // findAll
        .mockResolvedValueOnce([[{ total: 1 }]]);      // count

      const res = await request(app)
        .get('/api/ip-assignments')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.total).toBe(1);
    });

    test('returns 401 without auth header', async () => {
      const res = await request(app).get('/api/ip-assignments');
      expect(res.status).toBe(401);
    });
  });

  // --- GET /:id ---
  describe('GET /api/ip-assignments/:id', () => {
    test('returns an IP assignment by id', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[mockIpAssignment]]);

      const res = await request(app)
        .get('/api/ip-assignments/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(1);
      expect(res.body.data.ip_address).toBe('192.168.1.10');
    });

    test('returns 404 when IP assignment not found', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/ip-assignments/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // --- POST / ---
  describe('POST /api/ip-assignments', () => {
    test('creates an IP assignment and returns 201', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[]])                                     // dup check: contracts
        .mockResolvedValueOnce([[]])                                     // dup check: ip_assignments
        .mockResolvedValueOnce([{ insertId: 2, affectedRows: 1 }])       // INSERT
        .mockResolvedValueOnce([[{ ...mockIpAssignment, id: 2 }]])        // findById
        .mockResolvedValueOnce([{ affectedRows: 1 }]);                    // auditLog

      const res = await request(app)
        .post('/api/ip-assignments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ pool_id: 1, ip_address: '192.168.1.10', prefix_len: 24, type: 'static' });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(2);
    });
  });

  // --- PUT /:id ---
  describe('PUT /api/ip-assignments/:id', () => {
    test('updates an IP assignment', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockIpAssignment]])                                         // findByIdOrFail
        .mockResolvedValueOnce([{ affectedRows: 1 }])                                       // UPDATE
        .mockResolvedValueOnce([[{ ...mockIpAssignment, type: 'dynamic' }]])      // findById
        .mockResolvedValueOnce([{ affectedRows: 1 }]);                                      // auditLog

      const res = await request(app)
        .put('/api/ip-assignments/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ type: 'dynamic' });

      expect(res.status).toBe(200);
      expect(res.body.data.type).toBe('dynamic');
    });
  });

  // --- DELETE /:id ---
  describe('DELETE /api/ip-assignments/:id', () => {
    test('deletes an IP assignment and returns 204', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockIpAssignment]])       // findByIdOrFail
        .mockResolvedValueOnce([{ affectedRows: 1 }])      // DELETE
        .mockResolvedValueOnce([{ affectedRows: 1 }]);     // auditLog

      const res = await request(app)
        .delete('/api/ip-assignments/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });
  });

  // --- PUT /:id 404 ---
  describe('PUT /api/ip-assignments/:id (not found)', () => {
    test('returns 404 when updating non-existent IP assignment', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);  // findByIdOrFail → empty

      const res = await request(app)
        .put('/api/ip-assignments/999')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 'expired' });

      expect(res.status).toBe(404);
    });
  });

  // --- DELETE /:id 404 ---
  describe('DELETE /api/ip-assignments/:id (not found)', () => {
    test('returns 404 when deleting non-existent IP assignment', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);  // findByIdOrFail → empty

      const res = await request(app)
        .delete('/api/ip-assignments/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });
});

// =============================================================================
// 3. VLAN ROUTES — /api/vlans
// =============================================================================
describe('VLAN Routes — /api/vlans', () => {

  const mockVlan = {
    id: 1,
    organization_id: 1,
    vlan_id: 100,
    name: 'Management',
    description: 'Management VLAN',
    status: 'active',
  };

  // --- GET / ---
  describe('GET /api/vlans', () => {
    test('returns paginated list of VLANs', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockVlan]])        // findAll
        .mockResolvedValueOnce([[{ total: 1 }]]);   // count

      const res = await request(app)
        .get('/api/vlans')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.total).toBe(1);
    });

    test('returns 401 without auth header', async () => {
      const res = await request(app).get('/api/vlans');
      expect(res.status).toBe(401);
    });
  });

  // --- GET /:id ---
  describe('GET /api/vlans/:id', () => {
    test('returns a VLAN by id', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[mockVlan]]);

      const res = await request(app)
        .get('/api/vlans/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(1);
      expect(res.body.data.vlan_id).toBe(100);
    });

    test('returns 404 when VLAN not found', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/vlans/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // --- POST / ---
  describe('POST /api/vlans', () => {
    test('creates a VLAN and returns 201', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([{ insertId: 2, affectedRows: 1 }])  // INSERT
        .mockResolvedValueOnce([[{ ...mockVlan, id: 2 }]])           // findById
        .mockResolvedValueOnce([{ affectedRows: 1 }]);               // auditLog

      const res = await request(app)
        .post('/api/vlans')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ vlan_id: 100, name: 'Management', description: 'Management VLAN' });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(2);
    });
  });

  // --- PUT /:id ---
  describe('PUT /api/vlans/:id', () => {
    test('updates a VLAN', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockVlan]])                                    // findByIdOrFail
        .mockResolvedValueOnce([{ affectedRows: 1 }])                          // UPDATE
        .mockResolvedValueOnce([[{ ...mockVlan, name: 'Guest' }]])              // findById
        .mockResolvedValueOnce([{ affectedRows: 1 }]);                         // auditLog

      const res = await request(app)
        .put('/api/vlans/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Guest' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Guest');
    });
  });

  // --- DELETE /:id ---
  describe('DELETE /api/vlans/:id', () => {
    test('deletes a VLAN and returns 204', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockVlan]])           // findByIdOrFail
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // DELETE
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // auditLog

      const res = await request(app)
        .delete('/api/vlans/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });
  });

  // --- PUT /:id 404 ---
  describe('PUT /api/vlans/:id (not found)', () => {
    test('returns 404 when updating non-existent VLAN', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);  // findByIdOrFail → empty

      const res = await request(app)
        .put('/api/vlans/999')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Ghost VLAN' });

      expect(res.status).toBe(404);
    });
  });

  // --- DELETE /:id 404 ---
  describe('DELETE /api/vlans/:id (not found)', () => {
    test('returns 404 when deleting non-existent VLAN', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);  // findByIdOrFail → empty

      const res = await request(app)
        .delete('/api/vlans/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });
});

// =============================================================================
// 4. NAS ROUTES — /api/nas
// =============================================================================
describe('NAS Routes — /api/nas', () => {

  const mockNas = {
    id: 1,
    organization_id: 1,
    name: 'Core NAS',
    ip_address: '10.0.0.1',
    type: 'mikrotik',
    status: 'active',
  };

  // --- GET / ---
  describe('GET /api/nas', () => {
    test('returns paginated list of NAS devices', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockNas]])          // findAll
        .mockResolvedValueOnce([[{ total: 1 }]]);    // count

      const res = await request(app)
        .get('/api/nas')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.total).toBe(1);
    });

    test('returns 401 without auth header', async () => {
      const res = await request(app).get('/api/nas');
      expect(res.status).toBe(401);
    });
  });

  // --- GET /:id ---
  describe('GET /api/nas/:id', () => {
    test('returns a NAS device by id', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[mockNas]]);

      const res = await request(app)
        .get('/api/nas/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(1);
      expect(res.body.data.name).toBe('Core NAS');
    });

    test('returns 404 when NAS device not found', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/nas/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // --- POST / ---
  describe('POST /api/nas', () => {
    test('creates a NAS device and returns 201', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([{ insertId: 2, affectedRows: 1 }])  // INSERT
        .mockResolvedValueOnce([[{ ...mockNas, id: 2 }]])            // findById
        .mockResolvedValueOnce([{ affectedRows: 1 }]);               // auditLog

      const res = await request(app)
        .post('/api/nas')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Core NAS', ip_address: '10.0.0.1', secret: 'testing123', type: 'mikrotik' });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(2);
    });
  });

  // --- PUT /:id ---
  describe('PUT /api/nas/:id', () => {
    test('updates a NAS device', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockNas]])                                     // findByIdOrFail
        .mockResolvedValueOnce([{ affectedRows: 1 }])                          // UPDATE
        .mockResolvedValueOnce([[{ ...mockNas, name: 'Edge NAS' }]])            // findById
        .mockResolvedValueOnce([{ affectedRows: 1 }]);                         // auditLog

      const res = await request(app)
        .put('/api/nas/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Edge NAS' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Edge NAS');
    });
  });

  // --- DELETE /:id ---
  describe('DELETE /api/nas/:id', () => {
    test('deletes a NAS device and returns 204', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockNas]])            // findByIdOrFail
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // DELETE
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // auditLog

      const res = await request(app)
        .delete('/api/nas/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });
  });

  // --- PUT /:id 404 ---
  describe('PUT /api/nas/:id (not found)', () => {
    test('returns 404 when updating non-existent NAS device', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);  // findByIdOrFail → empty

      const res = await request(app)
        .put('/api/nas/999')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Ghost NAS' });

      expect(res.status).toBe(404);
    });
  });

  // --- DELETE /:id 404 ---
  describe('DELETE /api/nas/:id (not found)', () => {
    test('returns 404 when deleting non-existent NAS device', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);  // findByIdOrFail → empty

      const res = await request(app)
        .delete('/api/nas/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // --- POST / auth ---
  describe('POST /api/nas (unauthorized)', () => {
    test('returns 401 without auth header', async () => {
      const res = await request(app)
        .post('/api/nas')
        .send({ name: 'NAS' });
      expect(res.status).toBe(401);
    });
  });
});

// =============================================================================
// 5. SNMP PROFILE ROUTES — /api/snmp-profiles
// =============================================================================
describe('SNMP Profile Routes — /api/snmp-profiles', () => {

  const mockSnmpProfile = {
    id: 1,
    organization_id: 1,
    name: 'Ubiquiti Default',
    manufacturer: 'Ubiquiti',
    device_type: 'router',
    snmp_version: 'v2c',
    status: 'active',
  };

  const mockOid = {
    id: 1,
    profile_id: 1,
    oid: '.1.3.6.1.2.1.2.2.1.10',
    label: 'ifInOctets',
    metric_type: 'counter',
  };

  // --- GET / ---
  describe('GET /api/snmp-profiles', () => {
    test('returns paginated list of SNMP profiles', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockSnmpProfile]])   // findAll
        .mockResolvedValueOnce([[{ total: 1 }]]);     // count

      const res = await request(app)
        .get('/api/snmp-profiles')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.total).toBe(1);
    });

    test('returns 401 without auth header', async () => {
      const res = await request(app).get('/api/snmp-profiles');
      expect(res.status).toBe(401);
    });
  });

  // --- GET /:id ---
  describe('GET /api/snmp-profiles/:id', () => {
    test('returns an SNMP profile by id', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[mockSnmpProfile]]);

      const res = await request(app)
        .get('/api/snmp-profiles/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(1);
      expect(res.body.data.name).toBe('Ubiquiti Default');
    });

    test('returns 404 when SNMP profile not found', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/snmp-profiles/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // --- POST / ---
  describe('POST /api/snmp-profiles', () => {
    test('creates an SNMP profile and returns 201', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([{ insertId: 2, affectedRows: 1 }])      // INSERT
        .mockResolvedValueOnce([[{ ...mockSnmpProfile, id: 2 }]])        // findById
        .mockResolvedValueOnce([{ affectedRows: 1 }]);                   // auditLog

      const res = await request(app)
        .post('/api/snmp-profiles')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Ubiquiti Default', manufacturer: 'Ubiquiti', device_type: 'router', snmp_version: 'v2c' });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(2);
    });
  });

  // --- PUT /:id ---
  describe('PUT /api/snmp-profiles/:id', () => {
    test('updates an SNMP profile', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockSnmpProfile]])                                    // findByIdOrFail
        .mockResolvedValueOnce([{ affectedRows: 1 }])                                 // UPDATE
        .mockResolvedValueOnce([[{ ...mockSnmpProfile, name: 'MikroTik Default' }]])   // findById
        .mockResolvedValueOnce([{ affectedRows: 1 }]);                                // auditLog

      const res = await request(app)
        .put('/api/snmp-profiles/1')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'MikroTik Default' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('MikroTik Default');
    });
  });

  // --- DELETE /:id ---
  describe('DELETE /api/snmp-profiles/:id', () => {
    test('deletes an SNMP profile and returns 204', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockSnmpProfile]])    // findByIdOrFail
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // DELETE
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // auditLog

      const res = await request(app)
        .delete('/api/snmp-profiles/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });
  });

  // --- PUT /:id 404 ---
  describe('PUT /api/snmp-profiles/:id (not found)', () => {
    test('returns 404 when updating non-existent SNMP profile', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);  // findByIdOrFail → empty

      const res = await request(app)
        .put('/api/snmp-profiles/999')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Ghost Profile' });

      expect(res.status).toBe(404);
    });
  });

  // --- DELETE /:id 404 ---
  describe('DELETE /api/snmp-profiles/:id (not found)', () => {
    test('returns 404 when deleting non-existent SNMP profile', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);  // findByIdOrFail → empty

      const res = await request(app)
        .delete('/api/snmp-profiles/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  // --- POST / auth ---
  describe('POST /api/snmp-profiles (unauthorized)', () => {
    test('returns 401 without auth header', async () => {
      const res = await request(app)
        .post('/api/snmp-profiles')
        .send({ name: 'Profile' });
      expect(res.status).toBe(401);
    });
  });

  // --- GET /:id/oids ---
  describe('GET /api/snmp-profiles/:id/oids', () => {
    test('returns OIDs for an SNMP profile', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[mockOid]]);

      const res = await request(app)
        .get('/api/snmp-profiles/1/oids')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].oid).toBe('.1.3.6.1.2.1.2.2.1.10');
      expect(res.body.data[0].label).toBe('ifInOctets');
    });

    test('returns empty array when no OIDs exist', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/snmp-profiles/1/oids')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  // --- POST /:id/oids ---
  describe('POST /api/snmp-profiles/:id/oids', () => {
    test('adds an OID to an SNMP profile and returns 201', async () => {
      mockAuthUser();
      const newOid = {
        id: 2,
        profile_id: 1,
        oid: '.1.3.6.1.2.1.1.3.0',
        label: 'sysUpTime',
        metric_type: 'gauge',
      };
      db.query
        .mockResolvedValueOnce([{ insertId: 2 }])   // INSERT into snmp_profile_oids
        .mockResolvedValueOnce([[newOid]]);           // SELECT new OID

      const res = await request(app)
        .post('/api/snmp-profiles/1/oids')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ oid: '.1.3.6.1.2.1.1.3.0', label: 'sysUpTime', metric_type: 'gauge' });

      expect(res.status).toBe(201);
      expect(res.body.data.oid).toBe('.1.3.6.1.2.1.1.3.0');
      expect(res.body.data.label).toBe('sysUpTime');
    });
  });

  // --- DELETE /:id/oids/:oidId ---
  describe('DELETE /api/snmp-profiles/:id/oids/:oidId', () => {
    test('deletes an OID from an SNMP profile and returns 204', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);  // DELETE

      const res = await request(app)
        .delete('/api/snmp-profiles/1/oids/1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });
  });

  // --- GET /:id/oids auth ---
  describe('GET /api/snmp-profiles/:id/oids (unauthorized)', () => {
    test('returns 401 without auth header', async () => {
      const res = await request(app).get('/api/snmp-profiles/1/oids');
      expect(res.status).toBe(401);
    });
  });

  // --- POST /:id/oids auth ---
  describe('POST /api/snmp-profiles/:id/oids (unauthorized)', () => {
    test('returns 401 without auth header', async () => {
      const res = await request(app)
        .post('/api/snmp-profiles/1/oids')
        .send({ oid: '.1.3.6.1.2.1.1.3.0', label: 'sysUpTime' });
      expect(res.status).toBe(401);
    });
  });

  // --- DELETE /:id/oids/:oidId auth ---
  describe('DELETE /api/snmp-profiles/:id/oids/:oidId (unauthorized)', () => {
    test('returns 401 without auth header', async () => {
      const res = await request(app).delete('/api/snmp-profiles/1/oids/1');
      expect(res.status).toBe(401);
    });
  });
});

// =============================================================================
// CROSS-CUTTING: Pagination query params
// =============================================================================
describe('Pagination query params', () => {
  test('GET /api/ip-pools with page=2&limit=10 passes pagination', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]]);

    const res = await request(app)
      .get('/api/ip-pools?page=2&limit=10')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.page).toBe(2);
    expect(res.body.meta.limit).toBe(10);
  });

  test('GET /api/vlans with page=3&limit=5 passes pagination', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]]);

    const res = await request(app)
      .get('/api/vlans?page=3&limit=5')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.page).toBe(3);
    expect(res.body.meta.limit).toBe(5);
  });
});

// =============================================================================
// CROSS-CUTTING: Empty list responses
// =============================================================================
describe('Empty list responses', () => {
  test('GET /api/nas returns empty data and zero total', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]]);

    const res = await request(app)
      .get('/api/nas')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
    expect(res.body.meta.totalPages).toBe(0);
  });

  test('GET /api/ip-assignments returns empty data and zero total', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]]);

    const res = await request(app)
      .get('/api/ip-assignments')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
    expect(res.body.meta.totalPages).toBe(0);
  });

  test('GET /api/snmp-profiles returns empty data and zero total', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]]);

    const res = await request(app)
      .get('/api/snmp-profiles')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
    expect(res.body.meta.totalPages).toBe(0);
  });
});
