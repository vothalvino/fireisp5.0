// =============================================================================
// FireISP 5.0 — Auth Validation Schemas
// =============================================================================

const register = {
  firstName: { type: 'string', required: true, min: 1, max: 100 },
  lastName: { type: 'string', required: true, min: 1, max: 100 },
  email: { type: 'email', required: true },
  password: { type: 'string', required: true, min: 8 },
};

const login = {
  email: { type: 'email', required: true },
  password: { type: 'string', required: true },
};

const requestPasswordReset = {
  email: { type: 'email', required: true },
};

const resetPassword = {
  token: { type: 'string', required: true },
  password: { type: 'string', required: true, min: 8 },
};

const changePassword = {
  currentPassword: { type: 'string', required: true },
  newPassword: { type: 'string', required: true, min: 8 },
};

const verifyEmail = {
  token: { type: 'string', required: true },
};

const refreshToken = {
  token: { type: 'string', required: true },
};

module.exports = { register, login, requestPasswordReset, resetPassword, changePassword, verifyEmail, refreshToken };
