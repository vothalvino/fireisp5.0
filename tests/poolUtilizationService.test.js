// =============================================================================
// FireISP 5.0 — Pool Utilization Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/services/eventBus', () => ({
  on: jest.fn(),
  emit: jest.fn(),
  removeAllListeners: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  child: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

const db = require('../src/config/database');
const eventBus = require('../src/services/eventBus');
const { checkAllPoolUtilization } = require('../src/services/poolUtilizationService');

// Helper: build a fake ip_pools row
function makePool(overrides = {}) {
  return Object.assign(
    {
      id: 1,
      organization_id: 1,
      ip_version: '4',
      network: '10.0.0.0/24',
      subnet_mask: null,
      default_prefix_len: null,
      last_alerted_threshold: null,
      status: 'active',
    },
    overrides,
  );
}

// Helper: set up db.query mocks for checkAllPoolUtilization.
//   call 1: SELECT ip_pools → pools array
//   per pool: SELECT COUNT → assigned count row
//   per pool (if threshold crossed): UPDATE ip_pools
function setupMocks(pools, assignedCounts, updateExpected = []) {
  // First call returns all pools
  db.query.mockResolvedValueOnce([pools]);
  // Subsequent calls alternate: COUNT query, optional UPDATE
  let updateIdx = 0;
  for (let i = 0; i < pools.length; i++) {
    db.query.mockResolvedValueOnce([[{ cnt: assignedCounts[i] }]]);
    if (updateExpected[i]) {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      updateIdx++;
    }
  }
}

beforeEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// checkAllPoolUtilization
// =============================================================================

describe('checkAllPoolUtilization', () => {
  // /24 has 254 usable addresses (10.0.0.1 – 10.0.0.254)

  test('0% used → no threshold event, last_alerted stays NULL', async () => {
    const pool = makePool({ last_alerted_threshold: null });
    setupMocks([pool], [0]); // 0 of 254 used

    const { checked } = await checkAllPoolUtilization();

    expect(checked).toBe(1);
    expect(eventBus.emit).not.toHaveBeenCalled();
    // No UPDATE should be issued
    const updateCalls = db.query.mock.calls.filter(c => c[0].includes('UPDATE'));
    expect(updateCalls).toHaveLength(0);
  });

  test('80% used + last_alerted NULL → emits threshold at 75, updates DB', async () => {
    // 80% of 254 ≈ 203 assigned
    const pool = makePool({ last_alerted_threshold: null });
    const assigned = Math.round(254 * 0.80); // 203
    setupMocks([pool], [assigned], [true]);

    await checkAllPoolUtilization();

    expect(eventBus.emit).toHaveBeenCalledWith('ip_pool.threshold', expect.objectContaining({
      threshold: 75,
    }));
    const updateCalls = db.query.mock.calls.filter(c => c[0].includes('UPDATE'));
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][1]).toEqual([75, pool.id]);
  });

  test('80% used + last_alerted already 75 → no duplicate event', async () => {
    const pool = makePool({ last_alerted_threshold: 75 });
    const assigned = Math.round(254 * 0.80);
    setupMocks([pool], [assigned]); // no UPDATE expected

    await checkAllPoolUtilization();

    expect(eventBus.emit).not.toHaveBeenCalled();
    const updateCalls = db.query.mock.calls.filter(c => c[0].includes('UPDATE'));
    expect(updateCalls).toHaveLength(0);
  });

  test('92% used + last_alerted was 75 → emits threshold at 90, updates DB', async () => {
    // 92% of 254 ≈ 234 assigned
    const pool = makePool({ last_alerted_threshold: 75 });
    const assigned = Math.round(254 * 0.92); // 234
    setupMocks([pool], [assigned], [true]);

    await checkAllPoolUtilization();

    expect(eventBus.emit).toHaveBeenCalledWith('ip_pool.threshold', expect.objectContaining({
      threshold: 90,
    }));
    const updateCalls = db.query.mock.calls.filter(c => c[0].includes('UPDATE'));
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][1]).toEqual([90, pool.id]);
  });

  test('92% used + last_alerted already 90 → no new event', async () => {
    const pool = makePool({ last_alerted_threshold: 90 });
    const assigned = Math.round(254 * 0.92);
    setupMocks([pool], [assigned]); // no UPDATE expected

    await checkAllPoolUtilization();

    expect(eventBus.emit).not.toHaveBeenCalled();
    const updateCalls = db.query.mock.calls.filter(c => c[0].includes('UPDATE'));
    expect(updateCalls).toHaveLength(0);
  });

  test('50% used + last_alerted was 75 → resets last_alerted_threshold to NULL', async () => {
    // 50% of 254 ≈ 127 assigned
    const pool = makePool({ last_alerted_threshold: 75 });
    const assigned = Math.round(254 * 0.50); // 127
    setupMocks([pool], [assigned], [true]);

    await checkAllPoolUtilization();

    // No threshold event — only a reset UPDATE
    expect(eventBus.emit).not.toHaveBeenCalled();
    const updateCalls = db.query.mock.calls.filter(c => c[0].includes('UPDATE'));
    expect(updateCalls).toHaveLength(1);
    // The reset UPDATE uses NULL
    expect(updateCalls[0][0]).toContain('NULL');
    expect(updateCalls[0][1]).toEqual([pool.id]);
  });

  test('returns checked count equal to number of pools', async () => {
    const pools = [
      makePool({ id: 1, last_alerted_threshold: null }),
      makePool({ id: 2, last_alerted_threshold: null }),
    ];
    db.query.mockResolvedValueOnce([pools]);
    // COUNT for each pool (0 assigned — no UPDATE needed)
    db.query.mockResolvedValueOnce([[{ cnt: 0 }]]);
    db.query.mockResolvedValueOnce([[{ cnt: 0 }]]);

    const { checked } = await checkAllPoolUtilization();
    expect(checked).toBe(2);
  });

  test('no active pools → checked = 0, no events', async () => {
    db.query.mockResolvedValueOnce([[]]); // empty pools

    const { checked } = await checkAllPoolUtilization();
    expect(checked).toBe(0);
    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  test('pool with usable=0 is skipped (no event, no update)', async () => {
    // A /32 pool has 0 usable addresses: broadcast - network - 1 = 0
    const pool = makePool({ network: '10.0.0.1/32', last_alerted_threshold: null });
    setupMocks([pool], [1]); // 1 assigned but usable=0 → skip

    await checkAllPoolUtilization();

    expect(eventBus.emit).not.toHaveBeenCalled();
    const updateCalls = db.query.mock.calls.filter(c => c[0].includes('UPDATE'));
    expect(updateCalls).toHaveLength(0);
  });
});
