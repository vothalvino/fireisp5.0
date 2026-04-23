// =============================================================================
// FireISP 5.0 — Portal Authentication Middleware
// =============================================================================
// Validates a portal JWT token and attaches req.client with:
//   { id, organizationId, type: 'portal' }
//
// Portal tokens carry { type: 'portal' } in the payload. They are explicitly
// rejected by the staff authenticate() middleware, and staff tokens are
// rejected here, ensuring full isolation between the two auth surfaces.
// =============================================================================

const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../config/database');
const { UnauthorizedError } = require('../utils/errors');

/**
 * Require portal authentication.
 * Sets req.client = { id, organizationId }.
 */
async function portalAuthenticate(req, _res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid Authorization header');
    }

    const token = header.slice(7);
    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret);
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }

    if (payload.type !== 'portal') {
      throw new UnauthorizedError('Invalid token type');
    }

    const [rows] = await db.query(
      'SELECT id, organization_id, name, email, status FROM clients WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [payload.sub],
    );

    const client = rows[0];
    if (!client || client.status === 'inactive') {
      throw new UnauthorizedError('Client not found or inactive');
    }

    req.client = {
      id: client.id,
      organizationId: client.organization_id,
      name: client.name,
      email: client.email,
    };

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { portalAuthenticate };
