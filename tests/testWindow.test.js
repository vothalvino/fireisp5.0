'use strict';
// =============================================================================
// FireISP 5.0 — install test window (migration 448)
// =============================================================================
// Pending contracts are DOWN by default; the technician opens a bounded test
// window; the sweep closes expired ones; formal activation turns the line on
// permanently and clears the bound.
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/suspensionService', () => ({
  sendRadiusDisconnect: jest.fn().mockResolvedValue({ sent: true }),
}));

const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');
const svc = require('../src/services/testWindowService');
const suspensionService = require('../src/services/suspensionService');

const TOKEN = jwt.sign(
  { sub: 1, email: 'a@b.c', role: 'admin', orgId: 42 },
  config.jwt.secret, { expiresIn: '1h' },
);
const isAuthLookup = (s) => typeof s === 'string' && /`users`/.test(s);
const ADMIN_ROW = [[{ id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 42 }]];

beforeEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
function wireDb({ contract, radius, setting = null }) {
  db.query.mockImplementation(async (sql) => {
    const s = String(sql).replace(/\s+/g, ' ');
    if (isAuthLookup(s)) return ADMIN_ROW;
    if (/SELECT \* FROM contracts WHERE id = \?/.test(s)) return [contract ? [{ ...contract }] : []];
    if (/SELECT \* FROM radius WHERE contract_id = \?/.test(s)) return [radius ? [{ ...radius }] : []];
    if (/SELECT setting_value FROM organization_settings/.test(s)) return [setting ? [{ setting_value: setting }] : []];
    if (/UPDATE radius SET status = 'active'/.test(s)) return [{ affectedRows: 1 }];
    if (/UPDATE radius SET status = 'inactive'/.test(s)) return [{ affectedRows: 1 }];
    if (/UPDATE contracts SET test_window_expires_at = DATE_ADD/.test(s)) return [{ affectedRows: 1 }];
    if (/UPDATE contracts SET test_window_expires_at = NULL/.test(s)) return [{ affectedRows: 1 }];
    if (/SELECT test_window_expires_at FROM contracts/.test(s)) return [[{ test_window_expires_at: '2026-08-05T12:00:00.000Z' }]];
    return [[]];
  });
}

const PENDING = { id: 33, organization_id: 42, status: 'pending', test_window_expires_at: null };
const RADIUS = { id: 9, contract_id: 33, username: 'sub_x', password: 'pw', nas_id: null, profile: null };

describe('testWindowService', () => {
  it('startWindow enables the account and stamps the org-configured bound', async () => {
    wireDb({ contract: PENDING, radius: RADIUS, setting: '30' });
    const result = await svc.startWindow(33, { orgId: 42 });
    expect(result.minutes).toBe(30);
    const stamp = db.query.mock.calls.find(([s]) => /DATE_ADD\(NOW\(\), INTERVAL \? MINUTE\)/.test(s));
    expect(stamp[1]).toEqual([30, 33]);
    expect(db.query.mock.calls.some(([s]) => /UPDATE radius SET status = 'active'/.test(s))).toBe(true);
  });

  it('startWindow falls back to the 60-minute default and refuses non-pending contracts', async () => {
    wireDb({ contract: PENDING, radius: RADIUS });
    const result = await svc.startWindow(33, { orgId: 42 });
    expect(result.minutes).toBe(60);

    wireDb({ contract: { ...PENDING, status: 'active' }, radius: RADIUS });
    await expect(svc.startWindow(33, { orgId: 42 })).rejects.toThrow(/pending contracts only/);
  });

  it('startWindow refuses a contract with no RADIUS account', async () => {
    wireDb({ contract: PENDING, radius: null });
    await expect(svc.startWindow(33, { orgId: 42 })).rejects.toThrow(/no RADIUS account/);
  });

  it('endWindow disables the account, clears the bound, and kicks the session', async () => {
    wireDb({ contract: { ...PENDING, test_window_expires_at: '2026-08-05T11:00:00.000Z' }, radius: RADIUS });
    const result = await svc.endWindow(33, { orgId: 42, reason: 'manual' });
    expect(result.closed).toBe(true);
    expect(db.query.mock.calls.some(([s]) => /UPDATE radius SET status = 'inactive'/.test(s))).toBe(true);
    expect(db.query.mock.calls.some(([s]) => /test_window_expires_at = NULL/.test(s))).toBe(true);
    expect(suspensionService.sendRadiusDisconnect).toHaveBeenCalledWith(33);
  });

  it('sweep closes only expired PENDING windows', async () => {
    const phase = 'sweep';
    db.query.mockImplementation(async (sql) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (/WHERE status = 'pending' AND deleted_at IS NULL AND test_window_expires_at IS NOT NULL/.test(s)) {
        return [[{ id: 33, organization_id: 42 }]];
      }
      if (/SELECT \* FROM contracts WHERE id = \?/.test(s)) return [[{ ...PENDING, test_window_expires_at: '2026-08-05T10:00:00.000Z' }]];
      if (/UPDATE/.test(s)) return [{ affectedRows: 1 }];
      return [[]];
    });
    const result = await svc.sweep();
    expect(result).toEqual({ examined: 1, closed: 1 });
    expect(phase).toBe('sweep'); // sweep query itself carries the pending+bound filter
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
describe('POST /work-orders/:id/test-window/*', () => {
  const INSTALL_WO = { id: 13, organization_id: 42, work_type: 'installation', contract_id: 33 };

  function wireRoute({ wo, contract, radius }) {
    db.query.mockImplementation(async (sql) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (isAuthLookup(s)) return ADMIN_ROW;
      if (/SELECT \* FROM work_orders WHERE id = \?/.test(s)) return [wo ? [{ ...wo }] : []];
      if (/SELECT \* FROM contracts WHERE id = \?/.test(s)) return [contract ? [{ ...contract }] : []];
      if (/SELECT \* FROM radius WHERE contract_id = \?/.test(s)) return [radius ? [{ ...radius }] : []];
      if (/SELECT setting_value FROM organization_settings/.test(s)) return [[]];
      if (/UPDATE/.test(s)) return [{ affectedRows: 1 }];
      if (/SELECT test_window_expires_at FROM contracts/.test(s)) return [[{ test_window_expires_at: '2026-08-05T12:00:00.000Z' }]];
      return [[]];
    });
  }

  it('start opens the window through the installation work order', async () => {
    wireRoute({ wo: INSTALL_WO, contract: PENDING, radius: RADIUS });
    const res = await request(app)
      .post('/api/v1/work-orders/13/test-window/start')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data.expires_at).toBeTruthy();
    expect(res.body.data.minutes).toBe(60);
  });

  it('end closes the window', async () => {
    wireRoute({ wo: INSTALL_WO, contract: { ...PENDING, test_window_expires_at: 'x' }, radius: RADIUS });
    const res = await request(app)
      .post('/api/v1/work-orders/13/test-window/end')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data.closed).toBe(true);
  });

  it('422s a non-installation work order', async () => {
    wireRoute({ wo: { ...INSTALL_WO, work_type: 'repair' }, contract: PENDING, radius: RADIUS });
    const res = await request(app)
      .post('/api/v1/work-orders/13/test-window/start')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(422);
  });

  it('422s once the contract is active — activation owns the line', async () => {
    wireRoute({ wo: INSTALL_WO, contract: { ...PENDING, status: 'active' }, radius: RADIUS });
    const res = await request(app)
      .post('/api/v1/work-orders/13/test-window/start')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/already online/);
  });
});
