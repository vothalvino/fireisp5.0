// =============================================================================
// FireISP 5.0 — Two-Factor Authentication Validation Schemas
// =============================================================================

const verifyCode = {
  code: { type: 'string', required: true, min: 4, max: 10 },
};

module.exports = { verifyCode };
