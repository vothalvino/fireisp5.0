// =============================================================================
// FireISP 5.0 — Interaction Tracking Route Tests (§1.3)
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  queryReplica: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/services/interactionService', () => ({
  activityTimeline: jest.fn(),
  surveyMetrics: jest.fn(),
  sendSurvey: jest.fn(),
  respondSurvey: jest.fn(),
  escalateTicket: jest.fn(),
  escalationCandidates: jest.fn(),
  transitionEscalation: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const interactionService = require('../src/services/interactionService');
const app = require('../src/app');

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@example.com', role: 'admin', orgId: 42 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

function mockDb() {
  db.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('FROM follow_up_reminders r')) {
      return Promise.resolve([[{ id: 7, title: 'Call back', client_name: 'Jane', status: 'pending' }]]);
    }
    if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
      return Promise.resolve([[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT')) {
      return Promise.resolve([{ insertId: 999 }]);
    }
    if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
      return Promise.resolve([[{ total: 0 }]]);
    }
    return Promise.resolve([[]]);
  });
}

describe('Interaction Tracking routes (§1.3)', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb();
  });

  // ---- Interactions ----
  test('POST /interactions accepts a valid interaction', async () => {
    const res = await request(app)
      .post('/api/v1/interactions')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 5, interaction_type: 'call', direction: 'inbound', subject: 'Asked about upgrade' });
    expect(res.status).not.toBe(422);
  });

  test('POST /interactions rejects an invalid interaction type', async () => {
    const res = await request(app)
      .post('/api/v1/interactions')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 5, interaction_type: 'telegram', subject: 'Bad channel' });
    expect(res.status).toBe(422);
  });

  test('POST /interactions requires a subject', async () => {
    const res = await request(app)
      .post('/api/v1/interactions')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 5, interaction_type: 'call' });
    expect(res.status).toBe(422);
  });

  test('POST /interactions requires a client_id', async () => {
    const res = await request(app)
      .post('/api/v1/interactions')
      .set('Authorization', `Bearer ${token}`)
      .send({ interaction_type: 'call', subject: 'No client' });
    expect(res.status).toBe(422);
  });

  // ---- Follow-up reminders ----
  test('POST /follow-up-reminders requires a due date', async () => {
    const res = await request(app)
      .post('/api/v1/follow-up-reminders')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 5, title: 'Call back tomorrow' });
    expect(res.status).toBe(422);
  });

  test('POST /follow-up-reminders accepts a valid reminder', async () => {
    const res = await request(app)
      .post('/api/v1/follow-up-reminders')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 5, title: 'Call back tomorrow', due_at: '2026-07-01 10:00:00', priority: 'high' });
    expect(res.status).not.toBe(422);
  });

  test('POST /follow-up-reminders rejects an invalid priority', async () => {
    const res = await request(app)
      .post('/api/v1/follow-up-reminders')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 5, title: 'Call back', due_at: '2026-07-01 10:00:00', priority: 'urgent' });
    expect(res.status).toBe(422);
  });

  test('GET /follow-up-reminders/due lists due reminders', async () => {
    const res = await request(app)
      .get('/api/v1/follow-up-reminders/due')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].title).toBe('Call back');
  });

  // ---- Satisfaction surveys ----
  test('GET /satisfaction-surveys/metrics delegates to interactionService', async () => {
    interactionService.surveyMetrics.mockResolvedValue({ nps: { score: 50 }, csat: { average: 4.5 } });
    const res = await request(app)
      .get('/api/v1/satisfaction-surveys/metrics')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.nps.score).toBe(50);
    expect(interactionService.surveyMetrics).toHaveBeenCalledWith(42, { months: undefined });
  });

  test('POST /satisfaction-surveys/:id/respond requires a score', async () => {
    const res = await request(app)
      .post('/api/v1/satisfaction-surveys/3/respond')
      .set('Authorization', `Bearer ${token}`)
      .send({ comment: 'Great service' });
    expect(res.status).toBe(422);
  });

  test('POST /satisfaction-surveys/:id/respond delegates to interactionService', async () => {
    interactionService.respondSurvey.mockResolvedValue({ id: 3, status: 'responded', score: 9 });
    const res = await request(app)
      .post('/api/v1/satisfaction-surveys/3/respond')
      .set('Authorization', `Bearer ${token}`)
      .send({ score: 9, comment: 'Great service' });
    expect(res.status).toBe(200);
    expect(res.body.data.score).toBe(9);
    expect(interactionService.respondSurvey).toHaveBeenCalledWith('3', 42, { score: 9, comment: 'Great service' });
  });

  // ---- Escalations ----
  test('POST /escalations requires a reason', async () => {
    const res = await request(app)
      .post('/api/v1/escalations')
      .set('Authorization', `Bearer ${token}`)
      .send({ ticket_id: 12 });
    expect(res.status).toBe(422);
  });

  test('POST /escalations delegates to interactionService', async () => {
    interactionService.escalateTicket.mockResolvedValue({ id: 1, ticket_id: 12, level: 1, status: 'open' });
    const res = await request(app)
      .post('/api/v1/escalations')
      .set('Authorization', `Bearer ${token}`)
      .send({ ticket_id: 12, reason: 'Client called twice with no resolution' });
    expect(res.status).toBe(201);
    expect(res.body.data.level).toBe(1);
    expect(interactionService.escalateTicket).toHaveBeenCalledWith(12, expect.objectContaining({
      orgId: 42,
      reason: 'Client called twice with no resolution',
    }));
  });

  test('POST /escalations/:id/transition rejects an invalid status', async () => {
    const res = await request(app)
      .post('/api/v1/escalations/1/transition')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'reopened' });
    expect(res.status).toBe(422);
  });

  test('POST /escalations/:id/transition delegates to interactionService', async () => {
    interactionService.transitionEscalation.mockResolvedValue({ id: 1, status: 'acknowledged' });
    const res = await request(app)
      .post('/api/v1/escalations/1/transition')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'acknowledged' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('acknowledged');
  });

  test('GET /escalations/candidates delegates to interactionService', async () => {
    interactionService.escalationCandidates.mockResolvedValue([{ id: 12, subject: 'No internet', hours_open: 50 }]);
    const res = await request(app)
      .get('/api/v1/escalations/candidates')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(12);
  });

  // ---- Client timeline ----
  test('GET /clients/:id/timeline delegates to interactionService', async () => {
    interactionService.activityTimeline.mockResolvedValue({
      client_id: 5,
      events: [{ event_type: 'ticket', reference_id: 9, title: 'No internet', occurred_at: '2026-06-01' }],
    });
    const res = await request(app)
      .get('/api/v1/clients/5/timeline')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.events).toHaveLength(1);
    expect(interactionService.activityTimeline).toHaveBeenCalledWith('5', 42, { limit: undefined });
  });

  test('returns 401 without a token', async () => {
    const res = await request(app).get('/api/v1/interactions');
    expect(res.status).toBe(401);
  });
});
