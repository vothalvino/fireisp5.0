// =============================================================================
// FireISP 5.0 — phraseLibraryService Tests (P1 §3.3)
// =============================================================================

// ---------------------------------------------------------------------------
// Model mocks (avoid any DB dependency)
// ---------------------------------------------------------------------------
const mockPhraseCreate        = jest.fn();
const mockPhraseFindById      = jest.fn();
const mockPhraseFindByIdOrFail = jest.fn();
const mockPhraseFindAll       = jest.fn();
const mockPhraseCount         = jest.fn();
const mockPhraseUpdate        = jest.fn();
const mockPhraseDelete        = jest.fn();

jest.mock('../src/models/AiPhrase', () => ({
  findAll:          mockPhraseFindAll,
  count:            mockPhraseCount,
  findById:         mockPhraseFindById,
  findByIdOrFail:   mockPhraseFindByIdOrFail,
  create:           mockPhraseCreate,
  update:           mockPhraseUpdate,
  delete:           mockPhraseDelete,
}));

const mockTermCreate        = jest.fn();
const mockTermFindById      = jest.fn();
const mockTermFindByIdOrFail = jest.fn();
const mockTermFindAll       = jest.fn();
const mockTermCount         = jest.fn();
const mockTermUpdate        = jest.fn();
const mockTermDelete        = jest.fn();

jest.mock('../src/models/AiForbiddenTerm', () => ({
  findAll:          mockTermFindAll,
  count:            mockTermCount,
  findById:         mockTermFindById,
  findByIdOrFail:   mockTermFindByIdOrFail,
  create:           mockTermCreate,
  update:           mockTermUpdate,
  delete:           mockTermDelete,
}));

const service = require('../src/services/phraseLibraryService');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const PHRASE_ROW = {
  id: 1, organization_id: 1, locale: 'es-MX', category: 'greeting',
  text: 'Estimado cliente,', is_required: 1, deleted_at: null,
};

const TERM_ROW = {
  id: 1, organization_id: 1, locale: 'es-MX', term: 'cancelación gratis',
  replacement: null, deleted_at: null,
};

afterEach(() => jest.clearAllMocks());

// =============================================================================
// Phrases — listPhrases
// =============================================================================

describe('phraseLibraryService.listPhrases', () => {
  it('returns data and total with no filters', async () => {
    mockPhraseFindAll.mockResolvedValueOnce([PHRASE_ROW]);
    mockPhraseCount.mockResolvedValueOnce(1);

    const result = await service.listPhrases(1);
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(mockPhraseFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, orgId: 1 }),
    );
  });

  it('forwards locale and category filters', async () => {
    mockPhraseFindAll.mockResolvedValueOnce([]);
    mockPhraseCount.mockResolvedValueOnce(0);

    await service.listPhrases(1, { locale: 'es-MX', category: 'greeting' });
    expect(mockPhraseFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { locale: 'es-MX', category: 'greeting' } }),
    );
  });

  it('handles pagination correctly', async () => {
    mockPhraseFindAll.mockResolvedValueOnce([]);
    mockPhraseCount.mockResolvedValueOnce(0);

    await service.listPhrases(1, { page: 2, limit: 10 });
    expect(mockPhraseFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 10 }),
    );
  });

  it('clamps limit to minimum of 1', async () => {
    mockPhraseFindAll.mockResolvedValueOnce([]);
    mockPhraseCount.mockResolvedValueOnce(0);

    await service.listPhrases(1, { limit: 0 });
    expect(mockPhraseFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 1 }),
    );
  });
});

// =============================================================================
// Phrases — getPhrase
// =============================================================================

describe('phraseLibraryService.getPhrase', () => {
  it('delegates to AiPhrase.findById with orgId', async () => {
    mockPhraseFindById.mockResolvedValueOnce(PHRASE_ROW);
    const result = await service.getPhrase(1, 1);
    expect(result).toBe(PHRASE_ROW);
    expect(mockPhraseFindById).toHaveBeenCalledWith(1, 1);
  });

  it('returns null when phrase does not exist', async () => {
    mockPhraseFindById.mockResolvedValueOnce(null);
    const result = await service.getPhrase(1, 999);
    expect(result).toBeNull();
  });
});

// =============================================================================
// Phrases — createPhrase
// =============================================================================

