// =============================================================================
// FireISP 5.0 — GET /inventory/items — quantity_on_hand (Inventory follow-up)
// =============================================================================
// Covers the hand-rolled list handler (src/routes/inventory.js) that replaced
// crudController.list so the response could be enriched with
// `quantity_on_hand` (SUM of stock across all warehouses via a single grouped
// LEFT JOIN — InventoryItem.findAllWithStock). This is what makes items
// sellable directly in the invoice/quote product picker (they can show a
// real on-hand quantity) and fixes InventoryManagement's Stock tab, which
// previously always rendered "—" because the field was never in the response.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

function adminToken(orgId = 42) {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const isAuthLookup = (s) => typeof s === 'string' && /WHERE id = \?/.test(s) && !/inventory_items/.test(s);

beforeEach(() => { jest.clearAllMocks(); });

describe('GET /api/v1/inventory/items', () => {
  test('includes quantity_on_hand (grouped SUM), org-scoped', async () => {
    let dataQueryParams = null;
    let countQueryParams = null;
    db.query.mockImplementation((sql, params) => {
      if (isAuthLookup(sql)) return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 42 }]]);
      if (typeof sql === 'string' && sql.includes('quantity_on_hand') && sql.includes('FROM inventory_items i')) {
        dataQueryParams = params;
        return Promise.resolve([[
          { id: 1, name: 'MikroTik hAP ac3', sku: 'MT-HAP', sale_price: '899.00', unit_cost: '650.00', status: 'active', quantity_on_hand: '5' },
          { id: 2, name: 'Loose cable', sku: 'CBL-1', sale_price: null, unit_cost: '10.00', status: 'active', quantity_on_hand: 0 },
        ]]);
      }
      if (typeof sql === 'string' && sql.includes('COUNT(*) AS total FROM `inventory_items`')) {
        countQueryParams = params;
        return Promise.resolve([[{ total: 2 }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .get('/api/v1/inventory/items')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].quantity_on_hand).toBe('5');
    expect(res.body.data[1].quantity_on_hand).toBe(0);
    expect(res.body.meta.total).toBe(2);
    // Org-scoped: the org id from the JWT must be bound into both queries.
    expect(dataQueryParams).toContain(42);
    expect(countQueryParams).toContain(42);
  });

  test('supports the status filter (matches the pre-existing crudController.list contract)', async () => {
    let dataSql = null;
    db.query.mockImplementation((sql) => {
      if (isAuthLookup(sql)) return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 42 }]]);
      if (typeof sql === 'string' && sql.includes('quantity_on_hand') && sql.includes('FROM inventory_items i')) {
        dataSql = sql;
        return Promise.resolve([[]]);
      }
      if (typeof sql === 'string' && sql.includes('COUNT(*) AS total FROM `inventory_items`')) {
        return Promise.resolve([[{ total: 0 }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .get('/api/v1/inventory/items?status=active')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(dataSql).toContain('i.`status` = ?');
  });
});
