'use strict';
// =============================================================================
// FireISP 5.0 — Install-acceptance gate on work-order completion (migration 445)
// =============================================================================
// Completing an INSTALLATION work order that serves a contract requires at
// least one acceptance reading (signal dBm / link Mbps / optical Rx dBm) or an
// explicit waive. Only the transition INTO completed is gated; other work
// types, contract-less installs, and edits of already-completed orders pass.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

const TOKEN = jwt.sign(
  { sub: 1, email: 'admin@example.com', role: 'admin', orgId: 42 },
  config.jwt.secret, { expiresIn: '1h' },
);

const isAuthLookup = (s) => typeof s === 'string' && /`users`/.test(s);
const isWoBefore   = (s) => typeof s === 'string' && /SELECT \* FROM work_orders WHERE id = \? AND organization_id = \?/.test(s);
const isWoUpdate   = (s) => typeof s === 'string' && /UPDATE work_orders SET/.test(s);
const isWoRefetch  = (s) => typeof s === 'string' && /SELECT \* FROM work_orders WHERE id = \?$/.test(s.trim());

const ADMIN_ROW = [[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]];

const INSTALL_WO = {
  id: 5, organization_id: 42, client_id: 9, site_id: null, device_id: null,
  contract_id: 7, service_order_id: 3, ticket_id: null, assigned_to: null,
  title: 'Installation — SO-000003', description: null, status: 'in_progress',
  priority: 'medium', work_type: 'installation', scheduled_at: null,
  started_at: null, completed_at: null, latitude: null, longitude: null,
  address: null, notes: null,
  acceptance_signal_dbm: null, acceptance_link_mbps: null, acceptance_rx_dbm: null,
  acceptance_waived: 0, acceptance_notes: null, acceptance_recorded_at: null,
};

function wire(beforeRow) {
  db.query.mockImplementation(async (sql) => {
    if (isAuthLookup(sql)) return ADMIN_ROW;
    if (isWoBefore(sql)) return [[{ ...beforeRow }]];
    if (isWoUpdate(sql)) return [{ affectedRows: 1 }];
    if (isWoRefetch(sql)) return [[{ ...beforeRow, status: 'completed' }]];
    return [[]];
  });
}
const updateIssued = () => db.query.mock.calls.some(([s]) => isWoUpdate(s));

beforeEach(() => jest.clearAllMocks());

describe('PATCH /work-orders/:id → completed', () => {
  it('422s an installation WO with a contract, no readings, no waive — and writes nothing', async () => {
    wire(INSTALL_WO);
    const res = await request(app)
      .patch('/api/v1/work-orders/5')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'completed' });
    expect(res.status).toBe(422);
    expect(String(res.body.error)).toMatch(/acceptance reading/i);
    expect(updateIssued()).toBe(false);
  });

  it('completes with a signal reading and stamps acceptance_recorded_at', async () => {
    wire(INSTALL_WO);
    const res = await request(app)
      .patch('/api/v1/work-orders/5')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'completed', acceptance_signal_dbm: -58 });
    expect(res.status).toBe(200);
    const upd = db.query.mock.calls.find(([s]) => isWoUpdate(s));
    expect(upd[0]).toMatch(/acceptance_recorded_at = NOW\(\)/);
  });

  it('completes with an explicit waive', async () => {
    wire(INSTALL_WO);
    const res = await request(app)
      .patch('/api/v1/work-orders/5')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'completed', acceptance_waived: true, acceptance_notes: 'legacy CPE, no readable metrics' });
    expect(res.status).toBe(200);
  });

  it('completes when a reading is already on the row', async () => {
    wire({ ...INSTALL_WO, acceptance_rx_dbm: -19.5, acceptance_recorded_at: '2026-08-04 10:00:00' });
    const res = await request(app)
      .patch('/api/v1/work-orders/5')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'completed' });
    expect(res.status).toBe(200);
    // No acceptance field in the body — the stamp must not be re-written.
    const upd = db.query.mock.calls.find(([s]) => isWoUpdate(s));
    expect(upd[0]).not.toMatch(/acceptance_recorded_at = NOW\(\)/);
  });

  it('does not gate a non-installation work order', async () => {
    wire({ ...INSTALL_WO, work_type: 'repair' });
    const res = await request(app)
      .patch('/api/v1/work-orders/5')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'completed' });
    expect(res.status).toBe(200);
  });

  it('does not gate an installation WO with no contract (internal/site work)', async () => {
    wire({ ...INSTALL_WO, contract_id: null, site_id: 2 });
    const res = await request(app)
      .patch('/api/v1/work-orders/5')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'completed' });
    expect(res.status).toBe(200);
  });

  it('does not re-gate an already-completed order being edited', async () => {
    wire({ ...INSTALL_WO, status: 'completed' });
    const res = await request(app)
      .patch('/api/v1/work-orders/5')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'completed', notes: 'follow-up note' });
    expect(res.status).toBe(200);
  });
});

describe('PUT /work-orders/:id → completed', () => {
  const PUT_BODY = {
    title: 'Installation — SO-000003', status: 'completed', priority: 'medium',
    work_type: 'installation', client_id: 9, contract_id: 7, service_order_id: 3,
  };

  it('422s the full-replace transition without readings too', async () => {
    wire(INSTALL_WO);
    const res = await request(app)
      .put('/api/v1/work-orders/5')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send(PUT_BODY);
    expect(res.status).toBe(422);
    expect(updateIssued()).toBe(false);
  });

  it('passes with a link-rate reading and preserves prior readings via COALESCE', async () => {
    wire(INSTALL_WO);
    const res = await request(app)
      .put('/api/v1/work-orders/5')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ ...PUT_BODY, acceptance_link_mbps: 87.5 });
    expect(res.status).toBe(200);
    const upd = db.query.mock.calls.find(([s]) => isWoUpdate(s));
    expect(upd[0]).toMatch(/acceptance_signal_dbm = COALESCE\(\?, acceptance_signal_dbm\)/);
  });
});
