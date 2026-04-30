// =============================================================================
// FireISP 5.0 — AiProvider Model Tests (P1 §9)
// =============================================================================
// Covers:
//   • Static metadata (tableName, fillable, hasOrgScope, softDelete)
//   • findById       — with and without org scope; soft-delete filter
//   • findByIdOrFail — throws NotFoundError when not found
//   • findAll        — org-scoped listing with enabled filter
//   • count          — aggregate count with org scope
//   • create         — only fillable columns written; returns inserted row
//   • update         — updates by id + org; respects soft-delete filter
//   • delete         — soft-delete sets deleted_at
//
// All DB calls are mocked; no live database is required.
// =============================================================================

// ---------------------------------------------------------------------------
// Database mock
// ---------------------------------------------------------------------------
const mockQuery = jest.fn();

jest.mock('../src/config/database', () => ({
  query:         mockQuery,
  queryReplica:  jest.fn(),
  execute:       jest.fn(),
  getConnection: jest.fn(),
  close:         jest.fn(),
  pool:          { end: jest.fn() },
}));

const AiProvider = require('../src/models/AiProvider');
const { NotFoundError } = require('../src/utils/errors');

afterEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------
const PROVIDER_ROW = {
  id:                 1,
  organization_id:    10,
  name:               'OpenAI prod',
  kind:               'openai',
  model:              'gpt-4o-mini',
  endpoint_url:       null,
  api_key_encrypted:  'enc:abc123',
  extra_config:       null,
  temperature:        '0.20',
  max_tokens:         800,
  timeout_ms:         20000,
  enabled:            1,
  priority:           100,
  deleted_at:         null,
};

// =============================================================================
// Static metadata
// =============================================================================

describe('AiProvider — static metadata', () => {
  it('has the correct tableName', () => {
    expect(AiProvider.tableName).toBe('ai_providers');
  });

  it('has hasOrgScope = true', () => {
    expect(AiProvider.hasOrgScope).toBe(true);
  });

  it('has softDelete = true', () => {
    expect(AiProvider.softDelete).toBe(true);
  });

  it('lists all expected fillable columns', () => {
    const expected = [
      'organization_id', 'name', 'kind', 'model',
      'endpoint_url', 'api_key_encrypted', 'extra_config',
      'temperature', 'max_tokens', 'timeout_ms', 'enabled', 'priority',
    ];
    expect(AiProvider.fillable).toEqual(expect.arrayContaining(expected));
  });
});

// =============================================================================
// findById
// =============================================================================

describe('AiProvider.findById', () => {
  it('returns the provider row when found', async () => {
    mockQuery.mockResolvedValueOnce([[PROVIDER_ROW], []]);

    const result = await AiProvider.findById(1, 10);
    expect(result).toEqual(PROVIDER_ROW);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('deleted_at IS NULL'),
      expect.arrayContaining([1, 10]),
    );
  });

  it('returns null when not found', async () => {
    mockQuery.mockResolvedValueOnce([[], []]);

    const result = await AiProvider.findById(999, 10);
    expect(result).toBeNull();
  });

  it('includes deleted_at IS NULL in query (soft-delete filter)', async () => {
    mockQuery.mockResolvedValueOnce([[PROVIDER_ROW], []]);
    await AiProvider.findById(1, 10);

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('deleted_at IS NULL');
  });

  it('includes organization_id scope when orgId is provided', async () => {
    mockQuery.mockResolvedValueOnce([[PROVIDER_ROW], []]);
    await AiProvider.findById(1, 10);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('organization_id');
    expect(params).toContain(10);
  });
});

// =============================================================================
// findByIdOrFail
// =============================================================================

describe('AiProvider.findByIdOrFail', () => {
  it('returns the row when found', async () => {
    mockQuery.mockResolvedValueOnce([[PROVIDER_ROW], []]);

    const result = await AiProvider.findByIdOrFail(1, 10);
    expect(result).toEqual(PROVIDER_ROW);
  });

  it('throws NotFoundError when provider does not exist', async () => {
    mockQuery.mockResolvedValueOnce([[], []]);

    await expect(AiProvider.findByIdOrFail(999, 10)).rejects.toBeInstanceOf(NotFoundError);
  });
});

// =============================================================================
// findAll
// =============================================================================

