// =============================================================================
// FireISP 5.0 — Section 19: Multi-Tenancy / Reseller Support Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 10 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

function token(role = 'admin') {
  return jwt.sign(
    { sub: 1, email: 'user@test.com', role, orgId: 10 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

// ---------------------------------------------------------------------------
// Sample fixtures
// ---------------------------------------------------------------------------

const sampleReseller = {
  id: 1,
  organization_id: 10,
  parent_id: null,
  parent_name: null,
  level: 1,
  name: 'Acme Reseller',
  email: 'acme@test.com',
  phone: null,
  contact_name: 'John Doe',
  status: 'active',
  commission_rate: 10.00,
  brand_logo_url: null,
  brand_primary_color: null,
  brand_accent_color: null,
  portal_domain: null,
  portal_name: 'Acme ISP',
  notes: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
};

const samplePlanPrice = {
  id: 1,
  reseller_id: 1,
  plan_id: 2,
  plan_name: 'Basic 10Mbps',
  base_price: 29.99,
  custom_price: 24.99,
  currency: 'USD',
  is_active: 1,
};

const sampleCommission = {
  id: 1,
  reseller_id: 1,
  invoice_id: 5,
  invoice_number: 'INV-0005',
  client_id: 3,
  client_name: 'Test Client',
  commission_rate: 10.00,
  invoice_total: 100.00,
  commission_amount: 10.00,
  currency: 'USD',
  status: 'pending',
  created_at: '2026-01-01T00:00:00.000Z',
};

const sampleBandwidthQuota = {
  id: 1,
  reseller_id: 1,
  download_mbps: 1000,
  upload_mbps: 500,
  burst_download_mbps: null,
  burst_upload_mbps: null,
  is_enforced: 1,
  notes: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const sampleIpPoolAlloc = {
  id: 1,
  reseller_id: 1,
  ip_pool_id: 2,
  pool_name: 'Main Pool',
  network: '192.168.0.0',
  subnet_mask: '255.255.0.0',
  ip_version: '4',
};

const sampleBillingEntity = {
  id: 1,
  reseller_id: 1,
  legal_name: 'Acme Corp SA',
  tax_id: 'ACM123456',
  email: 'billing@acme.com',
  invoice_prefix: 'ACM',
  currency: 'USD',
  is_active: 1,
};

// ---------------------------------------------------------------------------
// DB mock dispatcher
// ---------------------------------------------------------------------------

function mockDb() {
  db.query.mockImplementation((sql) => {
    const s = typeof sql === 'string' ? sql : '';

    // Auth: user lookup (must not match clients or resellers queries)
    if (s.includes('WHERE id = ?') && !s.includes('reseller') && !s.includes('clients') && !s.includes('commission')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    // Org scope
    if (s.includes('FROM organizations')) {
      return Promise.resolve([[{ id: 10, name: 'Test Org' }]]);
    }
    // resellers LIST
    if (s.includes('FROM resellers r') && s.includes('LEFT JOIN')) {
      return Promise.resolve([[sampleReseller]]);
    }
    // resellers COUNT
    if (s.includes('COUNT(*) AS total') && s.includes('FROM resellers r')) {
      return Promise.resolve([[{ total: 1 }]]);
    }
    // resellers single GET / UPDATE / suspend
    if (s.includes('FROM resellers') && s.includes('organization_id')) {
      return Promise.resolve([[sampleReseller]]);
    }
    // resellers single by id (after INSERT)
    if (s.includes('FROM resellers') && s.includes('WHERE id = ?')) {
      return Promise.resolve([[sampleReseller]]);
    }
    // resellers INSERT
    if (s.includes('INSERT INTO resellers')) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    // resellers UPDATE (update fields / soft-delete / status)
    if (s.includes('UPDATE resellers')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }

    // plan-prices LIST
    if (s.includes('FROM reseller_plan_prices')) {
      return Promise.resolve([[samplePlanPrice]]);
    }
    // plan-prices UPSERT
    if (s.includes('INSERT INTO reseller_plan_prices')) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    // plan-prices single by reseller+plan
    if (s.includes('WHERE reseller_id = ? AND plan_id = ?')) {
      return Promise.resolve([[samplePlanPrice]]);
    }
    // plan-prices find by id
    if (s.includes('FROM reseller_plan_prices') && s.includes('WHERE id = ?')) {
      return Promise.resolve([[{ id: 9, reseller_id: 1 }]]);
    }
    // plan-prices DELETE
    if (s.includes('DELETE FROM reseller_plan_prices')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }

    // commissions LIST
    if (s.includes('FROM reseller_commissions rc')) {
      return Promise.resolve([[sampleCommission]]);
    }
    // commissions COUNT
    if (s.includes('COUNT(*) AS total') && s.includes('reseller_commissions')) {
      return Promise.resolve([[{ total: 1 }]]);
    }
    // commissions single by id (first call = existence check; second call = post-approve select)
    if (s.includes('FROM reseller_commissions') && s.includes('WHERE id = ?') && s.includes('reseller_id = ?')) {
      return Promise.resolve([[sampleCommission]]);
    }
    // commissions SELECT * after UPDATE (no reseller_id filter — post-update re-read)
    if (s.includes('SELECT * FROM reseller_commissions') && !s.includes('reseller_id = ?')) {
      return Promise.resolve([[{ ...sampleCommission, status: 'approved' }]]);
    }
    // commissions UPDATE
    if (s.includes('UPDATE reseller_commissions')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }

    // IP pool allocations
    if (s.includes('FROM reseller_ip_pool_allocations a')) {
      return Promise.resolve([[sampleIpPoolAlloc]]);
    }
    if (s.includes('INSERT') && s.includes('reseller_ip_pool_allocations')) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    if (s.includes('WHERE reseller_id = ? AND ip_pool_id = ?')) {
      return Promise.resolve([[sampleIpPoolAlloc]]);
    }
    if (s.includes('FROM reseller_ip_pool_allocations') && s.includes('WHERE id = ?')) {
      return Promise.resolve([[{ id: 1, reseller_id: 1 }]]);
    }
    if (s.includes('DELETE FROM reseller_ip_pool_allocations')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }

    // Bandwidth quota
    if (s.includes('FROM reseller_bandwidth_quotas')) {
      return Promise.resolve([[sampleBandwidthQuota]]);
    }
    if (s.includes('INSERT INTO reseller_bandwidth_quotas')) {
      return Promise.resolve([{ insertId: 1 }]);
    }

    // OLT port assignments
    if (s.includes('FROM reseller_olt_port_assignments a')) {
      return Promise.resolve([[{ id: 1, reseller_id: 1, olt_port_id: 3, port_name: 'GPON 0/1/1', port_no: 1, port_type: 'gpon' }]]);
    }
    if (s.includes('INSERT') && s.includes('reseller_olt_port_assignments')) {
      return Promise.resolve([{ insertId: 1 }]);
    }
    if (s.includes('WHERE reseller_id = ? AND olt_port_id = ?')) {
      return Promise.resolve([[{ id: 1, reseller_id: 1 }]]);
    }
    if (s.includes('FROM reseller_olt_port_assignments') && s.includes('WHERE id = ?')) {
      return Promise.resolve([[{ id: 1, reseller_id: 1 }]]);
    }
    if (s.includes('DELETE FROM reseller_olt_port_assignments')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }

    // Billing entities
    if (s.includes('FROM reseller_billing_entities')) {
      return Promise.resolve([[sampleBillingEntity]]);
    }
    if (s.includes('INSERT INTO reseller_billing_entities')) {
      return Promise.resolve([{ insertId: 1 }]);
    }

    // Portal: reseller dashboard / clients / invoices / inventory
    if (s.includes('FROM clients') && s.includes('reseller_id IN')) {
      return Promise.resolve([[{ id: 3, name: 'Test Client', status: 'active', reseller_id: 1 }]]);
    }
    if (s.includes('FROM clients') && s.includes('AND status =')) {
      return Promise.resolve([[{ cnt: 5 }]]);
    }
    if (s.includes('COUNT(*) AS cnt') && s.includes('FROM clients')) {
      return Promise.resolve([[{ cnt: 5 }]]);
    }
    if (s.includes('COALESCE(SUM(total)') && s.includes('invoices')) {
      return Promise.resolve([[{ rev: '500.00' }]]);
    }
    if (s.includes('COUNT(*) AS cnt') && s.includes('FROM tickets')) {
      return Promise.resolve([[{ cnt: 2 }]]);
    }
    if (s.includes('COALESCE(SUM(commission_amount)')) {
      return Promise.resolve([[{ total: '50.00' }]]);
    }
    if (s.includes('FROM clients') && s.includes('reseller_id IN (?)')) {
      return Promise.resolve([[{ id: 3 }]]);
    }
    // clients subtree query (getResellerSubtree: children of rootIds)
    if (s.includes('FROM resellers') && s.includes('parent_id IN')) {
      return Promise.resolve([[{ id: 2 }]]);
    }
    // getResellerClientIds
    if (s.includes('FROM clients') && s.includes('reseller_id IN')) {
      return Promise.resolve([[{ id: 3 }]]);
    }
    // clients COUNT for portal list
    if (s.includes('COUNT(*) AS total') && s.includes('FROM clients')) {
      return Promise.resolve([[{ total: 1 }]]);
    }
    // portal invoices
    if (s.includes('FROM invoices i') && s.includes('client_id IN')) {
      return Promise.resolve([[{ id: 5, invoice_number: 'INV-0005', client_name: 'Test', status: 'paid' }]]);
    }
    if (s.includes('COUNT(*) AS total') && s.includes('FROM invoices')) {
      return Promise.resolve([[{ total: 1 }]]);
    }
    // portal inventory
    if (s.includes('FROM asset_assignments aa')) {
      return Promise.resolve([[{ id: 1, asset_id: 2, client_id: 3 }]]);
    }
    if (s.includes('COUNT(*) AS total') && s.includes('asset_assignments')) {
      return Promise.resolve([[{ total: 1 }]]);
    }
    // clients INSERT (create under reseller)
    if (s.includes('INSERT INTO clients')) {
      return Promise.resolve([{ insertId: 10 }]);
    }
    // clients GET after insert (SELECT * FROM clients WHERE id = ?)
    if (s.includes('FROM clients') && s.includes('WHERE id = ?')) {
      return Promise.resolve([[{ id: 10, name: 'New Client', status: 'active', reseller_id: 1 }]]);
    }
    // clients suspend/cancel
    if (s.includes('SELECT id, status, reseller_id FROM clients') || s.includes('SELECT id, reseller_id FROM clients')) {
      return Promise.resolve([[{ id: 3, status: 'active', reseller_id: 1 }]]);
    }
    if (s.includes('UPDATE clients SET status')) {
      return Promise.resolve([{ affectedRows: 1 }]);
    }

    // plans (for plan-prices check)
    if (s.includes('FROM plans')) {
      return Promise.resolve([[{ id: 2, name: 'Basic 10Mbps', price: 29.99 }]]);
    }

    // Default
    return Promise.resolve([[]]);
  });
}

beforeEach(() => {
  mockDb();
});

afterEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// §19.1 — Resellers CRUD
// =============================================================================

describe('GET /api/v1/resellers', () => {
  it('returns 200 with reseller list', async () => {
    const res = await request(app)
      .get('/api/v1/resellers')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/v1/resellers').set('X-Org-Id', '10');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/resellers', () => {
  it('returns 201 with new reseller', async () => {
    const res = await request(app)
      .post('/api/v1/resellers')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Acme Reseller', commission_rate: 10 });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('id');
  });

  it('returns 422 when name is missing', async () => {
    const res = await request(app)
      .post('/api/v1/resellers')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ commission_rate: 10 });
    expect(res.status).toBe(422);
  });
});

describe('GET /api/v1/resellers/:id', () => {
  it('returns 200 for existing reseller', async () => {
    const res = await request(app)
      .get('/api/v1/resellers/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('name', 'Acme Reseller');
  });

  it('returns 404 for non-existent reseller', async () => {
    // Override only the resellers lookup to return empty (simulates not found)
    db.query.mockImplementation((sql) => {
      const s = typeof sql === 'string' ? sql : '';
      // Auth: user lookup uses `SELECT * FROM \`users\``
      if (s.includes('`users`') || (s.includes('users') && s.includes('WHERE id = ?'))) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (s.includes('FROM organizations')) {
        return Promise.resolve([[{ id: 10, name: 'Test Org' }]]);
      }
      // resellers lookup returns empty
      if (s.includes('resellers')) {
        return Promise.resolve([[]]); // not found
      }
      return Promise.resolve([[]]);
    });
    const res = await request(app)
      .get('/api/v1/resellers/999')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/resellers/:id', () => {
  it('returns 200 with updated reseller', async () => {
    mockDb(); // ensure fresh mock
    const res = await request(app)
      .put('/api/v1/resellers/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Updated Reseller', commission_rate: 15 });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/v1/resellers/:id', () => {
  it('returns 200 and marks deleted', async () => {
    const res = await request(app)
      .delete('/api/v1/resellers/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('deleted', true);
  });
});

describe('POST /api/v1/resellers/:id/suspend', () => {
  it('returns 200 with toggled status', async () => {
    const res = await request(app)
      .post('/api/v1/resellers/1/suspend')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('status');
  });
});

// =============================================================================
// §19.1 — Plan Prices
// =============================================================================

describe('GET /api/v1/resellers/:id/plan-prices', () => {
  it('returns 200 with plan prices', async () => {
    const res = await request(app)
      .get('/api/v1/resellers/1/plan-prices')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('POST /api/v1/resellers/:id/plan-prices', () => {
  it('returns 201 with new plan price', async () => {
    const res = await request(app)
      .post('/api/v1/resellers/1/plan-prices')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ plan_id: 2, custom_price: 24.99 });
    expect(res.status).toBe(201);
  });

  it('returns 422 when plan_id is missing', async () => {
    const res = await request(app)
      .post('/api/v1/resellers/1/plan-prices')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ custom_price: 24.99 });
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/v1/resellers/:id/plan-prices/:ppId', () => {
  it('returns 200 and deletes plan price', async () => {
    const res = await request(app)
      .delete('/api/v1/resellers/1/plan-prices/9')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('deleted', true);
  });
});

// =============================================================================
// §19.1 — Commissions
// =============================================================================

describe('GET /api/v1/resellers/:id/commissions', () => {
  it('returns 200 with commission list', async () => {
    const res = await request(app)
      .get('/api/v1/resellers/1/commissions')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('filters by status query param', async () => {
    const res = await request(app)
      .get('/api/v1/resellers/1/commissions?status=pending')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/resellers/:id/commissions/:cId/approve', () => {
  it('returns 200 and approves commission', async () => {
    const res = await request(app)
      .post('/api/v1/resellers/1/commissions/1/approve')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ status: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('status', 'approved');
  });
});

// =============================================================================
// §19.2 — IP Pool Allocations
// =============================================================================

describe('GET /api/v1/resellers/:id/ip-pools', () => {
  it('returns 200 with IP pool allocations', async () => {
    const res = await request(app)
      .get('/api/v1/resellers/1/ip-pools')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('POST /api/v1/resellers/:id/ip-pools', () => {
  it('returns 201 and allocates pool', async () => {
    const res = await request(app)
      .post('/api/v1/resellers/1/ip-pools')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ ip_pool_id: 2 });
    expect(res.status).toBe(201);
  });

  it('returns 422 when ip_pool_id is missing', async () => {
    const res = await request(app)
      .post('/api/v1/resellers/1/ip-pools')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({});
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/v1/resellers/:id/ip-pools/:allocId', () => {
  it('returns 200 and removes allocation', async () => {
    const res = await request(app)
      .delete('/api/v1/resellers/1/ip-pools/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// §19.2 — Bandwidth Quota
// =============================================================================

describe('GET /api/v1/resellers/:id/bandwidth-quota', () => {
  it('returns 200 with quota', async () => {
    const res = await request(app)
      .get('/api/v1/resellers/1/bandwidth-quota')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/v1/resellers/:id/bandwidth-quota', () => {
  it('returns 200 and sets quota', async () => {
    const res = await request(app)
      .put('/api/v1/resellers/1/bandwidth-quota')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ download_mbps: 1000, upload_mbps: 500, is_enforced: true });
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// §19.2 — OLT Port Assignments
// =============================================================================

describe('GET /api/v1/resellers/:id/olt-ports', () => {
  it('returns 200 with OLT port assignments', async () => {
    const res = await request(app)
      .get('/api/v1/resellers/1/olt-ports')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('POST /api/v1/resellers/:id/olt-ports', () => {
  it('returns 201 and assigns OLT port', async () => {
    const res = await request(app)
      .post('/api/v1/resellers/1/olt-ports')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ olt_port_id: 3 });
    expect(res.status).toBe(201);
  });

  it('returns 422 when olt_port_id is missing', async () => {
    const res = await request(app)
      .post('/api/v1/resellers/1/olt-ports')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({});
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/v1/resellers/:id/olt-ports/:aId', () => {
  it('returns 200 and removes OLT port assignment', async () => {
    const res = await request(app)
      .delete('/api/v1/resellers/1/olt-ports/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// §19.2 — Billing Entity
// =============================================================================

describe('GET /api/v1/resellers/:id/billing-entity', () => {
  it('returns 200 with billing entity', async () => {
    const res = await request(app)
      .get('/api/v1/resellers/1/billing-entity')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('legal_name');
  });
});

describe('PUT /api/v1/resellers/:id/billing-entity', () => {
  it('returns 200 and upserts billing entity', async () => {
    const res = await request(app)
      .put('/api/v1/resellers/1/billing-entity')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ legal_name: 'Acme Corp SA', tax_id: 'ACM123', currency: 'USD' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('legal_name');
  });

  it('returns 422 when legal_name is missing', async () => {
    const res = await request(app)
      .put('/api/v1/resellers/1/billing-entity')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ tax_id: 'ACM123' });
    expect(res.status).toBe(422);
  });
});

// =============================================================================
// §19.3 — Reseller Portal
// =============================================================================

describe('GET /api/v1/reseller-portal/:id/dashboard', () => {
  it('returns 200 with dashboard aggregates', async () => {
    const res = await request(app)
      .get('/api/v1/reseller-portal/1/dashboard')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('subscriber_count');
    expect(res.body.data).toHaveProperty('total_revenue');
    expect(res.body.data).toHaveProperty('open_tickets');
    expect(res.body.data).toHaveProperty('pending_commission');
  });
});

describe('GET /api/v1/reseller-portal/:id/clients', () => {
  it('returns 200 with client list', async () => {
    const res = await request(app)
      .get('/api/v1/reseller-portal/1/clients')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/reseller-portal/:id/clients', () => {
  it('returns 201 and creates client under reseller', async () => {
    const res = await request(app)
      .post('/api/v1/reseller-portal/1/clients')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ name: 'New Client', email: 'new@test.com' });
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('name');
  });

  it('returns 422 when name is missing', async () => {
    const res = await request(app)
      .post('/api/v1/reseller-portal/1/clients')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ email: 'new@test.com' });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/reseller-portal/:id/clients/:cId/suspend', () => {
  it('returns 200 and toggles client status', async () => {
    const res = await request(app)
      .post('/api/v1/reseller-portal/1/clients/3/suspend')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('status');
  });
});

describe('POST /api/v1/reseller-portal/:id/clients/:cId/cancel', () => {
  it('returns 200 and sets client inactive', async () => {
    const res = await request(app)
      .post('/api/v1/reseller-portal/1/clients/3/cancel')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('status', 'inactive');
  });
});

describe('GET /api/v1/reseller-portal/:id/invoices', () => {
  it('returns 200 with invoice list', async () => {
    const res = await request(app)
      .get('/api/v1/reseller-portal/1/invoices')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/reseller-portal/:id/inventory', () => {
  it('returns 200 with inventory list', async () => {
    const res = await request(app)
      .get('/api/v1/reseller-portal/1/inventory')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// resellerService unit tests
// =============================================================================

describe('resellerService', () => {
  const resellerService = require('../src/services/resellerService');

  beforeEach(() => {
    db.query.mockReset();
    mockDb();
  });

  describe('getResellerSubtree', () => {
    it('returns root ids plus child ids', async () => {
      const result = await resellerService.getResellerSubtree([1], 10);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toContain(1);
    });

    it('returns empty array for empty input', async () => {
      const result = await resellerService.getResellerSubtree([], 10);
      expect(result).toEqual([]);
    });
  });

  describe('getResellerClientIds', () => {
    it('returns client IDs for a reseller subtree', async () => {
      const result = await resellerService.getResellerClientIds([1], 10);
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns empty array for empty reseller ids', async () => {
      const result = await resellerService.getResellerClientIds([], 10);
      expect(result).toEqual([]);
    });
  });

  describe('getResellerDashboard', () => {
    it('returns dashboard object with expected keys', async () => {
      const result = await resellerService.getResellerDashboard(1, 10);
      expect(result).toHaveProperty('reseller_id', 1);
      expect(result).toHaveProperty('subscriber_count');
      expect(result).toHaveProperty('total_revenue');
      expect(result).toHaveProperty('open_tickets');
      expect(result).toHaveProperty('pending_commission');
    });

    it('returns zeros when reseller has no clients', async () => {
      db.query.mockReset();
      // subtree: no children
      db.query.mockResolvedValueOnce([[]]);
      // clients: none
      db.query.mockResolvedValueOnce([[]]);
      const result = await resellerService.getResellerDashboard(99, 10);
      expect(result.subscriber_count).toBe(0);
      expect(result.total_revenue).toBe(0);
    });
  });

  describe('recordCommission', () => {
    it('does nothing when invoice not found', async () => {
      db.query.mockReset();
      db.query.mockResolvedValueOnce([[]]); // invoice not found
      await expect(resellerService.recordCommission(999, 10)).resolves.toBeUndefined();
    });

    it('does nothing when client has no reseller', async () => {
      db.query.mockReset();
      db.query.mockResolvedValueOnce([[{ id: 5, client_id: 3, total: 100, currency: 'USD' }]]);
      db.query.mockResolvedValueOnce([[{ reseller_id: null }]]);
      await expect(resellerService.recordCommission(5, 10)).resolves.toBeUndefined();
    });

    it('inserts commission record when all lookups succeed', async () => {
      db.query.mockReset();
      db.query.mockResolvedValueOnce([[{ id: 5, client_id: 3, total: 100.00, currency: 'USD' }]]);
      db.query.mockResolvedValueOnce([[{ reseller_id: 1 }]]);
      db.query.mockResolvedValueOnce([[{ id: 1, commission_rate: 10.00 }]]);
      db.query.mockResolvedValueOnce([{ insertId: 1 }]);
      await expect(resellerService.recordCommission(5, 10)).resolves.toBeUndefined();
      expect(db.query).toHaveBeenCalledTimes(4);
    });

    it('does nothing when reseller not found', async () => {
      db.query.mockReset();
      db.query.mockResolvedValueOnce([[{ id: 5, client_id: 3, total: 100, currency: 'USD' }]]);
      db.query.mockResolvedValueOnce([[{ reseller_id: 7 }]]);
      db.query.mockResolvedValueOnce([[]]); // reseller not found
      await expect(resellerService.recordCommission(5, 10)).resolves.toBeUndefined();
    });
  });
});

// =============================================================================
// Additional branch coverage tests
// =============================================================================

describe('GET /api/v1/resellers with filters', () => {
  it('filters by status query param', async () => {
    const res = await request(app)
      .get('/api/v1/resellers?status=active')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
  });

  it('filters by parent_id=null (root resellers)', async () => {
    const res = await request(app)
      .get('/api/v1/resellers?parent_id=null')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
  });

  it('filters by numeric parent_id', async () => {
    const res = await request(app)
      .get('/api/v1/resellers?parent_id=1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/resellers with parent_id', () => {
  it('returns 201 and sets level=2 for sub-reseller', async () => {
    db.query.mockImplementation((sql) => {
      const s = typeof sql === 'string' ? sql : '';
      if (s.includes('`users`') || (s.includes('users') && s.includes('WHERE id = ?'))) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (s.includes('FROM organizations')) {
        return Promise.resolve([[{ id: 10, name: 'Test Org' }]]);
      }
      // parent lookup returns level=1 parent
      if (s.includes('SELECT level FROM resellers')) {
        return Promise.resolve([[{ level: 1 }]]);
      }
      if (s.includes('INSERT INTO resellers')) {
        return Promise.resolve([{ insertId: 2 }]);
      }
      if (s.includes('FROM resellers') && s.includes('WHERE id = ?')) {
        return Promise.resolve([[{ ...sampleReseller, id: 2, parent_id: 1, level: 2 }]]);
      }
      return Promise.resolve([[]]);
    });
    const res = await request(app)
      .post('/api/v1/resellers')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Sub Reseller', parent_id: 1, commission_rate: 5 });
    expect(res.status).toBe(201);
  });

  it('returns 422 when parent would exceed level 2', async () => {
    db.query.mockImplementation((sql) => {
      const s = typeof sql === 'string' ? sql : '';
      if (s.includes('`users`') || (s.includes('users') && s.includes('WHERE id = ?'))) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (s.includes('FROM organizations')) {
        return Promise.resolve([[{ id: 10, name: 'Test Org' }]]);
      }
      // parent at level 2 — child would be level 3 (not allowed)
      if (s.includes('SELECT level FROM resellers')) {
        return Promise.resolve([[{ level: 2 }]]);
      }
      return Promise.resolve([[]]);
    });
    const res = await request(app)
      .post('/api/v1/resellers')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Too Deep', parent_id: 2, commission_rate: 5 });
    expect(res.status).toBe(422);
  });

  it('returns 422 when parent_id not found', async () => {
    db.query.mockImplementation((sql) => {
      const s = typeof sql === 'string' ? sql : '';
      if (s.includes('`users`') || (s.includes('users') && s.includes('WHERE id = ?'))) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (s.includes('FROM organizations')) {
        return Promise.resolve([[{ id: 10, name: 'Test Org' }]]);
      }
      if (s.includes('SELECT level FROM resellers')) {
        return Promise.resolve([[]]); // parent not found
      }
      return Promise.resolve([[]]);
    });
    const res = await request(app)
      .post('/api/v1/resellers')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ name: 'Orphan', parent_id: 999, commission_rate: 5 });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/resellers/:id/commissions/:cId/approve with paid status', () => {
  it('marks commission as paid when status=paid', async () => {
    db.query.mockImplementation((sql) => {
      const s = typeof sql === 'string' ? sql : '';
      if (s.includes('`users`') || (s.includes('users') && s.includes('WHERE id = ?'))) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (s.includes('FROM organizations')) {
        return Promise.resolve([[{ id: 10, name: 'Test Org' }]]);
      }
      if (s.includes('FROM resellers') && s.includes('organization_id')) {
        return Promise.resolve([[sampleReseller]]);
      }
      if (s.includes('FROM reseller_commissions') && s.includes('reseller_id = ?')) {
        return Promise.resolve([[sampleCommission]]);
      }
      if (s.includes('UPDATE reseller_commissions')) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (s.includes('SELECT * FROM reseller_commissions')) {
        return Promise.resolve([[{ ...sampleCommission, status: 'paid' }]]);
      }
      return Promise.resolve([[]]);
    });
    const res = await request(app)
      .post('/api/v1/resellers/1/commissions/1/approve')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ status: 'paid' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('status', 'paid');
  });
});

describe('Portal: inactive reseller and wrong reseller checks', () => {
  it('returns 422 when creating client under inactive reseller', async () => {
    db.query.mockImplementation((sql) => {
      const s = typeof sql === 'string' ? sql : '';
      if (s.includes('`users`') || (s.includes('users') && s.includes('WHERE id = ?'))) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (s.includes('FROM organizations')) {
        return Promise.resolve([[{ id: 10, name: 'Test Org' }]]);
      }
      if (s.includes('FROM resellers') && s.includes('organization_id')) {
        return Promise.resolve([[{ ...sampleReseller, status: 'suspended' }]]);
      }
      return Promise.resolve([[]]);
    });
    const res = await request(app)
      .post('/api/v1/reseller-portal/1/clients')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ name: 'New Client' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when suspending client that belongs to different reseller', async () => {
    db.query.mockImplementation((sql) => {
      const s = typeof sql === 'string' ? sql : '';
      if (s.includes('`users`') || (s.includes('users') && s.includes('WHERE id = ?'))) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (s.includes('FROM organizations')) {
        return Promise.resolve([[{ id: 10, name: 'Test Org' }]]);
      }
      if (s.includes('FROM resellers') && s.includes('organization_id')) {
        return Promise.resolve([[sampleReseller]]); // reseller id=1
      }
      if (s.includes('SELECT id, status, reseller_id FROM clients')) {
        return Promise.resolve([[{ id: 3, status: 'active', reseller_id: 99 }]]); // wrong reseller
      }
      return Promise.resolve([[]]);
    });
    const res = await request(app)
      .post('/api/v1/reseller-portal/1/clients/3/suspend')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(422);
  });

  it('returns 422 when cancelling client that belongs to different reseller', async () => {
    db.query.mockImplementation((sql) => {
      const s = typeof sql === 'string' ? sql : '';
      if (s.includes('`users`') || (s.includes('users') && s.includes('WHERE id = ?'))) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (s.includes('FROM organizations')) {
        return Promise.resolve([[{ id: 10, name: 'Test Org' }]]);
      }
      if (s.includes('FROM resellers') && s.includes('organization_id')) {
        return Promise.resolve([[sampleReseller]]); // reseller id=1
      }
      if (s.includes('SELECT id, reseller_id FROM clients')) {
        return Promise.resolve([[{ id: 3, reseller_id: 99 }]]); // wrong reseller
      }
      return Promise.resolve([[]]);
    });
    const res = await request(app)
      .post('/api/v1/reseller-portal/1/clients/3/cancel')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(422);
  });

  it('returns 200 with empty list when reseller has no clients (invoices)', async () => {
    db.query.mockImplementation((sql) => {
      const s = typeof sql === 'string' ? sql : '';
      if (s.includes('`users`') || (s.includes('users') && s.includes('WHERE id = ?'))) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (s.includes('FROM organizations')) {
        return Promise.resolve([[{ id: 10, name: 'Test Org' }]]);
      }
      if (s.includes('FROM resellers') && s.includes('organization_id')) {
        return Promise.resolve([[sampleReseller]]);
      }
      // subtree: no children
      if (s.includes('FROM resellers') && s.includes('parent_id IN')) {
        return Promise.resolve([[]]); // no sub-resellers
      }
      // getResellerClientIds: no clients
      if (s.includes('FROM clients') && s.includes('reseller_id IN')) {
        return Promise.resolve([[]]); // no clients
      }
      return Promise.resolve([[]]);
    });
    const res = await request(app)
      .get('/api/v1/reseller-portal/1/invoices')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('returns 200 with empty list when reseller has no clients (inventory)', async () => {
    db.query.mockImplementation((sql) => {
      const s = typeof sql === 'string' ? sql : '';
      if (s.includes('`users`') || (s.includes('users') && s.includes('WHERE id = ?'))) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (s.includes('FROM organizations')) {
        return Promise.resolve([[{ id: 10, name: 'Test Org' }]]);
      }
      if (s.includes('FROM resellers') && s.includes('organization_id')) {
        return Promise.resolve([[sampleReseller]]);
      }
      if (s.includes('FROM resellers') && s.includes('parent_id IN')) {
        return Promise.resolve([[]]); // no sub-resellers
      }
      if (s.includes('FROM clients') && s.includes('reseller_id IN')) {
        return Promise.resolve([[]]); // no clients
      }
      return Promise.resolve([[]]);
    });
    const res = await request(app)
      .get('/api/v1/reseller-portal/1/inventory')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
