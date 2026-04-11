// =============================================================================
// FireISP 5.0 — Scheduler Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('node-cron', () => ({
  validate: jest.fn(),
  schedule: jest.fn(),
}));

jest.mock('../src/services/taskRunner', () => ({
  runTask: jest.fn(),
  markTaskRun: jest.fn(),
}));

const db = require('../src/config/database');
const cron = require('node-cron');
const scheduler = require('../src/services/scheduler');

describe('Scheduler Service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('start()', () => {
    test('loads enabled tasks and schedules them', async () => {
      db.query.mockResolvedValueOnce([[
        { id: 1, task_name: 'auto_generate_invoices', cron_expression: '0 2 * * *', organization_id: 1 },
      ]]);
      cron.validate.mockReturnValue(true);
      cron.schedule.mockReturnValue({ stop: jest.fn() });

      await scheduler.start();

      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('is_enabled = 1'));
      expect(cron.schedule).toHaveBeenCalledTimes(1);
    });

    test('skips tasks with invalid cron expressions', async () => {
      db.query.mockResolvedValueOnce([[
        { id: 1, task_name: 'bad_task', cron_expression: 'bad', organization_id: null },
      ]]);
      cron.validate.mockReturnValue(false);

      await scheduler.start();
      expect(cron.schedule).not.toHaveBeenCalled();
    });

    test('handles empty task list', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await scheduler.start();
      expect(cron.schedule).not.toHaveBeenCalled();
    });
  });

  describe('stop()', () => {
    test('stops all scheduled jobs', async () => {
      const mockStop = jest.fn();
      db.query.mockResolvedValueOnce([[
        { id: 1, task_name: 'test_task', cron_expression: '* * * * *', organization_id: null },
      ]]);
      cron.validate.mockReturnValue(true);
      cron.schedule.mockReturnValue({ stop: mockStop });

      await scheduler.start();
      scheduler.stop();

      expect(mockStop).toHaveBeenCalled();
    });
  });

  describe('getStatus()', () => {
    test('returns status of registered jobs', async () => {
      db.query.mockResolvedValueOnce([[
        { id: 1, task_name: 'task_a', cron_expression: '0 1 * * *', organization_id: null },
        { id: 2, task_name: 'task_b', cron_expression: '0 2 * * *', organization_id: null },
      ]]);
      cron.validate.mockReturnValue(true);
      cron.schedule.mockReturnValue({ stop: jest.fn() });

      await scheduler.start();
      const status = scheduler.getStatus();

      expect(status).toEqual(expect.arrayContaining([
        expect.objectContaining({ task_name: 'task_a' }),
        expect.objectContaining({ task_name: 'task_b' }),
      ]));
      scheduler.stop();
    });
  });
});
