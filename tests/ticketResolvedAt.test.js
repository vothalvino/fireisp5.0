// =============================================================================
// FireISP 5.0 — Ticket resolved_at lifecycle tests
// =============================================================================
// The tickets update path stamps resolved_at = NOW() when a ticket transitions
// into 'resolved' (so downstream CSAT dispatch fires), and clears it back to
// NULL when a resolved/closed ticket is reopened into an active state.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');
jest.mock('../src/services/auditLog', () => ({ log: jest.fn() }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const auditLog = require('../src/services/auditLog');
const app = require('../src/app');

const authToken = jwt.sign(
  { sub: 1, email: 'agent@example.com', role: 'admin', orgId: 1 },
  config.jwt.secret,
  { expiresIn: '1h' },
);

function mockAuthUser() {
  User.findById.mockResolvedValue({
    id: 1,
    email: 'agent@example.com',
    status: 'active',
    role: 'admin',
    organization_id: 1,
  });
}

// Locate the `UPDATE tickets SET ...` call the model issued.
function findUpdateCall() {
  return db.query.mock.calls.find(([sql]) => /^UPDATE `tickets` SET/.test(sql));
}

beforeEach(() => {
  jest.resetAllMocks();
  auditLog.log.mockResolvedValue();
  mockAuthUser();
});

function mockUpdateSequence(oldRecord) {
  db.query
    .mockResolvedValueOnce([[oldRecord]])          // findByIdOrFail (old)
    .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE
    .mockResolvedValueOnce([[{ ...oldRecord }]]);  // findById (fresh)
}

describe('PUT /api/tickets/:id — resolved_at lifecycle', () => {
  test('stamps resolved_at when status transitions to resolved', async () => {
    mockUpdateSequence({ id: 1, organization_id: 1, client_id: 10, subject: 'x', status: 'open', resolved_at: null });

    const res = await request(app)
      .put('/api/tickets/1')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'resolved' });

    expect(res.status).toBe(200);
    const call = findUpdateCall();
    expect(call).toBeDefined();
    expect(call[0]).toMatch(/`resolved_at` = \?/);
    expect(call[1].some(p => p instanceof Date)).toBe(true);
  });

  test('clears resolved_at when a resolved ticket is reopened to open', async () => {
    mockUpdateSequence({ id: 1, organization_id: 1, client_id: 10, subject: 'x', status: 'resolved', resolved_at: new Date('2026-01-01T00:00:00Z') });

    const res = await request(app)
      .put('/api/tickets/1')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'in_progress' });

    expect(res.status).toBe(200);
    const call = findUpdateCall();
    expect(call).toBeDefined();
    expect(call[0]).toMatch(/`resolved_at` = \?/);
    expect(call[1]).toContain(null);
  });

  test('leaves resolved_at untouched when a resolved ticket is closed', async () => {
    mockUpdateSequence({ id: 1, organization_id: 1, client_id: 10, subject: 'x', status: 'resolved', resolved_at: new Date('2026-01-01T00:00:00Z') });

    const res = await request(app)
      .put('/api/tickets/1')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'closed' });

    expect(res.status).toBe(200);
    const call = findUpdateCall();
    expect(call).toBeDefined();
    expect(call[0]).not.toMatch(/resolved_at/);
  });

  test('ignores a client-supplied resolved_at when status is unchanged', async () => {
    mockUpdateSequence({ id: 1, organization_id: 1, client_id: 10, subject: 'x', status: 'open', resolved_at: null });

    const res = await request(app)
      .put('/api/tickets/1')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ subject: 'renamed', resolved_at: '2020-01-01 00:00:00' });

    expect(res.status).toBe(200);
    const call = findUpdateCall();
    expect(call).toBeDefined();
    expect(call[0]).not.toMatch(/resolved_at/);
  });
});
