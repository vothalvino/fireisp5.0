'use strict';
// =============================================================================
// FireISP 5.0 — taskRunner sla_breach_check unit tests
// =============================================================================

const mockQuery = jest.fn();

jest.mock('../src/config/database', () => ({
  query:         mockQuery,
  queryReplica:  jest.fn(),
  execute:       jest.fn(),
  getConnection: jest.fn(),
  close:         jest.fn(),
  pool:          { end: jest.fn() },
}));

// Mock all services that taskRunner imports so they don't crash on require
jest.mock('../src/services/billingService',       () => ({}));
jest.mock('../src/services/suspensionService',    () => ({}));
jest.mock('../src/services/radiusService',        () => ({}));
jest.mock('../src/services/snmpPoller',           () => ({}));
jest.mock('../src/services/snmpTrapReceiver',     () => ({ stop: jest.fn(), start: jest.fn() }));
jest.mock('../src/services/emailTransport',       () => ({ processQueue: jest.fn(), sendEmail: jest.fn() }));
jest.mock('../src/services/smsTransport',         () => ({ processQueue: jest.fn() }));
jest.mock('../src/services/webhookService',       () => ({ processRetries: jest.fn() }));
jest.mock('../src/services/checkoutService',      () => ({}));
jest.mock('../src/services/alertService',         () => ({}));
jest.mock('../src/services/retentionService',     () => ({}));
jest.mock('../src/services/paymentRetryService',  () => ({}));
jest.mock('../src/services/configBackupService',  () => ({}));
jest.mock('../src/services/drDrillService',       () => ({}));
jest.mock('../src/services/interactionService',   () => ({}));
jest.mock('../src/services/campaignService',      () => ({ processQueue: jest.fn() }));
jest.mock('../src/services/lateFeeService',       () => ({}));
jest.mock('../src/services/paymentReminderService', () => ({}));
jest.mock('../src/views/emailTemplates',          () => ({}));
jest.mock('../src/scripts/backup',               () => ({ backup: jest.fn() }));
jest.mock('../src/utils/logger',                  () => ({ child: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }) }));

const { runTask } = require('../src/services/taskRunner');

afterEach(() => jest.clearAllMocks());

describe('taskRunner — sla_breach_check', () => {
  it('marks overdue open SLA events as breached and returns counts', async () => {
    mockQuery
      .mockResolvedValueOnce([[
        { id: 1, ticket_id: 10, organization_id: 1 },
        { id: 2, ticket_id: 11, organization_id: 1 },
      ]])
      .mockResolvedValue([{ affectedRows: 1 }]);

    const result = await runTask('sla_breach_check', 1);

    expect(result.checked).toBe(2);
    expect(result.breached).toBe(2);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ticket_sla_events SET is_breached = 1'),
      expect.any(Array),
    );
  });

  it('returns zero when no events need breaching', async () => {
    mockQuery.mockResolvedValueOnce([[]]);

    const result = await runTask('sla_breach_check', 1);

    expect(result.checked).toBe(0);
    expect(result.breached).toBe(0);
  });

  it('includes org filter when organizationId is provided', async () => {
    mockQuery.mockResolvedValueOnce([[]]);

    await runTask('sla_breach_check', 42);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('t.organization_id = ?'),
      [42],
    );
  });

  it('omits org filter when organizationId is null', async () => {
    mockQuery.mockResolvedValueOnce([[]]);

    await runTask('sla_breach_check', null);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.not.stringContaining('t.organization_id = ?'),
      [],
    );
  });
});
