// =============================================================================
// FireISP 5.0 — Quota Service Tests (P2.4)
// =============================================================================

// ---------------------------------------------------------------------------
// Mock database
// ---------------------------------------------------------------------------
const mockQuery = jest.fn();

jest.mock('../src/config/database', () => ({
  query:         mockQuery,
  execute:       jest.fn(),
  getConnection: jest.fn(),
  close:         jest.fn(),
  pool:          { end: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the 4-element tuple that db.query returns for each Promise.all slot. */
function makeUsageRows({ clients = 0, devices = 0, tasks = 0, bytes = 0 } = {}) {
  // getUsage fires 4 parallel db.query calls; each returns [[row], fields]
  return [
    [[{ cnt: clients }], []],      // clients
    [[{ cnt: devices }], []],      // devices
    [[{ cnt: tasks }],   []],      // scheduled_tasks
    [[{ total_bytes: bytes }], []], // files / storage
  ];
}

/** Reset mock and pre-program responses for getUsage. */
function mockUsage({ clients = 0, devices = 0, tasks = 0, bytes = 0 } = {}) {
  const rows = makeUsageRows({ clients, devices, tasks, bytes });
  for (const row of rows) {
    mockQuery.mockResolvedValueOnce(row);
  }
}

const { getQuota, getUsage, getQuotaWithUsage, checkQuota } = require('../src/services/quotaService');
const OrganizationQuota = require('../src/models/OrganizationQuota');

// ---------------------------------------------------------------------------
// Tests — getQuota
// ---------------------------------------------------------------------------

describe('quotaService.getQuota', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns quota row when one exists', async () => {
    mockQuery.mockResolvedValueOnce([[{
      organization_id: 1, max_clients: 100, max_devices: 50,
      max_storage_mb: 2048, max_scheduled_tasks: 10,
    }], []]);
    const q = await getQuota(1);
    expect(q.max_clients).toBe(100);
    expect(q.max_devices).toBe(50);
  });

  it('returns all-null defaults when no row exists', async () => {
    mockQuery.mockResolvedValueOnce([[], []]);
    const q = await getQuota(99);
    expect(q.max_clients).toBeNull();
    expect(q.max_devices).toBeNull();
    expect(q.max_storage_mb).toBeNull();
    expect(q.max_scheduled_tasks).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests — getUsage
// ---------------------------------------------------------------------------

describe('quotaService.getUsage', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns correct counts from DB', async () => {
    mockUsage({ clients: 3, devices: 7, tasks: 2, bytes: 5 * 1024 * 1024 });
    const u = await getUsage(1);
    expect(u.clients).toBe(3);
    expect(u.devices).toBe(7);
    expect(u.scheduled_tasks).toBe(2);
    expect(u.storage_mb).toBe(5);
  });

  it('rounds storage_mb up (ceil)', async () => {
    mockUsage({ bytes: 1.5 * 1024 * 1024 });
    const u = await getUsage(1);
    expect(u.storage_mb).toBe(2);
  });

  it('returns 0 storage when no files exist', async () => {
    mockUsage({ bytes: 0 });
    const u = await getUsage(1);
    expect(u.storage_mb).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — getQuotaWithUsage
// ---------------------------------------------------------------------------

describe('quotaService.getQuotaWithUsage', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns combined limits and usage object', async () => {
    mockQuery.mockResolvedValueOnce([[{ organization_id: 1, max_clients: 50, max_devices: null, max_storage_mb: null, max_scheduled_tasks: null }], []]);
    mockUsage({ clients: 10, devices: 2 });
    const result = await getQuotaWithUsage(1);
    expect(result.limits.max_clients).toBe(50);
    expect(result.usage.clients).toBe(10);
    expect(result.usage.devices).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tests — checkQuota
// ---------------------------------------------------------------------------

describe('quotaService.checkQuota', () => {
  afterEach(() => jest.clearAllMocks());

  it('does not throw when under limit', async () => {
    // quota: max_clients = 10; current usage: 9
    mockQuery.mockResolvedValueOnce([[{ organization_id: 1, max_clients: 10, max_devices: null, max_storage_mb: null, max_scheduled_tasks: null }], []]);
    mockUsage({ clients: 9 });
    await expect(checkQuota(1, 'clients')).resolves.toBeUndefined();
  });

  it('throws ValidationError when exactly at limit (current === limit)', async () => {
    // current (10) >= limit (10) → quota exceeded
    mockQuery.mockResolvedValueOnce([[{ organization_id: 1, max_clients: 10, max_devices: null, max_storage_mb: null, max_scheduled_tasks: null }], []]);
    mockUsage({ clients: 10 });
    await expect(checkQuota(1, 'clients')).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringContaining('10 client'),
    });
  });

  it('throws ValidationError when over limit', async () => {
    mockQuery.mockResolvedValueOnce([[{ organization_id: 1, max_clients: 5, max_devices: null, max_storage_mb: null, max_scheduled_tasks: null }], []]);
    mockUsage({ clients: 7 });
    await expect(checkQuota(1, 'clients')).rejects.toMatchObject({ statusCode: 422 });
  });

  it('does not throw when limit is null (unlimited)', async () => {
    mockQuery.mockResolvedValueOnce([[{ organization_id: 1, max_clients: null, max_devices: null, max_storage_mb: null, max_scheduled_tasks: null }], []]);
    await expect(checkQuota(1, 'clients')).resolves.toBeUndefined();
  });

  it('does not throw when no quota row exists (unlimited)', async () => {
    mockQuery.mockResolvedValueOnce([[], []]);
    await expect(checkQuota(1, 'clients')).resolves.toBeUndefined();
  });

  it('enforces devices quota', async () => {
    mockQuery.mockResolvedValueOnce([[{ organization_id: 1, max_clients: null, max_devices: 3, max_storage_mb: null, max_scheduled_tasks: null }], []]);
    mockUsage({ devices: 3 });
    await expect(checkQuota(1, 'devices')).rejects.toMatchObject({ statusCode: 422 });
  });

  it('enforces scheduled_tasks quota', async () => {
    mockQuery.mockResolvedValueOnce([[{ organization_id: 1, max_clients: null, max_devices: null, max_storage_mb: null, max_scheduled_tasks: 5 }], []]);
    mockUsage({ tasks: 5 });
    await expect(checkQuota(1, 'scheduled_tasks')).rejects.toMatchObject({ statusCode: 422 });
  });

  it('enforces storage_mb quota', async () => {
    mockQuery.mockResolvedValueOnce([[{ organization_id: 1, max_clients: null, max_devices: null, max_storage_mb: 100, max_scheduled_tasks: null }], []]);
    mockUsage({ bytes: 105 * 1024 * 1024 });
    await expect(checkQuota(1, 'storage_mb')).rejects.toMatchObject({ statusCode: 422 });
  });
});

// ---------------------------------------------------------------------------
// Tests — OrganizationQuota.upsert
// ---------------------------------------------------------------------------

describe('OrganizationQuota.upsert', () => {
  afterEach(() => jest.clearAllMocks());

  it('executes INSERT … ON DUPLICATE KEY UPDATE', async () => {
    // upsert then findByOrgId
    mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockQuery.mockResolvedValueOnce([[{ organization_id: 1, max_clients: 50, max_devices: null, max_storage_mb: null, max_scheduled_tasks: null }], []]);
    const row = await OrganizationQuota.upsert(1, { max_clients: 50 });
    expect(row.max_clients).toBe(50);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO organization_quotas/i);
    expect(sql).toMatch(/ON DUPLICATE KEY UPDATE/i);
  });

  it('treats empty string as NULL', async () => {
    mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockQuery.mockResolvedValueOnce([[{ organization_id: 1, max_clients: null, max_devices: null, max_storage_mb: null, max_scheduled_tasks: null }], []]);
    await OrganizationQuota.upsert(1, { max_clients: '' });
    const [, params] = mockQuery.mock.calls[0];
    // params: [orgId, null (from ''), null (ON DUPLICATE side)]
    expect(params).toContain(null);
  });

  it('skips upsert and returns existing row when no valid fields provided', async () => {
    mockQuery.mockResolvedValueOnce([[{ organization_id: 1, max_clients: 10, max_devices: null, max_storage_mb: null, max_scheduled_tasks: null }], []]);
    const row = await OrganizationQuota.upsert(1, {});
    expect(mockQuery).toHaveBeenCalledTimes(1); // only the findByOrgId
    expect(row.max_clients).toBe(10);
  });
});