describe('phraseLibraryService.createPhrase', () => {
  it('creates a phrase with valid fields', async () => {
    mockPhraseCreate.mockResolvedValueOnce(PHRASE_ROW);

    const result = await service.createPhrase(1, {
      locale: 'es-MX', category: 'greeting', text: 'Estimado cliente,', is_required: 1,
    });
    expect(result).toBe(PHRASE_ROW);
    expect(mockPhraseCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 1,
        locale: 'es-MX',
        category: 'greeting',
        text: 'Estimado cliente,',
        is_required: 1,
      }),
    );
  });

  it('defaults is_required to 0 when not provided', async () => {
    mockPhraseCreate.mockResolvedValueOnce({ ...PHRASE_ROW, is_required: 0 });
    await service.createPhrase(1, { locale: 'en', category: 'closing', text: 'Regards,' });
    expect(mockPhraseCreate).toHaveBeenCalledWith(
      expect.objectContaining({ is_required: 0 }),
    );
  });

  it('throws ValidationError when locale is missing', async () => {
    await expect(
      service.createPhrase(1, { category: 'greeting', text: 'Hello' }),
    ).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('locale') });
  });

  it('throws ValidationError when category is missing', async () => {
    await expect(
      service.createPhrase(1, { locale: 'es-MX', text: 'Hello' }),
    ).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('category') });
  });

  it('throws ValidationError when text is missing', async () => {
    await expect(
      service.createPhrase(1, { locale: 'es-MX', category: 'greeting' }),
    ).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('text') });
  });

  it('throws ValidationError when text is blank', async () => {
    await expect(
      service.createPhrase(1, { locale: 'es-MX', category: 'greeting', text: '   ' }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});

// =============================================================================
// Phrases — updatePhrase
// =============================================================================

describe('phraseLibraryService.updatePhrase', () => {
  it('updates allowed fields', async () => {
    mockPhraseFindByIdOrFail.mockResolvedValueOnce(PHRASE_ROW);
    mockPhraseUpdate.mockResolvedValueOnce({ ...PHRASE_ROW, text: 'Updated text.' });

    const result = await service.updatePhrase(1, 1, { text: 'Updated text.' });
    expect(result.text).toBe('Updated text.');
    expect(mockPhraseUpdate).toHaveBeenCalledWith(1, { text: 'Updated text.' }, 1);
  });

  it('returns existing phrase when no fields provided', async () => {
    mockPhraseFindByIdOrFail.mockResolvedValueOnce(PHRASE_ROW);
    mockPhraseFindById.mockResolvedValueOnce(PHRASE_ROW);

    const result = await service.updatePhrase(1, 1, {});
    expect(result).toBe(PHRASE_ROW);
    expect(mockPhraseUpdate).not.toHaveBeenCalled();
  });

  it('propagates NotFoundError when phrase does not exist', async () => {
    const err = Object.assign(new Error('not found'), { statusCode: 404 });
    mockPhraseFindByIdOrFail.mockRejectedValueOnce(err);

    await expect(service.updatePhrase(1, 999, { text: 'x' })).rejects.toMatchObject({ statusCode: 404 });
  });
});

// =============================================================================
// Phrases — deletePhrase
// =============================================================================

describe('phraseLibraryService.deletePhrase', () => {
  it('soft-deletes an existing phrase', async () => {
    mockPhraseFindByIdOrFail.mockResolvedValueOnce(PHRASE_ROW);
    mockPhraseDelete.mockResolvedValueOnce(true);

    const result = await service.deletePhrase(1, 1);
    expect(result).toBe(true);
    expect(mockPhraseDelete).toHaveBeenCalledWith(1, 1);
  });

  it('propagates NotFoundError when phrase does not exist', async () => {
    const err = Object.assign(new Error('not found'), { statusCode: 404 });
    mockPhraseFindByIdOrFail.mockRejectedValueOnce(err);

    await expect(service.deletePhrase(1, 999)).rejects.toMatchObject({ statusCode: 404 });
  });
});

// =============================================================================
// Phrases — getPhrasesByCategory
// =============================================================================

describe('phraseLibraryService.getPhrasesByCategory', () => {
  it('groups phrases by category', async () => {
    mockPhraseFindAll.mockResolvedValueOnce([
      { ...PHRASE_ROW, id: 1, category: 'greeting' },
      { ...PHRASE_ROW, id: 2, category: 'greeting', text: 'Buenos días,' },
      { ...PHRASE_ROW, id: 3, category: 'apology', text: 'Lamentamos el inconveniente.' },
    ]);

    const grouped = await service.getPhrasesByCategory(1, 'es-MX');
    expect(Object.keys(grouped)).toEqual(expect.arrayContaining(['greeting', 'apology']));
    expect(grouped.greeting).toHaveLength(2);
    expect(grouped.apology).toHaveLength(1);
  });

  it('returns empty object when no phrases exist', async () => {
    mockPhraseFindAll.mockResolvedValueOnce([]);
    const grouped = await service.getPhrasesByCategory(1, 'pt-BR');
    expect(grouped).toEqual({});
  });

  it('filters by locale', async () => {
    mockPhraseFindAll.mockResolvedValueOnce([]);
    await service.getPhrasesByCategory(1, 'en');
    expect(mockPhraseFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { locale: 'en' } }),
    );
  });
});

