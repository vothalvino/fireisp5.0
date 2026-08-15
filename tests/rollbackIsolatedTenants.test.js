const PRIMARY_DATABASE = 'fireisp_primary_test';
const ISOLATED_DATABASE = 'fireisp_isolated_test';

const PRIMARY_ROWS = [
  { id: 9, filename: '455_pppoe_diagnostics_telemetry.sql' },
  { id: 10, filename: '456_nas_maintenance_mode.sql' },
];
const ISOLATED_ROWS = [
  { id: 6, filename: '455_pppoe_diagnostics_telemetry.sql' },
  { id: 7, filename: '456_nas_maintenance_mode.sql' },
];

function makeConnection(appliedRows = []) {
  return {
    execute: jest.fn(async sql => {
      if (/SELECT id, filename FROM schema_migrations/.test(sql)) return [appliedRows];
      return [{ affectedRows: 1 }];
    }),
    query: jest.fn().mockResolvedValue([[]]),
    release: jest.fn(),
  };
}

function setupRunner({
  primaryRows = PRIMARY_ROWS,
  isolatedRows = ISOLATED_ROWS,
  isolatedPlanError = null,
  primaryExecutionError = null,
} = {}) {
  jest.resetModules();

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const db = {
    baseConnectionConfig: { database: PRIMARY_DATABASE },
    close: jest.fn().mockResolvedValue(undefined),
  };
  const listIsolatedMigrationTargets = jest.fn().mockResolvedValue([{
    organizationId: 27,
    database: ISOLATED_DATABASE,
    connectionConfig: { database: ISOLATED_DATABASE },
  }]);

  const connections = {
    primaryPlan: makeConnection(primaryRows),
    isolatedPlan: isolatedPlanError
      ? null
      : makeConnection(isolatedRows),
    primaryExecute: makeConnection(),
    isolatedExecute: makeConnection(),
  };
  if (primaryExecutionError) {
    connections.primaryExecute.query.mockRejectedValue(primaryExecutionError);
  }

  const pools = [];
  const perDatabaseCalls = new Map();
  const createPool = jest.fn(config => {
    const call = perDatabaseCalls.get(config.database) || 0;
    perDatabaseCalls.set(config.database, call + 1);

    let connection;
    let connectionError = null;
    if (config.database === PRIMARY_DATABASE) {
      connection = call === 0 ? connections.primaryPlan : connections.primaryExecute;
    } else {
      connection = call === 0 ? connections.isolatedPlan : connections.isolatedExecute;
      if (call === 0) connectionError = isolatedPlanError;
    }

    const pool = {
      database: config.database,
      getConnection: connectionError
        ? jest.fn().mockRejectedValue(connectionError)
        : jest.fn().mockResolvedValue(connection),
      end: jest.fn().mockResolvedValue(undefined),
    };
    pools.push(pool);
    return pool;
  });

  jest.doMock('mysql2/promise', () => ({ createPool }));
  jest.doMock('../src/config/database', () => db);
  jest.doMock('../src/services/tenantDatabaseService', () => ({
    listIsolatedMigrationTargets,
  }));
  jest.doMock('../src/utils/logger', () => ({
    child: jest.fn(() => logger),
  }));

  return {
    rollback: require('../src/scripts/rollback'),
    createPool,
    db,
    listIsolatedMigrationTargets,
    logger,
    connections,
    pools,
  };
}

function deletedMigrations(connection) {
  return connection.execute.mock.calls
    .filter(([sql]) => /DELETE FROM schema_migrations/.test(sql))
    .map(([, params]) => params[0]);
}

