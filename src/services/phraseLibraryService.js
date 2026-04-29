// =============================================================================
// FireISP 5.0 — Phrase Library Service (P1 §3.3)
// =============================================================================
// Provides CRUD and retrieval operations for:
//   • ai_phrase_library   — curated on-brand reply phrases per org/locale/category
//   • ai_forbidden_terms  — banned words/phrases per org/locale
//
// All operations are scoped to an organization.  The service is intentionally
// free of LLM calls — it is a pure data layer consumed by aiReplyService (§3.5)
// and by the admin REST routes (§5.1).
//
// Public API (phrases):
//   listPhrases(orgId, {locale, category, page, limit})  → {data, total}
//   getPhrase(orgId, phraseId)                           → phrase | null
//   createPhrase(orgId, fields)                          → phrase
//   updatePhrase(orgId, phraseId, fields)                → phrase
//   deletePhrase(orgId, phraseId)                        → true
//   getPhrasesByCategory(orgId, locale)                  → { [category]: phrase[] }
//
// Public API (forbidden terms):
//   listForbiddenTerms(orgId, {locale, page, limit})     → {data, total}
//   getForbiddenTerm(orgId, termId)                      → term | null
//   createForbiddenTerm(orgId, fields)                   → term
//   updateForbiddenTerm(orgId, termId, fields)           → term
//   deleteForbiddenTerm(orgId, termId)                   → true
//   getTermsByLocale(orgId, locale)                      → term[]
//
// Public API (validation helper):
//   validateDraft(orgId, locale, draftText)
//     → { valid: bool, missingRequired: string[], hitForbidden: {term, replacement}[] }
// =============================================================================

const AiPhrase       = require('../models/AiPhrase');
const AiForbiddenTerm = require('../models/AiForbiddenTerm');
const { NotFoundError, ValidationError } = require('../utils/errors');
const logger = require('../utils/logger').child({ service: 'phraseLibraryService' });

// =============================================================================
// Internal pagination helper
// =============================================================================

/**
 * Clamp and parse pagination parameters.
 * - limit 0 or NaN → 50 (default)
 * - limit < 1      → 1  (minimum)
 * - page  < 1      → 1  (minimum)
 *
 * @param {number|string} limit
 * @param {number|string} page
 * @returns {{ safeLimit: number, offset: number }}
 */
function _parsePagination(limit, page) {
  const parsedLimit = parseInt(limit, 10);
  const safeLimit   = Number.isFinite(parsedLimit) ? Math.max(1, parsedLimit) : 50;
  const safePage    = Math.max(1, parseInt(page, 10) || 1);
  return { safeLimit, offset: (safePage - 1) * safeLimit };
}

// =============================================================================
// Phrase Library — CRUD
// =============================================================================

/**
 * List phrases for an org, with optional locale/category filters and pagination.
 *
 * @param {number} orgId
 * @param {object} [opts]
 * @param {string} [opts.locale]    BCP-47 locale tag, e.g. 'es-MX'
 * @param {string} [opts.category]  Phrase category, e.g. 'greeting'
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=50]
 * @returns {Promise<{data: object[], total: number}>}
 */
async function listPhrases(orgId, { locale, category, page = 1, limit = 50 } = {}) {
  const where = {};
  if (locale)   where.locale   = locale;
  if (category) where.category = category;

  const { safeLimit, offset } = _parsePagination(limit, page);

  const [data, total] = await Promise.all([
    AiPhrase.findAll({ where, orgId, orderBy: 'id', order: 'ASC', limit: safeLimit, offset }),
    AiPhrase.count({ where, orgId }),
  ]);

  return { data, total };
}

/**
 * Return a single phrase by ID (org-scoped).
 *
 * @param {number} orgId
 * @param {number} phraseId
 * @returns {Promise<object|null>}
 */
async function getPhrase(orgId, phraseId) {
  return AiPhrase.findById(phraseId, orgId);
}

/**
 * Create a new phrase.
 *
 * @param {number} orgId
 * @param {object} fields  { locale, category, text, is_required? }
 * @returns {Promise<object>}
 */
