// =============================================================================
// FireISP 5.0 — §8 llmProviderService.embed() Tests
// =============================================================================

jest.mock('../src/utils/logger', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const mockDecrypt    = jest.fn(v => v); // pass-through by default
const mockFindById   = jest.fn();

jest.mock('../src/models/AiProvider', () => ({ findById: mockFindById }));
jest.mock('../src/utils/encryption', () => ({ decrypt: mockDecrypt }));
jest.mock('../src/utils/errors', () => ({
  AppError: class AppError extends Error {
    constructor(msg, status, code) {
      super(msg);
      this.status = status;
      this.code   = code;
    }
  },
}));

// ---------------------------------------------------------------------------
// OpenAI SDK mock
// ---------------------------------------------------------------------------

const mockEmbeddingsCreate = jest.fn();
jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    embeddings: { create: mockEmbeddingsCreate },
  })),
}));

// ---------------------------------------------------------------------------
// Google Generative AI mock
// ---------------------------------------------------------------------------

const mockEmbedContent = jest.fn();
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({ embedContent: mockEmbedContent }),
  })),
}));

// ---------------------------------------------------------------------------
// global fetch mock for Ollama
// ---------------------------------------------------------------------------

let mockFetch;

// ---------------------------------------------------------------------------

describe('llmProviderService.embed()', () => {
  let embed;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    embed = require('../src/services/llmProviderService').embed;
  });

  it('throws AppError when providerId is missing', async () => {
    await expect(embed('hello')).rejects.toMatchObject({ code: 'LLM_MISSING_PROVIDER' });
  });

  it('throws AppError when provider is not found', async () => {
    mockFindById.mockResolvedValue(null);
    await expect(embed('hello', 99)).rejects.toMatchObject({ code: 'LLM_PROVIDER_NOT_FOUND' });
  });

  it('returns embedding array for openai kind', async () => {
    mockFindById.mockResolvedValue({ id: 1, kind: 'openai', api_key_encrypted: 'sk-x', timeout_ms: 5000, embedding_model: null });
    mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] });

    const result = await embed('hello world', 1);

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'text-embedding-3-small', input: 'hello world' }),
    );
  });

  it('uses provider.embedding_model when set (openai)', async () => {
    mockFindById.mockResolvedValue({ id: 1, kind: 'openai', api_key_encrypted: 'sk-x', timeout_ms: 5000, embedding_model: 'text-embedding-ada-002' });
    mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: [0.9, 0.8] }] });

    await embed('test', 1);

    expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'text-embedding-ada-002' }),
    );
  });

  it('returns embedding array for gemini kind', async () => {
    mockFindById.mockResolvedValue({ id: 2, kind: 'gemini', api_key_encrypted: 'gemini-key', timeout_ms: 5000, embedding_model: null });
    mockEmbedContent.mockResolvedValue({ embedding: { values: [0.4, 0.5, 0.6] } });

    const result = await embed('gemini text', 2);

    expect(result).toEqual([0.4, 0.5, 0.6]);
  });

  it('returns embedding array for ollama kind (new /api/embed endpoint)', async () => {
    mockFindById.mockResolvedValue({
      id: 3, kind: 'ollama', api_key_encrypted: null,
      endpoint_url: 'http://ollama:11434', timeout_ms: 5000, embedding_model: null,
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ embeddings: [[0.7, 0.8, 0.9]] }),
    });

    const result = await embed('ollama text', 3);

    expect(result).toEqual([0.7, 0.8, 0.9]);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://ollama:11434/api/embed',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('falls back to /api/embeddings for ollama when /api/embed fails', async () => {
    mockFindById.mockResolvedValue({
      id: 3, kind: 'ollama', api_key_encrypted: null,
      endpoint_url: 'http://ollama:11434', timeout_ms: 5000, embedding_model: null,
    });

    // First call (/api/embed) fails
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 404 })
      // Second call (/api/embeddings) succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ embedding: [0.1, 0.2] }),
      });

    const result = await embed('ollama fallback', 3);

    expect(result).toEqual([0.1, 0.2]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toContain('/api/embeddings');
  });

  it('throws for anthropic kind', async () => {
    mockFindById.mockResolvedValue({ id: 4, kind: 'anthropic', api_key_encrypted: 'ant-key' });
    await expect(embed('text', 4)).rejects.toMatchObject({ code: 'LLM_EMBED_NOT_SUPPORTED' });
  });

  it('throws for custom kind', async () => {
    mockFindById.mockResolvedValue({ id: 5, kind: 'custom', api_key_encrypted: 'key' });
    await expect(embed('text', 5)).rejects.toMatchObject({ code: 'LLM_EMBED_NOT_SUPPORTED' });
  });
});
