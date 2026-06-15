'use strict';
// =============================================================================
// FireISP 5.0 — taskRunner SNMP/FTTH dispatch unit tests
// Covers migration-254 SNMP tasks and migration-269 FTTH tasks.
// =============================================================================

const mockQuery = jest.fn();
const mockSnmpPoll = jest.fn();
const mockTrapStop = jest.fn();
const mockTrapStart = jest.fn();
const mockLoggerWarn = jest.fn();

jest.mock('../src/config/database', () => ({
  query:         mockQuery,
  queryReplica:  jest.fn(),
  execute:       jest.fn(),
  getConnection: jest.fn(),
  close:         jest.fn(),
  pool:          { end: jest.fn() },
}));

jest.mock('../src/utils/logger', () => ({
  child: () => ({ warn: mockLoggerWarn, info: jest.fn(), error: jest.fn() }),
}));

// Services that taskRunner top-level imports
jest.mock('../src/services/billingService',         () => ({}));
jest.mock('../src/services/suspensionService',      () => ({}));
jest.mock('../src/services/radiusService',          () => ({}));
jest.mock('../src/services/snmpPoller',             () => ({ poll: mockSnmpPoll }));
jest.mock('../src/services/snmpTrapReceiver',       () => ({ stop: mockTrapStop, start: mockTrapStart }));
jest.mock('../src/services/emailTransport',         () => ({ processQueue: jest.fn(), sendEmail: jest.fn() }));
jest.mock('../src/services/smsTransport',           () => ({ processQueue: jest.fn() }));
jest.mock('../src/services/webhookService',         () => ({ processRetries: jest.fn() }));
jest.mock('../src/services/checkoutService',        () => ({}));
jest.mock('../src/services/alertService',           () => ({}));
jest.mock('../src/services/retentionService',       () => ({}));
jest.mock('../src/services/paymentRetryService',    () => ({}));
jest.mock('../src/services/configBackupService',    () => ({}));
jest.mock('../src/services/drDrillService',         () => ({}));
jest.mock('../src/services/interactionService',     () => ({}));
jest.mock('../src/services/campaignService',        () => ({ processQueue: jest.fn() }));
jest.mock('../src/services/lateFeeService',         () => ({}));
jest.mock('../src/services/paymentReminderService', () => ({}));
jest.mock('../src/services/automationService',      () => ({}));
jest.mock('../src/services/analyticsService',       () => ({}));
jest.mock('../src/views/emailTemplates',            () => ({}));
jest.mock('../src/scripts/backup',                  () => ({ backup: jest.fn() }));
jest.mock('../src/services/assetService',           () => ({ getLowStockItems: jest.fn() }));
jest.mock('../src/services/scheduledReportService', () => ({}));

const { runTask, runFtthOpticalMetricsCleanup } = require('../src/services/taskRunner');

afterEach(() => jest.clearAllMocks());

// =============================================================================
// §6.1 SNMP tasks (migration 254)
// =============================================================================

describe('taskRunner — snmp_discovery_poll (migration 254)', () => {
  it('delegates to snmpPoller.poll()', async () => {
    mockSnmpPoll.mockResolvedValueOnce({ polled: 3, errors: 0, total: 3 });

    const result = await runTask('snmp_discovery_poll');

    expect(mockSnmpPoll).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ polled: 3, errors: 0, total: 3 });
  });
});

describe('taskRunner — snmp_trap_receiver (migration 254)', () => {
  it('stops and starts the trap receiver', async () => {
    const result = await runTask('snmp_trap_receiver');

    expect(mockTrapStop).toHaveBeenCalledTimes(1);
    expect(mockTrapStart).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ message: 'SNMP trap receiver started' });
  });
});

// =============================================================================
// §7.1/§7.2 FTTH tasks (migration 269)
// =============================================================================

