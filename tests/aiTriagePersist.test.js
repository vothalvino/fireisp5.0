// =============================================================================
// FireISP 5.0 — ticket_ai_triage writer tests (aiReplyService._persistTriage)
// =============================================================================
// Migration 297 created ticket_ai_triage with a reader endpoint
// (GET /tickets/:id/ai-triage) but no writer; the writer now lives in
// aiReplyService as a best-effort upsert after classification.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
}));
jest.mock('../src/services/kbService', () => ({
  searchArticles: jest.fn(),
}));

const db = require('../src/config/database');
const kbService = require('../src/services/kbService');
const { _persistTriage } = require('../src/services/aiReplyService');

const BASE = {
  ticketId: 42,
  orgId: 1,
  classification: { category: 'connectivity', priority: 'high', language: 'es-MX', confidence: 0.9 },
  suggestedResolution: 'Reinicie su módem.',
  contextSnapshot: '{"topology":null,"health":null}',
  inboundText: 'no tengo internet',
  locale: 'es-MX',
};

describe('_persistTriage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue([{ affectedRows: 1 }]);
    kbService.searchArticles.mockResolvedValue([{ id: 3 }, { id: 8 }]);
  });

  test('upserts one row per ticket with KB article ids as a JSON array', async () => {
    await _persistTriage(BASE);

    expect(kbService.searchArticles).toHaveBeenCalledWith(1, 'no tengo internet', 'es-MX', 5);
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO ticket_ai_triage/);
    expect(sql).toMatch(/ON DUPLICATE KEY UPDATE/);
    expect(params).toEqual([
      42, 'connectivity', 'high', 'Reinicie su módem.',
      JSON.stringify([3, 8]), '{"topology":null,"health":null}',
    ]);
  });

  test("maps the classifier's 'urgent' to the table enum's 'critical'", async () => {
    await _persistTriage({ ...BASE, classification: { ...BASE.classification, priority: 'urgent' } });
    expect(db.query.mock.calls[0][1][2]).toBe('critical');
  });

  test('stores null priority for unknown classifier values', async () => {
    await _persistTriage({ ...BASE, classification: { ...BASE.classification, priority: 'bananas' } });
    expect(db.query.mock.calls[0][1][2]).toBeNull();
  });

  test('persists triage with empty KB list when KB search fails', async () => {
    kbService.searchArticles.mockRejectedValue(new Error('kb down'));
    await _persistTriage(BASE);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][1][4]).toBe('[]');
  });

  test('never throws when the upsert itself fails (best-effort)', async () => {
    db.query.mockRejectedValue(new Error('db down'));
    await expect(_persistTriage(BASE)).resolves.toBeUndefined();
  });
});
