// =============================================================================
// FireISP 5.0 — Vector Store Service (P1 §8)
// =============================================================================
// ChromaDB HTTP API wrapper for vector similarity search.
// All public methods are opt-in: when VECTOR_RETRIEVAL_ENABLED !== 'true'
// they return early / return empty results.
//
// Public API:
//   isEnabled()                                              → boolean
//   ensureCollection(name)                                   → collectionId | null
//   upsertDocuments({collection, ids, embeddings, documents, metadatas})  → void
//   queryDocuments({collection, queryEmbedding, k=5})        → {ids, documents, metadatas, distances}
//   deleteDocuments({collection, ids})                       → void
// =============================================================================

const logger = require('../utils/logger').child({ service: 'vectorStoreService' });

const CHROMA_URL = (process.env.CHROMA_URL || 'http://localhost:8000').replace(/\/$/, '');

// Cache: collection name → collection id
const _collectionCache = new Map();

// ---------------------------------------------------------------------------
// Guard helper
// ---------------------------------------------------------------------------

function isEnabled() {
  return process.env.VECTOR_RETRIEVAL_ENABLED === 'true';
}

// ---------------------------------------------------------------------------
// Internal HTTP helpers
// ---------------------------------------------------------------------------

async function _chromaFetch(path, options = {}) {
  const url = `${CHROMA_URL}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ChromaDB ${options.method || 'GET'} ${path} → HTTP ${res.status}: ${body}`);
  }

  // DELETE /collections/{id}/delete returns 200 with no body
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure a ChromaDB collection exists, returning its ID.
 * Caches the ID in memory to avoid repeated GET calls.
 *
 * @param {string} name
 * @returns {Promise<string|null>}
 */
async function ensureCollection(name) {
  if (!isEnabled()) return null;

  if (_collectionCache.has(name)) {
    return _collectionCache.get(name);
  }

  // Try to create (idempotent: ChromaDB returns the existing collection when it already exists)
  try {
    const data = await _chromaFetch('/api/v1/collections', {
      method: 'POST',
      body: JSON.stringify({ name, metadata: { 'hnsw:space': 'cosine' } }),
    });
    _collectionCache.set(name, data.id);
    logger.debug({ collection: name, id: data.id }, 'vectorStoreService: collection ready');
    return data.id;
  } catch (_createErr) {
    // Collection may already exist — attempt a GET
    try {
      const data = await _chromaFetch(`/api/v1/collections/${encodeURIComponent(name)}`);
      _collectionCache.set(name, data.id);
      logger.debug({ collection: name, id: data.id }, 'vectorStoreService: collection fetched');
      return data.id;
    } catch (getErr) {
      logger.error({ collection: name, err: getErr.message }, 'vectorStoreService: could not create or get collection');
      throw getErr;
    }
  }
}

/**
 * Upsert documents (with embeddings) into a ChromaDB collection.
 *
 * @param {object} opts
 * @param {string}     opts.collection
 * @param {string[]}   opts.ids
 * @param {number[][]} opts.embeddings
 * @param {string[]}   opts.documents
 * @param {object[]}   opts.metadatas
 * @returns {Promise<void>}
 */
async function upsertDocuments({ collection, ids, embeddings, documents, metadatas }) {
  if (!isEnabled()) return;

  const collectionId = await ensureCollection(collection);
  await _chromaFetch(`/api/v1/collections/${collectionId}/upsert`, {
    method: 'POST',
    body: JSON.stringify({ ids, embeddings, documents, metadatas }),
  });

  logger.debug({ collection, count: ids.length }, 'vectorStoreService: upserted documents');
}

/**
 * Query a ChromaDB collection for the k nearest neighbours of a query embedding.
 *
 * @param {object} opts
 * @param {string}   opts.collection
 * @param {number[]} opts.queryEmbedding
 * @param {number}   [opts.k=5]
 * @returns {Promise<{ids: string[], documents: string[], metadatas: object[], distances: number[]}>}
 */
async function queryDocuments({ collection, queryEmbedding, k = 5 }) {
  if (!isEnabled()) {
    return { ids: [], documents: [], metadatas: [], distances: [] };
  }

  const collectionId = await ensureCollection(collection);
  const data = await _chromaFetch(`/api/v1/collections/${collectionId}/query`, {
    method: 'POST',
    body: JSON.stringify({
      query_embeddings: [queryEmbedding],
      n_results: k,
      include: ['documents', 'metadatas', 'distances'],
    }),
  });

  // ChromaDB returns arrays-of-arrays (one per query vector); we sent one query
  return {
    ids:       (data.ids       && data.ids[0])       || [],
    documents: (data.documents && data.documents[0]) || [],
    metadatas: (data.metadatas && data.metadatas[0]) || [],
    distances: (data.distances && data.distances[0]) || [],
  };
}

/**
 * Delete documents by ID from a ChromaDB collection.
 *
 * @param {object}   opts
 * @param {string}   opts.collection
 * @param {string[]} opts.ids
 * @returns {Promise<void>}
 */
async function deleteDocuments({ collection, ids }) {
  if (!isEnabled()) return;

  const collectionId = await ensureCollection(collection);
  await _chromaFetch(`/api/v1/collections/${collectionId}/delete`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });

  logger.debug({ collection, count: ids.length }, 'vectorStoreService: deleted documents');
}

/**
 * Returns the canonical ChromaDB collection name for an org's phrase library.
 *
 * @param {number} orgId
 * @param {string} locale  e.g. "es-MX"
 * @returns {string}
 */
function phraseCollectionName(orgId, locale) {
  return `phrases_${orgId}_${locale.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

module.exports = {
  isEnabled,
  ensureCollection,
  upsertDocuments,
  queryDocuments,
  deleteDocuments,
  phraseCollectionName,
  // Exported for testing
  _collectionCache,
};