describe('taskRunner — ftth_olt_chassis_poll (migration 269)', () => {
  it('delegates to snmpPoller.poll() — OLT devices are generic SNMP devices', async () => {
    mockSnmpPoll.mockResolvedValueOnce({ polled: 2, errors: 0, total: 2 });

    const result = await runTask('ftth_olt_chassis_poll');

    expect(mockSnmpPoll).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ polled: 2, errors: 0, total: 2 });
  });
});

describe('taskRunner — ftth_olt_port_metrics_poll (migration 269, deferred)', () => {
  it('returns deferred result and logs a warning', async () => {
    const result = await runTask('ftth_olt_port_metrics_poll');

    expect(result).toMatchObject({ deferred: true });
    expect(result.message).toContain('ftth_olt_port_metrics_poll');
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ taskName: 'ftth_olt_port_metrics_poll' }),
      expect.stringContaining('oltPortMetricsPollHandler'),
    );
  });
});

describe('taskRunner — ftth_onu_discovery (migration 269, deferred)', () => {
  it('returns deferred result and logs a warning', async () => {
    const result = await runTask('ftth_onu_discovery');

    expect(result).toMatchObject({ deferred: true });
    expect(result.message).toContain('ftth_onu_discovery');
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ taskName: 'ftth_onu_discovery' }),
      expect.stringContaining('vendor'),
    );
  });
});

describe('taskRunner — ftth_onu_optical_poll (migration 269, deferred)', () => {
  it('returns deferred result and logs a warning', async () => {
    const result = await runTask('ftth_onu_optical_poll');

    expect(result).toMatchObject({ deferred: true });
    expect(result.message).toContain('ftth_onu_optical_poll');
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ taskName: 'ftth_onu_optical_poll' }),
      expect.stringContaining('onu_optical_metrics'),
    );
  });
});

describe('taskRunner — ftth_onu_firmware_job_processor (migration 269, deferred)', () => {
  it('returns deferred result and logs a warning', async () => {
    const result = await runTask('ftth_onu_firmware_job_processor');

    expect(result).toMatchObject({ deferred: true });
    expect(result.message).toContain('ftth_onu_firmware_job_processor');
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ taskName: 'ftth_onu_firmware_job_processor' }),
      expect.stringContaining('driver'),
    );
  });
});

describe('taskRunner — ftth_onu_optical_metrics_cleanup (migration 269)', () => {
  it('deletes old rows and returns deleted count', async () => {
    // Simulate two partial batches: first batch deletes 10000, second 0
    // (no row is BATCH_SIZE=10000 so loop exits immediately with one query)
    mockQuery
      .mockResolvedValueOnce([{ affectedRows: 42 }]);  // first batch — < 10000

    const result = await runTask('ftth_onu_optical_metrics_cleanup');

    expect(result).toEqual({ deleted: 42 });
    // BATCH_SIZE is now interpolated as a validated integer LITERAL into the SQL
    // ('LIMIT 10000') instead of being passed as a bound '?' placeholder, because
    // MySQL8 pool.execute() rejects bound LIMIT values. db.query is therefore
    // called with a SINGLE argument (the SQL string) and no params array.
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM onu_optical_metrics'),
    );
    const [sql, ...rest] = mockQuery.mock.calls[0];
    expect(sql).toContain('LIMIT 10000');
    expect(rest).toHaveLength(0);
  });

  it('loops until batch returns fewer than BATCH_SIZE rows', async () => {
    mockQuery
      .mockResolvedValueOnce([{ affectedRows: 10000 }])   // first full batch
      .mockResolvedValueOnce([{ affectedRows: 300 }]);     // second partial batch

    const result = await runFtthOpticalMetricsCleanup();

    expect(result).toEqual({ deleted: 10300 });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('returns deleted:0 when no rows are old enough', async () => {
    mockQuery.mockResolvedValueOnce([{ affectedRows: 0 }]);

    const result = await runTask('ftth_onu_optical_metrics_cleanup');

    expect(result).toEqual({ deleted: 0 });
  });
});
