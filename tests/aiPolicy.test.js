// =============================================================================
// FireISP 5.0 — AiPolicy Model Tests (P1 §9)
// =============================================================================
// Covers:
//   • findByOrgId — returns existing row or safe defaults when none exists
//   • upsert      — INSERT ON DUPLICATE KEY UPDATE semantics
//   • enabled_channels — JSON serialization on write
//   • no-op upsert when fields object is empty
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

const AiPolicy = require('../src/models/AiPolicy');

afterEach(() => jest.clearAllMocks());

// =============================================================================
// Static metadata
// =============================================================================

describe('AiPolicy — static metadata', () => {
  it('has the correct tableName', () => {
    expect(AiPolicy.tableName).toBe('ai_policies');
  });

  it('has hasOrgScope = true', () => {
    expect(AiPolicy.hasOrgScope).toBe(true);
  });

  it('lists all expected fillable columns', () => {
    const expected = [
      'organization_id', 'enabled', 'enabled_channels', 'mode',
      'auto_send_confidence', 'default_locale', 'tone',
      'redact_pii_before_llm', 'active_provider_id',
    ];
    expect(AiPolicy.fillable).toEqual(expect.arrayContaining(expected));
  });
});

// =============================================================================
// findByOrgId
// =============================================================================

describe('AiPolicy.findByOrgId', () => {
  it('returns the existing row when the org has a policy', async () => {
    const row = {
      id: 1,
      organization_id: 42,
      enabled: 1,
      enabled_channels: JSON.stringify({ portal: true, email: false, whatsapp: false, sms: false }),
      mode: 'suggest',
      auto_send_confidence: '0.90',
      default_locale: 'en',
      tone: 'neutral',
      redact_pii_before_llm: 1,
      active_provider_id: 7,
    };
    mockQuery.mockResolvedValueOnce([[row], []]);

    const result = await AiPolicy.findByOrgId(42);
    expect(result).toEqual(row);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ai_policies'),
      [42],
    );
  });

  it('returns safe defaults when no policy row exists for the org', async () => {
    mockQuery.mockResolvedValueOnce([[], []]);

    const result = await AiPolicy.findByOrgId(99);
    expect(result).toMatchObject({
      organization_id:     99,
      enabled:             0,
      mode:                'draft_only',
      default_locale:      'es-MX',
      tone:                'formal',
      redact_pii_before_llm: 1,
      active_provider_id:  null,
    });
    expect(result.enabled_channels).toMatchObject({ portal: false, email: false });
  });
});

// =============================================================================
// upsert
// =============================================================================

describe('AiPolicy.upsert', () => {
  it('executes INSERT … ON DUPLICATE KEY UPDATE with the supplied fields', async () => {
    // upsert issues one INSERT … ON DUPLICATE query then calls findByOrgId
    const updated = {
      id: 1, organization_id: 1, enabled: 1, mode: 'draft_only',
      enabled_channels: '{}', auto_send_confidence: '0.85',
      default_locale: 'es-MX', tone: 'formal', redact_pii_before_llm: 1,
      active_provider_id: null,
    };
    mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }, []]);  // the upsert
    mockQuery.mockResolvedValueOnce([[updated], []]);              // findByOrgId

    const result = await AiPolicy.upsert(1, { enabled: 1, tone: 'friendly' });

    // First call should be the INSERT ... ON DUPLICATE KEY UPDATE
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO.*ai_policies/i);
    expect(sql).toMatch(/ON DUPLICATE KEY UPDATE/i);
    expect(params).toContain(1); // orgId
    expect(result).toEqual(updated);
  });

  it('serializes enabled_channels object to JSON string', async () => {
    const channels = { portal: true, email: true, whatsapp: false, sms: false };
    const updatedRow = {
      id: 1, organization_id: 5, enabled: 1,
      enabled_channels: JSON.stringify(channels),
      mode: 'draft_only', auto_send_confidence: '0.85',
      default_locale: 'es-MX', tone: 'formal', redact_pii_before_llm: 1,
      active_provider_id: null,
    };
    mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockQuery.mockResolvedValueOnce([[updatedRow], []]);

    await AiPolicy.upsert(5, { enabled_channels: channels });

    const [, params] = mockQuery.mock.calls[0];
    // The serialized JSON string must appear in the params array
    expect(params).toContain(JSON.stringify(channels));
  });

  it('skips the INSERT and returns current policy when fields is empty', async () => {
    // When no allowed fields are provided, upsert just calls findByOrgId
    const existing = {
      id: 1, organization_id: 3, enabled: 0, mode: 'draft_only',
      enabled_channels: '{}', auto_send_confidence: '0.85',
      default_locale: 'es-MX', tone: 'formal', redact_pii_before_llm: 1,
      active_provider_id: null,
    };
    mockQuery.mockResolvedValueOnce([[existing], []]);

    const result = await AiPolicy.upsert(3, {});
    // Only one DB call (the findByOrgId), no INSERT
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(result).toEqual(existing);
  });

  it('ignores unknown / non-allowed fields', async () => {
    const updated = {
      id: 1, organization_id: 2, enabled: 1, mode: 'draft_only',
      enabled_channels: '{}', auto_send_confidence: '0.85',
      default_locale: 'es-MX', tone: 'formal', redact_pii_before_llm: 1,
      active_provider_id: null,
    };
    mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockQuery.mockResolvedValueOnce([[updated], []]);

    await AiPolicy.upsert(2, { enabled: 1, hacked_field: 'DROP TABLE' });

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('hacked_field');
  });

  it('does not include active_provider_id in INSERT when not supplied', async () => {
    const updated = {
      id: 1, organization_id: 4, enabled: 0, mode: 'draft_only',
      enabled_channels: '{}', auto_send_confidence: '0.85',
      default_locale: 'es-MX', tone: 'formal', redact_pii_before_llm: 1,
      active_provider_id: null,
    };
    mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockQuery.mockResolvedValueOnce([[updated], []]);

    await AiPolicy.upsert(4, { mode: 'suggest' });

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('mode');
    expect(sql).not.toContain('active_provider_id');
  });

  it('sets active_provider_id when explicitly supplied', async () => {
    const updated = {
      id: 1, organization_id: 6, enabled: 1, mode: 'suggest',
      enabled_channels: '{}', auto_send_confidence: '0.85',
      default_locale: 'es-MX', tone: 'formal', redact_pii_before_llm: 1,
      active_provider_id: 12,
    };
    mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockQuery.mockResolvedValueOnce([[updated], []]);

    await AiPolicy.upsert(6, { active_provider_id: 12 });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('active_provider_id');
    expect(params).toContain(12);
  });
});
