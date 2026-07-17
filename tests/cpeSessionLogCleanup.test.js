'use strict';

// =============================================================================
// FireISP 5.0 — cpeSessionLogService.cleanupOldLogs unit tests
// =============================================================================
// Regression: the seeded cpe_session_log_cleanup task was dead until taskRunner
// wired it, so the first run faces the table's entire >90-day backlog. The
// delete must run in LIMITed batches, never as one unbounded statement.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');
const { cleanupOldLogs } = require('../src/services/cpeSessionLogService');

describe('cpeSessionLogService.cleanupOldLogs', () => {
  beforeEach(() => jest.resetAllMocks());

  test('deletes in LIMITed batches until a short batch signals the backlog is drained', async () => {
    db.query
      .mockResolvedValueOnce([{ affectedRows: 10000 }])
      .mockResolvedValueOnce([{ affectedRows: 10000 }])
      .mockResolvedValueOnce([{ affectedRows: 137 }]);

    const deleted = await cleanupOldLogs();
    expect(deleted).toBe(20137);
    expect(db.query).toHaveBeenCalledTimes(3);
    for (const [sql, params] of db.query.mock.calls) {
      expect(sql).toMatch(/LIMIT 10000/);
      expect(params).toEqual([90]);
    }
  });

  test('stops after one round when fewer rows than the batch size remain', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 12 }]);

    const deleted = await cleanupOldLogs(30);
    expect(deleted).toBe(12);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][1]).toEqual([30]);
  });
});