describe('AiProvider.findAll', () => {
  it('returns all enabled providers for an org', async () => {
    mockQuery.mockResolvedValueOnce([[PROVIDER_ROW], []]);

    const rows = await AiProvider.findAll({ where: { enabled: 1 }, orgId: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(PROVIDER_ROW);
  });

  it('scopes query to organization_id', async () => {
    mockQuery.mockResolvedValueOnce([[], []]);

    await AiProvider.findAll({ orgId: 10 });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('organization_id');
    expect(params).toContain(10);
  });

  it('excludes soft-deleted rows by default', async () => {
    mockQuery.mockResolvedValueOnce([[], []]);

    await AiProvider.findAll({ orgId: 10 });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('deleted_at IS NULL');
  });

  it('returns empty array when no providers exist', async () => {
    mockQuery.mockResolvedValueOnce([[], []]);

    const rows = await AiProvider.findAll({ orgId: 10 });
    expect(rows).toEqual([]);
  });
});

// =============================================================================
// count
// =============================================================================

describe('AiProvider.count', () => {
  it('returns the aggregate count for an org', async () => {
    mockQuery.mockResolvedValueOnce([[{ total: 3 }], []]);

    const total = await AiProvider.count({ orgId: 10 });
    expect(total).toBe(3);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/COUNT/i);
  });

  it('returns 0 when no providers exist', async () => {
    mockQuery.mockResolvedValueOnce([[{ total: 0 }], []]);

    expect(await AiProvider.count({ orgId: 99 })).toBe(0);
  });
});

// =============================================================================
// create
// =============================================================================

describe('AiProvider.create', () => {
  it('inserts a new provider and returns the created row', async () => {
    mockQuery.mockResolvedValueOnce([{ insertId: 5 }, []]);  // INSERT
    mockQuery.mockResolvedValueOnce([[{ ...PROVIDER_ROW, id: 5 }], []]);  // findByIdIncludingDeleted

    const result = await AiProvider.create({
      organization_id:   10,
      name:              'OpenAI prod',
      kind:              'openai',
      model:             'gpt-4o-mini',
      api_key_encrypted: 'enc:abc123',
      temperature:       0.2,
      max_tokens:        800,
      timeout_ms:        20000,
      enabled:           1,
      priority:          100,
    });

    expect(result.id).toBe(5);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO.*ai_providers/i);
  });

  it('only inserts fillable columns — ignores unknown fields', async () => {
    mockQuery.mockResolvedValueOnce([{ insertId: 6 }, []]);
    mockQuery.mockResolvedValueOnce([[{ ...PROVIDER_ROW, id: 6 }], []]);

    await AiProvider.create({
      organization_id: 10,
      name: 'Test',
      kind: 'ollama',
      model: 'llama3.1:8b',
      enabled: 1,
      priority: 50,
      hacked_column: 'DROP TABLE',  // must be ignored
    });

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('hacked_column');
    expect(sql).toContain('name');
    expect(sql).toContain('kind');
  });
});

// =============================================================================
// update
// =============================================================================

describe('AiProvider.update', () => {
  it('updates allowed fields and returns the refreshed row', async () => {
    const updated = { ...PROVIDER_ROW, model: 'gpt-4o' };
    mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }, []]);  // UPDATE
    mockQuery.mockResolvedValueOnce([[updated], []]);              // findById

    const result = await AiProvider.update(1, { model: 'gpt-4o' }, 10);
    expect(result.model).toBe('gpt-4o');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE.*ai_providers/i);
    expect(sql).toContain('deleted_at IS NULL');
    expect(params).toContain('gpt-4o');
    expect(params).toContain(10);
  });

  it('throws NotFoundError when no row is updated (wrong org or not found)', async () => {
    mockQuery.mockResolvedValueOnce([{ affectedRows: 0 }, []]);

    await expect(AiProvider.update(999, { model: 'x' }, 10)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns the unchanged row when no fillable fields are provided', async () => {
    // update with zero valid fields calls findByIdOrFail
    mockQuery.mockResolvedValueOnce([[], []]);

    await expect(AiProvider.update(999, { bad_col: 'x' }, 10)).rejects.toBeInstanceOf(NotFoundError);
  });
});

// =============================================================================
// delete (soft-delete)
// =============================================================================

describe('AiProvider.delete', () => {
  it('soft-deletes the row by setting deleted_at', async () => {
    mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    const result = await AiProvider.delete(1, 10);
    expect(result).toBe(true);

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('deleted_at');
  });

  it('throws NotFoundError when the row does not exist or wrong org', async () => {
    mockQuery.mockResolvedValueOnce([{ affectedRows: 0 }, []]);

    await expect(AiProvider.delete(999, 10)).rejects.toBeInstanceOf(NotFoundError);
  });
});