// =============================================================================
// Forbidden Terms — listForbiddenTerms
// =============================================================================

describe('phraseLibraryService.listForbiddenTerms', () => {
  it('returns data and total', async () => {
    mockTermFindAll.mockResolvedValueOnce([TERM_ROW]);
    mockTermCount.mockResolvedValueOnce(1);

    const result = await service.listForbiddenTerms(1);
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('forwards locale filter', async () => {
    mockTermFindAll.mockResolvedValueOnce([]);
    mockTermCount.mockResolvedValueOnce(0);

    await service.listForbiddenTerms(1, { locale: 'es-MX' });
    expect(mockTermFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { locale: 'es-MX' } }),
    );
  });

  it('paginates correctly', async () => {
    mockTermFindAll.mockResolvedValueOnce([]);
    mockTermCount.mockResolvedValueOnce(0);

    await service.listForbiddenTerms(1, { page: 3, limit: 5 });
    expect(mockTermFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, offset: 10 }),
    );
  });
});

// =============================================================================
// Forbidden Terms — getForbiddenTerm
// =============================================================================

describe('phraseLibraryService.getForbiddenTerm', () => {
  it('delegates to AiForbiddenTerm.findById', async () => {
    mockTermFindById.mockResolvedValueOnce(TERM_ROW);
    const result = await service.getForbiddenTerm(1, 1);
    expect(result).toBe(TERM_ROW);
    expect(mockTermFindById).toHaveBeenCalledWith(1, 1);
  });
});

// =============================================================================
// Forbidden Terms — createForbiddenTerm
// =============================================================================

