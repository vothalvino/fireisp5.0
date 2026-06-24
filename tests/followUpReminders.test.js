// =============================================================================
// FireISP 5.0 — Follow-up reminders route tests (ticket_id filter)
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@example.com', role: 'admin', orgId: 1 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /follow-up-reminders', () => {
  test('filters by ticket_id', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 1 }]]) // auth
      .mockResolvedValueOnce([[{ id: 7, title: 'Call back', status: 'pending', ticket_id: 99, client_id: 3 }]])              // rows
      .mockResolvedValueOnce([[{ total: 1 }]]);                                                                              // count

    const res = await request(app)
      .get('/api/v1/follow-up-reminders?ticket_id=99')
      .set('Authorization', `Bearer ${adminToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);

    // The rows query must have been filtered by ticket_id with the value bound.
    const rowsCall = db.query.mock.calls.find(
      c => /follow_up_reminders/.test(c[0]) && /r\.ticket_id = \?/.test(c[0]),
    );
    expect(rowsCall).toBeTruthy();
    expect(rowsCall[1]).toContain('99');
  });
});
