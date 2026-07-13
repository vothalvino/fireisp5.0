// =============================================================================
// FireISP 5.0 — RADIUS row sanitizer
// =============================================================================
// Strips the cleartext PPPoE `password` column from a `radius` record before
// it is returned by any endpoint that is not gated by
// `radius.credentials.view` (see src/routes/radius.js). Lives in its own
// module (rather than only as a Radius model static) so that test suites
// which auto-mock the Radius model do not replace it with an
// undefined-returning jest.fn() — mirrors src/utils/userSanitize.js.
// =============================================================================

/**
 * Return a shallow copy of a radius row with the cleartext password removed.
 * Non-object inputs (null/undefined) are returned unchanged.
 *
 * @param {object|null|undefined} record
 * @returns {object|null|undefined}
 */
function sanitizeRadius(record) {
  if (!record || typeof record !== 'object') return record;
  const safe = { ...record };
  delete safe.password;
  return safe;
}

module.exports = { sanitizeRadius };