async function createPhrase(orgId, fields) {
  _validatePhraseFields(fields);

  const phrase = await AiPhrase.create({
    organization_id: orgId,
    locale:      fields.locale,
    category:    fields.category,
    text:        fields.text,
    is_required: fields.is_required ?? 0,
  });

  logger.info({ orgId, phraseId: phrase.id, category: phrase.category }, 'Phrase created');
  return phrase;
}

/**
 * Update an existing phrase (partial update — only provided fields are changed).
 *
 * @param {number} orgId
 * @param {number} phraseId
 * @param {object} fields
 * @returns {Promise<object>}
 */
async function updatePhrase(orgId, phraseId, fields) {
  await AiPhrase.findByIdOrFail(phraseId, orgId);

  const allowed = { locale: fields.locale, category: fields.category, text: fields.text };
  if (fields.is_required !== undefined) allowed.is_required = fields.is_required;

  // Drop undefined values
  for (const key of Object.keys(allowed)) {
    if (allowed[key] === undefined) delete allowed[key];
  }

  if (Object.keys(allowed).length === 0) {
    return AiPhrase.findById(phraseId, orgId);
  }

  return AiPhrase.update(phraseId, allowed, orgId);
}

/**
 * Soft-delete a phrase.
 *
 * @param {number} orgId
 * @param {number} phraseId
 * @returns {Promise<true>}
 */
async function deletePhrase(orgId, phraseId) {
  await AiPhrase.findByIdOrFail(phraseId, orgId);
  return AiPhrase.delete(phraseId, orgId);
}

/**
 * Return phrases grouped by category for a given locale.
 * Useful for building the system prompt: the LLM receives a map of
 * { greeting: [...], apology: [...], ... }.
 *
 * @param {number} orgId
 * @param {string} locale
 * @returns {Promise<Object.<string, object[]>>}
 */
async function getPhrasesByCategory(orgId, locale) {
  const rows = await AiPhrase.findAll({
    where: { locale },
    orgId,
    orderBy: 'id',
    order: 'ASC',
    limit: 500,
  });

  const grouped = {};
  for (const row of rows) {
    const cat = row.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(row);
  }
  return grouped;
}

// =============================================================================
// Forbidden Terms — CRUD
// =============================================================================

/**
 * List forbidden terms for an org, with optional locale filter and pagination.
 *
 * @param {number} orgId
 * @param {object} [opts]
 * @param {string} [opts.locale]
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=50]
 * @returns {Promise<{data: object[], total: number}>}
 */
async function listForbiddenTerms(orgId, { locale, page = 1, limit = 50 } = {}) {
  const where = {};
  if (locale) where.locale = locale;

  const { safeLimit, offset } = _parsePagination(limit, page);

  const [data, total] = await Promise.all([
    AiForbiddenTerm.findAll({ where, orgId, orderBy: 'id', order: 'ASC', limit: safeLimit, offset }),
    AiForbiddenTerm.count({ where, orgId }),
  ]);

  return { data, total };
}

/**
 * Return a single forbidden term by ID (org-scoped).
 *
 * @param {number} orgId
 * @param {number} termId
 * @returns {Promise<object|null>}
 */
async function getForbiddenTerm(orgId, termId) {
  return AiForbiddenTerm.findById(termId, orgId);
}

/**
 * Create a new forbidden term.
 *
 * @param {number} orgId
 * @param {object} fields  { locale, term, replacement? }
 * @returns {Promise<object>}
 */
async function createForbiddenTerm(orgId, fields) {
  _validateForbiddenTermFields(fields);

  const record = await AiForbiddenTerm.create({
    organization_id: orgId,
    locale:      fields.locale,
    term:        fields.term.trim(),
    replacement: fields.replacement ?? null,
  });

  logger.info({ orgId, termId: record.id, term: record.term }, 'Forbidden term created');
  return record;
}

/**
 * Update an existing forbidden term.
 *
 * @param {number} orgId
 * @param {number} termId
 * @param {object} fields
 * @returns {Promise<object>}
 */
