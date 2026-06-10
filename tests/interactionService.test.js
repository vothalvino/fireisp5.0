// =============================================================================
// FireISP 5.0 — Interaction Tracking Service Tests (§1.3)
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  queryReplica: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');
const eventBus = require('../src/services/eventBus');
const interactionService = require('../src/services/interactionService');
const { ValidationError, NotFoundError } = require('../src/utils/errors');

describe('interactionService (§1.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // surveyMetrics
  // ---------------------------------------------------------------------------
  describe('surveyMetrics', () => {
    test('computes NPS score and CSAT average from aggregate rows', async () => {
      db.queryReplica.mockResolvedValue([[
        { survey_type: 'nps', total: 10, responses: 6, promoters: 4, passives: 1, detractors: 1, satisfied: 0, avg_score: 8.5 },
        { survey_type: 'csat', total: 12, responses: 10, promoters: 0, passives: 0, detractors: 0, satisfied: 8, avg_score: 4.3 },
      ]]);

      const metrics = await interactionService.surveyMetrics(42);

      // (4 promoters - 1 detractor) / 6 responses = 50
      expect(metrics.nps.score).toBe(50);
      expect(metrics.nps.responses).toBe(6);
      expect(metrics.csat.average).toBe(4.3);
      expect(metrics.csat.satisfaction_pct).toBe(80);
    });

    test('returns null scores when there are no responses', async () => {
      db.queryReplica.mockResolvedValue([[]]);
      const metrics = await interactionService.surveyMetrics(42);
      expect(metrics.nps.score).toBeNull();
      expect(metrics.csat.average).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // respondSurvey
  // ---------------------------------------------------------------------------
  describe('respondSurvey', () => {
    function mockSurvey(survey) {
      db.query.mockImplementation((sql) => {
        if (sql.includes('SELECT * FROM `satisfaction_surveys`')) {
          return Promise.resolve([[survey]]);
        }
        if (sql.startsWith('UPDATE')) {
          return Promise.resolve([{ affectedRows: 1 }]);
        }
        return Promise.resolve([[]]);
      });
    }

    test('rejects an out-of-range NPS score', async () => {
      mockSurvey({ id: 1, survey_type: 'nps', status: 'sent', client_id: 5 });
      await expect(interactionService.respondSurvey(1, null, { score: 11 }))
        .rejects.toThrow(ValidationError);
    });

    test('rejects an out-of-range CSAT score', async () => {
      mockSurvey({ id: 1, survey_type: 'csat', status: 'sent', client_id: 5 });
      await expect(interactionService.respondSurvey(1, null, { score: 0 }))
        .rejects.toThrow(ValidationError);
    });

    test('rejects responding twice', async () => {
      mockSurvey({ id: 1, survey_type: 'csat', status: 'responded', score: 5, client_id: 5 });
      await expect(interactionService.respondSurvey(1, null, { score: 4 }))
        .rejects.toThrow('already been responded');
    });

    test('accepts a valid CSAT score and marks the survey responded', async () => {
      mockSurvey({ id: 1, survey_type: 'csat', status: 'sent', client_id: 5 });
      await interactionService.respondSurvey(1, null, { score: 5, comment: 'Excellent' });
      const updateCall = db.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE'));
      expect(updateCall[0]).toContain('`status` = ?');
      expect(updateCall[1]).toEqual(expect.arrayContaining([5, 'Excellent', 'responded']));
    });

    test('throws NotFoundError for a missing survey', async () => {
      db.query.mockResolvedValue([[]]);
      await expect(interactionService.respondSurvey(99, null, { score: 5 }))
        .rejects.toThrow(NotFoundError);
    });
  });

  // ---------------------------------------------------------------------------
  // escalateTicket
  // ---------------------------------------------------------------------------
  describe('escalateTicket', () => {
    test('throws NotFoundError when the ticket does not exist', async () => {
      db.query.mockResolvedValue([[]]);
      await expect(interactionService.escalateTicket(99, { reason: 'x' }))
        .rejects.toThrow(NotFoundError);
    });

    test('refuses to escalate a resolved ticket', async () => {
      db.query.mockImplementation((sql) => {
        if (sql.includes('FROM tickets')) {
          return Promise.resolve([[{ id: 12, status: 'resolved', organization_id: 42 }]]);
        }
        return Promise.resolve([[]]);
      });
      await expect(interactionService.escalateTicket(12, { reason: 'x' }))
        .rejects.toThrow('Cannot escalate');
    });

    test('creates an escalation one level above the current maximum and emits an event', async () => {
      const created = { id: 77, ticket_id: 12, level: 3, status: 'open', reason: 'still broken' };
      db.query.mockImplementation((sql) => {
        if (sql.includes('FROM tickets')) {
          return Promise.resolve([[{ id: 12, status: 'open', subject: 'No internet', client_id: 5, organization_id: 42, assigned_to: 8 }]]);
        }
        if (sql.includes('MAX(level)')) {
          return Promise.resolve([[{ max_level: 2 }]]);
        }
        if (sql.startsWith('INSERT')) {
          return Promise.resolve([{ insertId: 77 }]);
        }
        if (sql.includes('SELECT * FROM `ticket_escalations`')) {
          return Promise.resolve([[created]]);
        }
        return Promise.resolve([[]]);
      });

      const emitted = [];
      const listener = (payload) => emitted.push(payload);
      eventBus.on('ticket.escalated', listener);
      try {
        const escalation = await interactionService.escalateTicket(12, { orgId: 42, userId: 1, reason: 'still broken' });
        expect(escalation.id).toBe(77);

        const insertCall = db.query.mock.calls.find(([sql]) => sql.startsWith('INSERT'));
        expect(insertCall[1]).toEqual(expect.arrayContaining([3, 'still broken'])); // level = max + 1
        expect(emitted).toHaveLength(1);
        expect(emitted[0].ticket.id).toBe(12);
      } finally {
        eventBus.removeAllListeners();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // transitionEscalation
  // ---------------------------------------------------------------------------
  describe('transitionEscalation', () => {
    function mockEscalation(escalation) {
      db.query.mockImplementation((sql) => {
        if (sql.includes('SELECT * FROM `ticket_escalations`')) {
          return Promise.resolve([[escalation]]);
        }
        if (sql.startsWith('UPDATE')) {
          return Promise.resolve([{ affectedRows: 1 }]);
        }
        return Promise.resolve([[]]);
      });
    }

    test('allows open → acknowledged', async () => {
      mockEscalation({ id: 1, status: 'open' });
      await interactionService.transitionEscalation(1, null, { status: 'acknowledged' });
      const updateCall = db.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE'));
      expect(updateCall[0]).toContain('`acknowledged_at` = ?');
    });

    test('rejects resolved → acknowledged', async () => {
      mockEscalation({ id: 1, status: 'resolved' });
      await expect(interactionService.transitionEscalation(1, null, { status: 'acknowledged' }))
        .rejects.toThrow(ValidationError);
    });
  });

  // ---------------------------------------------------------------------------
  // processDueReminders
  // ---------------------------------------------------------------------------
  describe('processDueReminders', () => {
    test('notifies each due reminder once and stamps notified_at', async () => {
      const due = [
        { id: 1, organization_id: 42, client_id: 5, title: 'Call Jane', client_name: 'Jane', assignee_email: 'tech@x.com', due_at: '2026-06-01 10:00:00' },
        { id: 2, organization_id: 42, client_id: 6, title: 'Visit Bob', client_name: 'Bob', assignee_email: null, due_at: '2026-06-02 10:00:00' },
      ];
      db.query.mockImplementation((sql) => {
        if (sql.includes('FROM follow_up_reminders r')) {
          return Promise.resolve([due]);
        }
        return Promise.resolve([{ affectedRows: 1 }]);
      });

      const emitted = [];
      const listener = (payload) => emitted.push(payload);
      eventBus.on('followup.due', listener);
      try {
        const result = await interactionService.processDueReminders(42);
        expect(result.reminders_notified).toBe(2);
        expect(emitted).toHaveLength(2);
        const stampCalls = db.query.mock.calls.filter(([sql]) => sql.includes('SET notified_at = NOW()'));
        expect(stampCalls).toHaveLength(2);
      } finally {
        eventBus.removeAllListeners();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // dispatchTicketSurveys
  // ---------------------------------------------------------------------------
  describe('dispatchTicketSurveys', () => {
    test('creates and emits a CSAT survey per resolved ticket without one', async () => {
      const created = { id: 50, client_id: 5, ticket_id: 12, survey_type: 'csat', status: 'sent' };
      db.query.mockImplementation((sql) => {
        if (sql.includes('FROM tickets t')) {
          return Promise.resolve([[
            { id: 12, organization_id: 42, client_id: 5, subject: 'No internet', client_name: 'Jane', client_email: 'jane@x.com' },
          ]]);
        }
        if (sql.startsWith('INSERT')) {
          return Promise.resolve([{ insertId: 50 }]);
        }
        if (sql.includes('SELECT * FROM `satisfaction_surveys`')) {
          return Promise.resolve([[created]]);
        }
        return Promise.resolve([[]]);
      });

      const emitted = [];
      const listener = (payload) => emitted.push(payload);
      eventBus.on('survey.requested', listener);
      try {
        const result = await interactionService.dispatchTicketSurveys(42);
        expect(result.surveys_sent).toBe(1);
        expect(emitted).toHaveLength(1);
        expect(emitted[0].client.email).toBe('jane@x.com');
        expect(emitted[0].survey.survey_type).toBe('csat');
      } finally {
        eventBus.removeAllListeners();
      }
    });
  });
});
