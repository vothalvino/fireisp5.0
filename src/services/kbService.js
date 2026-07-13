// =============================================================================
// FireISP 5.0 — Knowledge Base Service (§21.8)
// =============================================================================
// Manages KB articles, embeddings, and feedback.
// Supports keyword search and cosine-similarity semantic search.
// =============================================================================
'use strict';
const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'kbService' });

// ---------------------------------------------------------------------------
// Lazy service loader for LLM — avoids hard coupling
// ---------------------------------------------------------------------------
function getLlmService() {
  try { return require('./llmProviderService'); } catch { return null; }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * List KB articles with optional filtering.
 *
 * @param {number|string} orgId
 * @param {object} filters - category, locale, search, isPublished, limit, offset
 * @returns {Promise<object[]>}
 */
async function listArticles(orgId, filters = {}) {
  const {
    category,
    locale,
    search,
    isPublished = 1,
    limit = 50,
    offset = 0,
  } = filters;

  const conditions = ['ka.organization_id = ?'];
  const params = [orgId];

  if (isPublished !== undefined && isPublished !== null) {
    conditions.push('ka.is_published = ?');
    params.push(isPublished ? 1 : 0);
  }
  if (category) {
    conditions.push('ka.category = ?');
    params.push(category);
  }
  if (locale) {
    conditions.push('ka.locale = ?');
    params.push(locale);
  }
  if (search) {
    conditions.push('(ka.title LIKE ? OR ka.body LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const safeLimit  = Math.max(1, parseInt(limit, 10) || 50);
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

  const [rows] = await db.query(
    `SELECT id, title, category, locale, tags, is_published, created_at, updated_at
       FROM kb_articles ka
      WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at DESC
      LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params,
  );
  return rows;
}

/**
 * Get a single KB article by id.
 *
 * @param {number|string} id
 * @param {number|string} orgId
 * @returns {Promise<object|null>}
 */
async function getArticle(id, orgId) {
  const [rows] = await db.query(
    'SELECT * FROM kb_articles WHERE id = ? AND organization_id = ?',
    [id, orgId],
  );
  return rows[0] ?? null;
}

/**
 * Create a new KB article.
 *
 * @param {object} data - orgId, title, body, category, locale, tags, isPublished, createdBy
 * @returns {Promise<{ id: number }>}
 */
async function createArticle(data) {
  const {
    orgId,
    title,
    body,
    category,
    locale = 'es',
    tags,
    isPublished = 1,
    createdBy,
  } = data;

  const tagsJson = Array.isArray(tags) ? JSON.stringify(tags) : (tags ?? null);

  const [result] = await db.query(
    `INSERT INTO kb_articles
       (organization_id, title, body, category, locale, tags, is_published, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [orgId, title, body, category || null, locale, tagsJson, isPublished ? 1 : 0, createdBy || null],
  );
  return { id: result.insertId };
}

/**
 * Update a KB article.
 *
 * @param {number|string} id
 * @param {number|string} orgId
 * @param {object} data
 * @returns {Promise<{ affected: number }>}
 */
async function updateArticle(id, orgId, data) {
  const allowed = ['title', 'body', 'category', 'locale', 'tags', 'is_published'];
  const setClauses = [];
  const params = [];

  for (const field of allowed) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      setClauses.push(`${field} = ?`);
      let val = data[field];
      if (field === 'tags' && Array.isArray(val)) val = JSON.stringify(val);
      if (field === 'is_published') val = val ? 1 : 0;
      params.push(val);
    }
  }

  if (setClauses.length === 0) return { affected: 0 };

  setClauses.push('updated_at = NOW()');
  params.push(id, orgId);

  const [result] = await db.query(
    `UPDATE kb_articles SET ${setClauses.join(', ')} WHERE id = ? AND organization_id = ?`,
    params,
  );
  return { affected: result.affectedRows };
}

/**
 * Delete a KB article.
 *
 * @param {number|string} id
 * @param {number|string} orgId
 * @returns {Promise<{ affected: number }>}
 */
async function deleteArticle(id, orgId) {
  const [result] = await db.query(
    'DELETE FROM kb_articles WHERE id = ? AND organization_id = ?',
    [id, orgId],
  );
  return { affected: result.affectedRows };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search KB articles using semantic (embedding cosine) or keyword fallback.
 *
 * @param {number|string} orgId
 * @param {string} query
 * @param {string|null} locale
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
async function searchArticles(orgId, query, locale, limit = 10) {
  // Check if any embeddings exist for this org
  let useEmbeddings = false;
  try {
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM kb_article_embeddings
        WHERE article_id IN (SELECT id FROM kb_articles WHERE organization_id = ?)`,
      [orgId],
    );
    useEmbeddings = (countRows[0]?.cnt ?? 0) > 0;
  } catch {
    // leave useEmbeddings as false
  }

  if (useEmbeddings) {
    const llm = getLlmService();
    if (llm && typeof llm.embed === 'function') {
      try {
        return await _semanticSearch(orgId, query, locale, limit, llm);
      } catch (err) {
        logger.warn({ err }, 'kbService: semantic search failed — falling back to keyword');
      }
    }
  }

  return _keywordSearch(orgId, query, locale, limit);
}

async function _semanticSearch(orgId, query, locale, limit, llm) {
  // Fetch all published article embeddings for this org
  const localeClause = locale ? 'AND ka.locale = ?' : '';
  const params = locale ? [orgId, locale] : [orgId];

  const [rows] = await db.query(
    `SELECT kbe.embedding, kbe.dimensions, ka.id, ka.title, ka.body, ka.category
       FROM kb_articles ka
       JOIN kb_article_embeddings kbe ON kbe.article_id = ka.id
      WHERE ka.organization_id = ? AND ka.is_published = 1 ${localeClause}`,
    params,
  );

  if (rows.length === 0) return [];

  // Get query embedding (use this org's highest-priority enabled provider).
  // CRITICAL: this previously had no organization_id filter at all — it
  // picked ANY tenant's provider row, decrypted THEIR api_key, and sent this
  // org's customer/article text to their endpoint on their bill (and the
  // resulting embedding came from a different model than the one that
  // produced the stored kb_article_embeddings, making every cosine score
  // meaningless). Same shape as supportConversationService.getOrgProviderId.
  const [providerRow] = await db.query(
    'SELECT id FROM ai_providers WHERE organization_id = ? AND enabled = 1 AND deleted_at IS NULL ORDER BY priority ASC LIMIT 1',
    [orgId],
  ).catch(() => [[]]);
  const providerId = providerRow?.[0]?.id;
  if (!providerId) return _keywordSearch(orgId, query, locale, limit);

  const queryEmbedding = await llm.embed(query, providerId);
  if (!queryEmbedding) return _keywordSearch(orgId, query, locale, limit);

  // Compute cosine similarities
  const scored = rows.map(row => {
    let storedVec;
    try {
      storedVec = typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding;
    } catch {
      storedVec = [];
    }
    const similarity = _cosine(queryEmbedding, storedVec);
    return { ...row, similarity };
  });

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit).map(({ embedding: _emb, dimensions: _dim, similarity, ...article }) => ({
    ...article,
    similarity,
  }));
}

async function _keywordSearch(orgId, query, locale, limit) {
  const conditions = ['organization_id = ? AND is_published = 1 AND (title LIKE ? OR body LIKE ?)'];
  const params = [orgId, `%${query}%`, `%${query}%`];

  if (locale) {
    conditions.push('locale = ?');
    params.push(locale);
  }

  const safeLimit = Math.max(1, parseInt(limit, 10) || 10);

  const [rows] = await db.query(
    `SELECT id, title, body, category, locale, tags, updated_at
       FROM kb_articles
      WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at DESC
      LIMIT ${safeLimit}`,
    params,
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

/**
 * Generate and store an embedding for a KB article.
 *
 * @param {number|string} articleId
 * @param {number|string} providerId
 * @returns {Promise<{ dimensions: number }>}
 */
async function embedArticle(articleId, providerId) {
  const llm = getLlmService();
  if (!llm || typeof llm.embed !== 'function') {
    throw new Error('LLM provider service not available for embedding');
  }

  const [rows] = await db.query(
    'SELECT body FROM kb_articles WHERE id = ?',
    [articleId],
  );
  if (rows.length === 0) throw new Error(`Article ${articleId} not found`);

  const body = rows[0].body;
  const embedding = await llm.embed(body, providerId);
  if (!embedding || !Array.isArray(embedding)) {
    throw new Error('Failed to generate embedding');
  }

  const embeddingJson = JSON.stringify(embedding);
  const dimensions = embedding.length;

  // Delete existing then insert (no unique key constraint guaranteed)
  await db.query(
    'DELETE FROM kb_article_embeddings WHERE article_id = ? AND provider_id = ?',
    [articleId, providerId],
  );
  await db.query(
    'INSERT INTO kb_article_embeddings (article_id, provider_id, embedding, dimensions) VALUES (?,?,?,?)',
    [articleId, providerId, embeddingJson, dimensions],
  );

  return { dimensions };
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

/**
 * Add feedback for a KB article.
 *
 * @param {object} opts - articleId, conversationId, feedback, notes
 * @returns {Promise<{ id: number }>}
 */
async function addFeedback({ articleId, conversationId, feedback, notes }) {
  const [result] = await db.query(
    `INSERT INTO kb_feedback (article_id, conversation_id, feedback, notes)
     VALUES (?,?,?,?)`,
    [articleId, conversationId || null, feedback, notes || null],
  );
  return { id: result.insertId };
}

// ---------------------------------------------------------------------------
// Reindex
// ---------------------------------------------------------------------------

/**
 * Re-embed all published articles for an organization.
 *
 * @param {number|string} orgId
 * @param {number|string} providerId
 * @returns {Promise<{ processed: number, errors: number }>}
 */
async function reindexAll(orgId, providerId) {
  const [articles] = await db.query(
    'SELECT id FROM kb_articles WHERE organization_id = ? AND is_published = 1',
    [orgId],
  );

  let processed = 0;
  let errors = 0;

  for (const article of articles) {
    try {
      await embedArticle(article.id, providerId);
      processed++;
    } catch (err) {
      logger.warn({ err, articleId: article.id }, 'kbService: failed to embed article during reindex');
      errors++;
    }
  }

  logger.info({ orgId, processed, errors }, 'kbService: reindex complete');
  return { processed, errors };
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

/**
 * Compute cosine similarity between two numeric vectors.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} - value in [-1, 1], returns 0 for zero vectors
 */
function _cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = {
  listArticles,
  getArticle,
  createArticle,
  updateArticle,
  deleteArticle,
  searchArticles,
  embedArticle,
  addFeedback,
  reindexAll,
};
