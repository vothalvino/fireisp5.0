// =============================================================================
// FireISP 5.0 — User row sanitizer
// =============================================================================
// Strips sensitive / internal columns from a user record before it is returned
// in any API response.  Lives in its own module (rather than as a User model
// static) so that test suites which auto-mock the User model do not replace it
// with an undefined-returning jest.fn().
// =============================================================================

const SENSITIVE_USER_FIELDS = [
  'password_hash',
  'totp_secret',
  'totp_backup_codes',
  'reset_token_hash',
  'reset_token_expires',
  'email_verify_token_hash',
];

/**
 * Return a shallow copy of a user row with sensitive columns removed.
 * Non-object inputs (null/undefined) are returned unchanged.
 *
 * @param {object|null|undefined} user
 * @returns {object|null|undefined}
 */
function sanitizeUser(user) {
  if (!user || typeof user !== 'object') return user;
  const safe = { ...user };
  for (const field of SENSITIVE_USER_FIELDS) delete safe[field];
  return safe;
}

module.exports = { sanitizeUser, SENSITIVE_USER_FIELDS };
