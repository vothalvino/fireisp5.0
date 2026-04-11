// =============================================================================
// FireISP 5.0 — Authentication Middleware
// =============================================================================
// Validates JWT tokens and attaches the authenticated user to req.user.
// =============================================================================

const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');
const { UnauthorizedError } = require('../utils/errors');

/**
 * Require authentication. Attaches req.user with id, email, role, orgId, etc.
 */
async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid Authorization header');
    }

    const token = header.slice(7);
    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret);
    } catch (_err) {
      throw new UnauthorizedError('Invalid or expired token');
    }

    const user = await User.findById(payload.sub);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedError('User not found or inactive');
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: payload.orgId || user.organization_id,
    };

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Optional auth — doesn't fail if no token is present.
 */
async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next();
  }
  return authenticate(req, _res, next);
}

module.exports = { authenticate, optionalAuth };
