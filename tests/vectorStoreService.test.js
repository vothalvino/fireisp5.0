// =============================================================================
// FireISP 5.0 — §8 vectorStoreService Tests
// =============================================================================

jest.mock('../src/utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadService() {
  // Re-require to pick up current env
  jest.isolateModules(() => {});
  return require('../src/services/vectorStoreService');
}

// =============================================================================
// 1. Disabled (VECTOR_RETRIEVAL_ENABLED not set)
// =============================================================================

describe('vectorStoreService — disabled (VECTOR_RETRIEVAL_ENABLED not set)', () => {
  let svc;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.VECTOR_RETRIEVAL_ENABLED;
    svc = require('../src/services/vectorStoreService');
    // Clear cache between tests
    svc._clearCacheForTesting();
  });

  afterEach(() => {
    delete process.env.VECTOR_RETRIEVAL_ENABLED;
  });

  it('isEnabled() returns false', () => {
    expect(svc.isEnabled()).toBe(false);
  });

  it('ensureCollection() returns null', async () => {
    const result = await svc.ensureCollection('test-col');
    expect(result).toBeNull();
  });

  it('upsertDocuments() resolves without error', async () => {
    await expect(
      svc.upsertDocuments({ collection: 'test-col', ids: ['a'], embeddings: [[0.1]], documents: ['text'], metadatas: [{}] }),
    ).resolves.toBeUndefined();
  });

  it('queryDocuments() returns empty arrays', async () => {
    const result = await svc.queryDocuments({ collection: 'test-col', queryEmbedding: [0.1, 0.2] });
    expect(result).toEqual({ ids: [], documents: [], metadatas: [], distances: [] });
  });

  it('deleteDocuments() resolves without error', async () => {
    await expect(
      svc.deleteDocuments({ collection: 'test-col', ids: ['a'] }),
    ).resolves.toBeUndefined();
  });
});

// =============================================================================
// 2. Enabled (VECTOR_RETRIEVAL_ENABLED='true') — mock fetch
// =============================================================================

describe('vectorStoreService — enabled (VECTOR_RETRIEVAL_ENABLED=true)', () => {
  let svc;
  let mockFetch;

  beforeEach(() => {
    jest.resetModules();
    process.env.VECTOR_RETRIEVAL_ENABLED = 'true';
    process.env.CHROMA_URL = 'http://chroma-test:8000';

    mockFetch = jest.fn();
    global.fetch = mockFetch;

    svc = require('../src/services/vectorStoreService');
    svc._clearCacheForTesting();
  });

  afterEach(() => {
    delete process.env.VECTOR_RETRIEVAL_ENABLED;
    delete process.env.CHROMA_URL;
  });

  function makeOkResponse(body) {
    return {
      ok: true,
      text: jest.fn().mockResolvedValue(JSON.stringify(body)),
    };
  }

  function makeErrorResponse(status, body = '') {
    return {
      ok: false,
      status,
      text: jest.fn().mockResolvedValue(body),
    };
  }

  it('isEnabled() returns true', () => {
    expect(svc.isEnabled()).toBe(true);
  });

  it('ensureCollection() calls POST /api/v1/collections and caches the ID', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ id: 'col-abc', name: 'my-collection' }));

    const id = await svc.ensureCollection('my-collection');

    expect(id).toBe('col-abc');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://chroma-test:8000/api/v1/collections',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('ensureCollection() called twice for same name only calls fetch once (caching)', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ id: 'col-xyz', name: 'cached-col' }));

    const id1 = await svc.ensureCollection('cached-col');
    const id2 = await svc.ensureCollection('cached-col');

    expect(id1).toBe('col-xyz');
    expect(id2).toBe('col-xyz');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('ensureCollection() falls back to GET when POST fails', async () => {
    // First call (POST) fails
    mockFetch.mockResolvedValueOnce(makeErrorResponse(409, 'already exists'));
    // Second call (GET) succeeds
    mockFetch.mockResolvedValueOnce(makeOkResponse({ id: 'col-existing', name: 'existing-col' }));

    const id = await svc.ensureCollection('existing-col');
    expect(id).toBe('col-existing');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('upsertDocuments() calls POST .../upsert', async () => {
    // ensureCollection
    mockFetch.mockResolvedValueOnce(makeOkResponse({ id: 'col-1', name: 'phrases_1_en' }));
    // upsert
    mockFetch.mockResolvedValueOnce(makeOkResponse({}));

    await svc.upsertDocuments({
      collection: 'phrases_1_en',
      ids: ['p_1'],
      embeddings: [[0.1, 0.2]],
      documents: ['Hello'],
      metadatas: [{ locale: 'en' }],
    });

    const upsertCall = mockFetch.mock.calls[1];
    expect(upsertCall[0]).toContain('/upsert');
    expect(upsertCall[1].method).toBe('POST');
  });

  it('queryDocuments() calls POST .../query and returns documents', async () => {
    // ensureCollection
    mockFetch.mockResolvedValueOnce(makeOkResponse({ id: 'col-q', name: 'phrases_1_en' }));
    // query
    mockFetch.mockResolvedValueOnce(makeOkResponse({
      ids: [['p_1', 'p_2']],
      documents: [['Hello world', 'Goodbye']],
      metadatas: [[{ locale: 'en' }, { locale: 'en' }]],
      distances: [[0.1, 0.2]],
    }));

    const result = await svc.queryDocuments({
      collection: 'phrases_1_en',
      queryEmbedding: [0.5, 0.5],
      k: 2,
    });

    expect(result.documents).toEqual(['Hello world', 'Goodbye']);
    expect(result.ids).toEqual(['p_1', 'p_2']);
    expect(result.distances).toEqual([0.1, 0.2]);

    const queryCall = mockFetch.mock.calls[1];
    expect(queryCall[0]).toContain('/query');
  });

  it('deleteDocuments() calls POST .../delete', async () => {
    // ensureCollection
    mockFetch.mockResolvedValueOnce(makeOkResponse({ id: 'col-d', name: 'phrases_1_en' }));
    // delete — returns no body
    mockFetch.mockResolvedValueOnce({ ok: true, text: jest.fn().mockResolvedValue('') });

    await svc.deleteDocuments({ collection: 'phrases_1_en', ids: ['p_1'] });

    const deleteCall = mockFetch.mock.calls[1];
    expect(deleteCall[0]).toContain('/delete');
    expect(deleteCall[1].method).toBe('POST');
  });

  it('throws when fetch returns non-2xx', async () => {
    // POST fails AND the GET fallback also fails
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(500, 'Internal error'))
      .mockResolvedValueOnce(makeErrorResponse(500, 'Internal error'));

    await expect(svc.ensureCollection('bad-col')).rejects.toThrow('HTTP 500');
  });
});
