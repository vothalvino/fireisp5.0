// =============================================================================
// FireISP 5.0 — §8 phraseLibraryService.search() Tests
// =============================================================================

jest.mock('../src/utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockIsEnabled     = jest.fn();
const mockQueryDocs     = jest.fn();
const mockFindByOrgId   = jest.fn();
const mockEmbed         = jest.fn();

jest.mock('../src/services/vectorStoreService', () => ({
  isEnabled:            mockIsEnabled,
  ensureCollection:     jest.fn().mockResolvedValue('col-id'),
  upsertDocuments:      jest.fn().mockResolvedValue(undefined),
  phraseCollectionName: (orgId, locale) => `phrases_${orgId}_${locale.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
  queryDocuments:       mockQueryDocs,
  deleteDocuments:      jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/models/AiPolicy', () => ({ findByOrgId: mockFindByOrgId }));

jest.mock('../src/services/llmProviderService', () => ({ embed: mockEmbed }));

// Models referenced by phraseLibraryService at the top level
jest.mock('../src/models/AiPhrase', () => ({
  findAll: jest.fn().mockResolvedValue([]),
  findById: jest.fn().mockResolvedValue(null),
  count: jest.fn().mockResolvedValue(0),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  findByIdOrFail: jest.fn(),
}));

jest.mock('../src/models/AiForbiddenTerm', () => ({
  findAll: jest.fn().mockResolvedValue([]),
  findById: jest.fn().mockResolvedValue(null),
  count: jest.fn().mockResolvedValue(0),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  findByIdOrFail: jest.fn(),
}));

jest.mock('../src/utils/errors', () => ({
  NotFoundError:   class extends Error {},
  ValidationError: class extends Error {},
}));

// ---------------------------------------------------------------------------

describe('phraseLibraryService.search()', () => {
  let search;

  beforeEach(() => {
    jest.clearAllMocks();
    search = require('../src/services/phraseLibraryService').search;
  });

  afterEach(() => {
    delete process.env.VECTOR_RETRIEVAL_ENABLED;
  });

  it('returns [] when VECTOR_RETRIEVAL_ENABLED is not set', async () => {
    mockIsEnabled.mockReturnValue(false);
    const result = await search(1, 'es-MX', 'internet down');
    expect(result).toEqual([]);
  });

  it('returns [] when policy has no active_provider_id', async () => {
    mockIsEnabled.mockReturnValue(true);
    mockFindByOrgId.mockResolvedValue({ active_provider_id: null });

    const result = await search(1, 'es-MX', 'internet down');
    expect(result).toEqual([]);
    expect(mockEmbed).not.toHaveBeenCalled();
  });

  it('returns [] when embed throws', async () => {
    mockIsEnabled.mockReturnValue(true);
    mockFindByOrgId.mockResolvedValue({ active_provider_id: 7 });
    mockEmbed.mockRejectedValue(new Error('Provider unavailable'));

    const result = await search(1, 'es-MX', 'internet down');
    expect(result).toEqual([]);
  });

  it('returns documents array when everything works', async () => {
    mockIsEnabled.mockReturnValue(true);
    mockFindByOrgId.mockResolvedValue({ active_provider_id: 7 });
    mockEmbed.mockResolvedValue([0.1, 0.2, 0.3]);
    mockQueryDocs.mockResolvedValue({
      ids: ['p_1', 'p_2'],
      documents: ['Thank you for contacting us', 'We are here to help'],
      metadatas: [{}, {}],
      distances: [0.05, 0.1],
    });

    const result = await search(1, 'es-MX', 'internet down', 2);

    expect(result).toEqual(['Thank you for contacting us', 'We are here to help']);
    expect(mockEmbed).toHaveBeenCalledWith('internet down', 7);
    expect(mockQueryDocs).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'phrases_1_es-MX', queryEmbedding: [0.1, 0.2, 0.3], k: 2 }),
    );
  });

  it('sanitises the locale in the collection name', async () => {
    mockIsEnabled.mockReturnValue(true);
    mockFindByOrgId.mockResolvedValue({ active_provider_id: 3 });
    mockEmbed.mockResolvedValue([0.5]);
    mockQueryDocs.mockResolvedValue({ ids: [], documents: [], metadatas: [], distances: [] });

    await search(2, 'zh-Hant-TW', 'query', 5);

    expect(mockQueryDocs).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'phrases_2_zh-Hant-TW' }),
    );
  });
});