describe('phraseLibraryService.createForbiddenTerm', () => {
  it('creates a term with valid fields', async () => {
    mockTermCreate.mockResolvedValueOnce(TERM_ROW);

    const result = await service.createForbiddenTerm(1, {
      locale: 'es-MX', term: 'cancelación gratis',
    });
    expect(result).toBe(TERM_ROW);
    expect(mockTermCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 1,
        locale: 'es-MX',
        term: 'cancelación gratis',
        replacement: null,
      }),
    );
  });

  it('trims whitespace from term', async () => {
    mockTermCreate.mockResolvedValueOnce(TERM_ROW);
    await service.createForbiddenTerm(1, { locale: 'es-MX', term: '  extra spaces  ' });
    expect(mockTermCreate).toHaveBeenCalledWith(
      expect.objectContaining({ term: 'extra spaces' }),
    );
  });

  it('stores replacement when provided', async () => {
    mockTermCreate.mockResolvedValueOnce({ ...TERM_ROW, replacement: 'bonificación' });
    await service.createForbiddenTerm(1, {
      locale: 'es-MX', term: 'gratis', replacement: 'bonificación',
    });
    expect(mockTermCreate).toHaveBeenCalledWith(
      expect.objectContaining({ replacement: 'bonificación' }),
    );
  });

  it('throws ValidationError when locale is missing', async () => {
    await expect(
      service.createForbiddenTerm(1, { term: 'bad word' }),
    ).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('locale') });
  });

  it('throws ValidationError when term is missing', async () => {
    await expect(
      service.createForbiddenTerm(1, { locale: 'es-MX' }),
    ).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('term') });
  });

  it('throws ValidationError when term is blank', async () => {
    await expect(
      service.createForbiddenTerm(1, { locale: 'es-MX', term: '  ' }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});

// =============================================================================
// Forbidden Terms — updateForbiddenTerm
// =============================================================================

describe('phraseLibraryService.updateForbiddenTerm', () => {
  it('updates term and replacement', async () => {
    mockTermFindByIdOrFail.mockResolvedValueOnce(TERM_ROW);
    mockTermUpdate.mockResolvedValueOnce({ ...TERM_ROW, term: 'nuevo término', replacement: 'sustituto' });

    const result = await service.updateForbiddenTerm(1, 1, {
      term: 'nuevo término', replacement: 'sustituto',
    });
    expect(result.term).toBe('nuevo término');
    expect(mockTermUpdate).toHaveBeenCalledWith(1, { term: 'nuevo término', replacement: 'sustituto' }, 1);
  });

  it('trims whitespace on update', async () => {
    mockTermFindByIdOrFail.mockResolvedValueOnce(TERM_ROW);
    mockTermUpdate.mockResolvedValueOnce(TERM_ROW);

    await service.updateForbiddenTerm(1, 1, { term: '  spaces  ' });
    expect(mockTermUpdate).toHaveBeenCalledWith(1, { term: 'spaces' }, 1);
  });

  it('returns unchanged term when no fields provided', async () => {
    mockTermFindByIdOrFail.mockResolvedValueOnce(TERM_ROW);
    mockTermFindById.mockResolvedValueOnce(TERM_ROW);

    const result = await service.updateForbiddenTerm(1, 1, {});
    expect(result).toBe(TERM_ROW);
    expect(mockTermUpdate).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Forbidden Terms — deleteForbiddenTerm
// =============================================================================

describe('phraseLibraryService.deleteForbiddenTerm', () => {
  it('soft-deletes a term', async () => {
    mockTermFindByIdOrFail.mockResolvedValueOnce(TERM_ROW);
    mockTermDelete.mockResolvedValueOnce(true);

    const result = await service.deleteForbiddenTerm(1, 1);
    expect(result).toBe(true);
    expect(mockTermDelete).toHaveBeenCalledWith(1, 1);
  });
});

// =============================================================================
// Forbidden Terms — getTermsByLocale
// =============================================================================

describe('phraseLibraryService.getTermsByLocale', () => {
  it('returns all terms for a locale without pagination cap', async () => {
    mockTermFindAll.mockResolvedValueOnce([TERM_ROW]);
    const result = await service.getTermsByLocale(1, 'es-MX');
    expect(result).toHaveLength(1);
    expect(mockTermFindAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { locale: 'es-MX' }, limit: 1000 }),
    );
  });
});

// =============================================================================
// validateDraft
// =============================================================================

describe('phraseLibraryService.validateDraft', () => {
  it('returns valid=true when all required phrases are present and no forbidden terms hit', async () => {
    mockPhraseFindAll.mockResolvedValueOnce([
      { id: 1, text: 'estimado cliente', is_required: 1 },
      { id: 2, text: 'con gusto', is_required: 0 },
    ]);
    mockTermFindAll.mockResolvedValueOnce([
      { id: 1, term: 'cancelación gratis', replacement: null },
    ]);

    const draft = 'Estimado Cliente, con gusto le atendemos.';
    const result = await service.validateDraft(1, 'es-MX', draft);

    expect(result.valid).toBe(true);
    expect(result.missingRequired).toHaveLength(0);
    expect(result.hitForbidden).toHaveLength(0);
  });

  it('reports missing required phrases', async () => {
    mockPhraseFindAll.mockResolvedValueOnce([
      { id: 1, text: 'estimado cliente', is_required: 1 },
      { id: 2, text: 'saludos cordiales', is_required: 1 },
    ]);
    mockTermFindAll.mockResolvedValueOnce([]);

    const draft = 'Estimado cliente, gracias por contactarnos.';
    const result = await service.validateDraft(1, 'es-MX', draft);

    expect(result.valid).toBe(false);
    expect(result.missingRequired).toContain('saludos cordiales');
    expect(result.missingRequired).not.toContain('estimado cliente');
  });

  it('reports forbidden term hits', async () => {
    mockPhraseFindAll.mockResolvedValueOnce([]);
    mockTermFindAll.mockResolvedValueOnce([
      { id: 1, term: 'cancelación gratis', replacement: 'bonificación' },
    ]);

    const draft = 'Ofrecemos cancelación gratis este mes.';
    const result = await service.validateDraft(1, 'es-MX', draft);

    expect(result.valid).toBe(false);
    expect(result.hitForbidden).toHaveLength(1);
    expect(result.hitForbidden[0]).toMatchObject({ term: 'cancelación gratis', replacement: 'bonificación' });
  });

  it('is case-insensitive for both checks', async () => {
    mockPhraseFindAll.mockResolvedValueOnce([
      { id: 1, text: 'ESTIMADO CLIENTE', is_required: 1 },
    ]);
    mockTermFindAll.mockResolvedValueOnce([
      { id: 1, term: 'CANCELACIÓN', replacement: null },
    ]);

    const draft = 'estimado cliente, no hay cancelación disponible.';
    const result = await service.validateDraft(1, 'es-MX', draft);

    expect(result.valid).toBe(false);
    expect(result.missingRequired).toHaveLength(0);  // required phrase IS present (case-insensitive)
    expect(result.hitForbidden).toHaveLength(1);      // forbidden term IS found (case-insensitive)
  });

  it('returns valid=true for empty library', async () => {
    mockPhraseFindAll.mockResolvedValueOnce([]);
    mockTermFindAll.mockResolvedValueOnce([]);

    const result = await service.validateDraft(1, 'en', 'Any draft text goes here.');
    expect(result.valid).toBe(true);
    expect(result.missingRequired).toHaveLength(0);
    expect(result.hitForbidden).toHaveLength(0);
  });

  it('returns replacement=null when term has no replacement', async () => {
    mockPhraseFindAll.mockResolvedValueOnce([]);
    mockTermFindAll.mockResolvedValueOnce([
      { id: 2, term: 'ilegal', replacement: null },
    ]);

    const result = await service.validateDraft(1, 'es-MX', 'eso es ilegal');
    expect(result.hitForbidden[0].replacement).toBeNull();
  });
});