describe('rollback runner — isolated tenant databases', () => {
  const originalIsolatedFlag = process.env.MIGRATE_ISOLATED_TENANTS;

  beforeEach(() => {
    process.env.MIGRATE_ISOLATED_TENANTS = 'true';
  });

  afterEach(() => {
    if (originalIsolatedFlag === undefined) {
      delete process.env.MIGRATE_ISOLATED_TENANTS;
    } else {
      process.env.MIGRATE_ISOLATED_TENANTS = originalIsolatedFlag;
    }
    jest.restoreAllMocks();
  });

  test('executes matching step targets on every database newest-first', async () => {
    const context = setupRunner();

    await context.rollback.runRollback({ step: 2, to: null, dryRun: false });

    expect(context.listIsolatedMigrationTargets).toHaveBeenCalledTimes(1);
    expect(deletedMigrations(context.connections.primaryExecute)).toEqual([
      '456_nas_maintenance_mode.sql',
      '455_pppoe_diagnostics_telemetry.sql',
    ]);
    expect(deletedMigrations(context.connections.isolatedExecute)).toEqual([
      '456_nas_maintenance_mode.sql',
      '455_pppoe_diagnostics_telemetry.sql',
    ]);
    expect(context.createPool).toHaveBeenCalledTimes(4);
    expect(context.pools.every(pool => pool.end.mock.calls.length === 1)).toBe(true);
    expect(context.db.close).toHaveBeenCalledTimes(1);
    expect(context.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ databaseCount: 2, migrationCount: 4 }),
      expect.stringContaining('DESTRUCTIVE OPERATION'),
    );
  });

  test('step mode fails before execution when database histories resolve different targets', async () => {
    const context = setupRunner({
      isolatedRows: [
        { id: 4, filename: '453_notification_resolution_state.sql' },
        { id: 6, filename: '455_pppoe_diagnostics_telemetry.sql' },
      ],
    });

    await expect(
      context.rollback.runRollback({ step: 1, to: null, dryRun: true }),
    ).rejects.toThrow(/targets differ across databases/i);

    expect(context.createPool).toHaveBeenCalledTimes(2);
    expect(context.connections.primaryPlan.query).not.toHaveBeenCalled();
    expect(context.connections.isolatedPlan.query).not.toHaveBeenCalled();
    expect(context.connections.primaryExecute.execute).not.toHaveBeenCalled();
    expect(context.connections.isolatedExecute.execute).not.toHaveBeenCalled();
    expect(context.db.close).toHaveBeenCalledTimes(1);
  });

  test('dry-run preflights all histories but executes no rollback SQL or deletes', async () => {
    const context = setupRunner();

    await context.rollback.runRollback({ step: 1, to: null, dryRun: true });

    expect(context.createPool).toHaveBeenCalledTimes(2);
    expect(context.connections.primaryPlan.query).not.toHaveBeenCalled();
    expect(context.connections.isolatedPlan.query).not.toHaveBeenCalled();
    expect(deletedMigrations(context.connections.primaryPlan)).toEqual([]);
    expect(deletedMigrations(context.connections.isolatedPlan)).toEqual([]);
    expect(context.connections.primaryExecute.execute).not.toHaveBeenCalled();
    expect(context.connections.isolatedExecute.execute).not.toHaveBeenCalled();
    expect(context.db.close).toHaveBeenCalledTimes(1);
    expect(context.logger.info).toHaveBeenCalledWith(
      'Dry-run mode — no changes will be made.',
    );
  });

  test('an isolated preflight failure prevents changes to the primary database', async () => {
    const preflightError = new Error('isolated database unavailable');
    const context = setupRunner({ isolatedPlanError: preflightError });

    await expect(
      context.rollback.runRollback({ step: 1, to: null, dryRun: false }),
    ).rejects.toBe(preflightError);

    expect(context.createPool).toHaveBeenCalledTimes(2);
    expect(context.connections.primaryPlan.query).not.toHaveBeenCalled();
    expect(deletedMigrations(context.connections.primaryPlan)).toEqual([]);
    expect(context.connections.primaryExecute.execute).not.toHaveBeenCalled();
    expect(context.pools.every(pool => pool.end.mock.calls.length === 1)).toBe(true);
    expect(context.db.close).toHaveBeenCalledTimes(1);
    expect(context.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: preflightError, target: 'org:27:fireisp_isolated_test' }),
      'Rollback preflight failed; no changes were made',
    );
  });

  test('an execution failure closes resources and leaves later databases untouched', async () => {
    const executionError = new Error('primary DDL failed');
    const context = setupRunner({ primaryExecutionError: executionError });

    await expect(
      context.rollback.runRollback({ step: 1, to: null, dryRun: false }),
    ).rejects.toBe(executionError);

    // Two preflight pools plus the failed primary execution pool. No isolated
    // execution pool is opened after the primary failure.
    expect(context.createPool).toHaveBeenCalledTimes(3);
    expect(context.connections.isolatedExecute.query).not.toHaveBeenCalled();
    expect(context.connections.isolatedExecute.execute).not.toHaveBeenCalled();
    expect(context.pools.every(pool => pool.end.mock.calls.length === 1)).toBe(true);
    expect(context.db.close).toHaveBeenCalledTimes(1);
    expect(context.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: executionError, target: PRIMARY_DATABASE, completed: 0 }),
      'Rollback run stopped; remaining databases were not changed',
    );
  });
});