async function updateForbiddenTerm(orgId, termId, fields) {
  await AiForbiddenTerm.findByIdOrFail(termId, orgId);

  const allowed = {};
  if (fields.locale      !== undefined) allowed.locale      = fields.locale;
  if (fields.term        !== undefined) allowed.term        = fields.term.trim();
  if (fields.replacement !== undefined) allowed.replacement = fields.replacement;

  if (Object.keys(allowed).length === 0) {
    return AiForbiddenTerm.findById(termId, orgId);
  }

  return AiForbiddenTerm.update(termId, allowed, orgId);
}

/**
 * Soft-delete a forbidden term.
 *
 * @param {number} orgId
 * @param {number} termId
 * @returns {Promise<true>}
 */
async function deleteForbiddenTerm(orgId, termId) {
  await AiForbiddenTerm.findByIdOrFail(termId, orgId);
  return AiForbiddenTerm.delete(termId, orgId);
}

/**
 * Return all forbidden terms for an org + locale (no pagination).
 * Used by the output validator to build an in-memory check set quickly.
 *
 * @param {number} orgId
 * @param {string} locale
 * @returns {Promise<object[]>}
 */
async function getTermsByLocale(orgId, locale) {
  return AiForbiddenTerm.findAll({
    where: { locale },
    orgId,
    orderBy: 'id',
    order: 'ASC',
    limit: 1000,
  });
}

// =============================================================================
// Output validator helper
// =============================================================================

/**
 * Check a draft text against the phrase library and forbidden-term list for an org + locale.
 *
 * Returns:
 *   valid           — true when no required phrase is missing and no forbidden term is present
 *   missingRequired — list of phrase texts that are required but absent from the draft
 *   hitForbidden    — list of { term, replacement } objects that appear in the draft
 *
 * The check is case-insensitive for both required-phrase inclusion and forbidden-term detection.
 *
 * @param {number} orgId
 * @param {string} locale   BCP-47 locale tag
 * @param {string} draftText
 * @returns {Promise<{valid: boolean, missingRequired: string[], hitForbidden: {term: string, replacement: string|null}[]}>}
 */
async function validateDraft(orgId, locale, draftText) {
  const [phrases, terms] = await Promise.all([
    AiPhrase.findAll({ where: { locale }, orgId, limit: 500 }),
    getTermsByLocale(orgId, locale),
  ]);

  const lowerDraft = draftText.toLowerCase();

  // --- Required phrases: must appear somewhere in the draft ---
  // Normalise is_required: MySQL TINYINT returns 1/0, JS boolean true/false both accepted.
  const requiredPhrases = phrases.filter(p => Number(p.is_required) === 1);
  const missingRequired = requiredPhrases
    .filter(p => !lowerDraft.includes(p.text.toLowerCase()))
    .map(p => p.text);

  // --- Forbidden terms: must NOT appear in the draft ---
  const hitForbidden = terms
    .filter(t => lowerDraft.includes(t.term.toLowerCase()))
    .map(t => ({ term: t.term, replacement: t.replacement ?? null }));

  const valid = missingRequired.length === 0 && hitForbidden.length === 0;

  return { valid, missingRequired, hitForbidden };
}

// =============================================================================
// Internal validators
// =============================================================================

function _validatePhraseFields(fields) {
  if (!fields.locale || typeof fields.locale !== 'string' || !fields.locale.trim()) {
    throw new ValidationError('locale is required');
  }
  if (!fields.category || typeof fields.category !== 'string' || !fields.category.trim()) {
    throw new ValidationError('category is required');
  }
  if (!fields.text || typeof fields.text !== 'string' || !fields.text.trim()) {
    throw new ValidationError('text is required');
  }
}

function _validateForbiddenTermFields(fields) {
  if (!fields.locale || typeof fields.locale !== 'string' || !fields.locale.trim()) {
    throw new ValidationError('locale is required');
  }
  if (!fields.term || typeof fields.term !== 'string' || !fields.term.trim()) {
    throw new ValidationError('term is required');
  }
}

module.exports = {
  // phrases
  listPhrases,
  getPhrase,
  createPhrase,
  updatePhrase,
  deletePhrase,
  getPhrasesByCategory,
  // forbidden terms
  listForbiddenTerms,
  getForbiddenTerm,
  createForbiddenTerm,
  updateForbiddenTerm,
  deleteForbiddenTerm,
  getTermsByLocale,
  // validation
  validateDraft,
};
