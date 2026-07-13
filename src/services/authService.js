// =============================================================================
// FireISP 5.0 — Auth Service
// =============================================================================

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');
const { sanitizeUser } = require('../utils/userSanitize');
const db = require('../config/database');
const emailTransport = require('./emailTransport');
const emailTemplates = require('../views/emailTemplates');
const logger = require('../utils/logger');
const { UnauthorizedError, ConflictError, ValidationError, NotFoundError } = require('../utils/errors');

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Refresh token lifetime in seconds (parsed from config, e.g. '7d' → 604800)
const REFRESH_SECONDS = parseExpiry(config.jwt.refreshExpiresIn);

// Access token lifetime in seconds (parsed from config, e.g. '15m' → 900)
const ACCESS_SECONDS = parseExpiry(config.jwt.accessExpiresIn);

/**
 * Parse a human-readable expiry string ('15m', '7d', '24h') into seconds.
 */
function parseExpiry(str) {
  if (!str) return 604800; // 7 days
  const m = String(str).match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!m) return 604800;
  const n = parseInt(m[1], 10);
  switch (m[2].toLowerCase()) {
    case 's': return n;
    case 'm': return n * 60;
    case 'h': return n * 3600;
    case 'd': return n * 86400;
    default: return 604800;
  }
}

/**
 * Generate an opaque refresh token (64-char hex string).
 */
function generateRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Atomically consume a session row and insert its rotated successor.
 *
 * One transaction, two guarantees:
 *  - The DELETE is the claim: of N concurrent redeems of the same one-shot
 *    refresh token, exactly one sees affectedRows 1; the rest get 401 instead
 *    of minting extra live session pairs (token-reuse hardening).
 *  - Rollback on a failed INSERT restores the old session row, so a DB blip
 *    mid-rotation degrades to "retry works" instead of "user force-logged-out
 *    with zero valid refresh tokens".
 *
 * @param {number} sessionId  Row id of the session being consumed.
 * @param {Array} insertParams  [user_id, token_hash, token_family, ip, ua, refreshSeconds]
 */
async function consumeAndReplaceSession(sessionId, insertParams) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [claim] = await conn.execute('DELETE FROM user_sessions WHERE id = ?', [sessionId]);
    if (!claim || claim.affectedRows === 0) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }
    await conn.execute(
      `INSERT INTO user_sessions (user_id, token_hash, token_family, ip_address, user_agent, expires_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
      insertParams,
    );
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch { /* connection already unusable */ }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Register a new user.
 */
async function register({ firstName, lastName, email, password, organizationId, role }) {
  // Check for existing email
  const existing = await User.findByEmail(email);
  if (existing) {
    throw new ConflictError('Email already registered');
  }

  if (!password || password.length < 8) {
    throw new ValidationError('Password must be at least 8 characters');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await User.create({
    first_name: firstName,
    last_name: lastName,
    email,
    password_hash: passwordHash,
    organization_id: organizationId || null,
    role: role || 'support',
  });

  // If organization provided, ensure an organization_users membership exists.
  // User.create() already mirrors roles that are valid in the membership ENUM
  // (admin/billing/technician/readonly) into a row, so use INSERT IGNORE here to
  // stay idempotent and still cover the legacy 'support' default (→ 'readonly').
  if (organizationId) {
    await db.query(
      'INSERT IGNORE INTO organization_users (organization_id, user_id, role) VALUES (?, ?, ?)',
      [organizationId, user.id, role || 'readonly'],
    );
  }

  // Generate an email-verification token (cheap, single UPDATE — kept
  // synchronous so a fresh account always has a pending token immediately)
  // and send it. The SMTP round-trip itself is intentionally NOT awaited:
  // nodemailer's connection timeout defaults to ~2 minutes, and a slow or
  // unreachable mail server must never make registration hang or vary its
  // response timing. The account row already exists at this point, so a
  // send failure is best-effort — logged server-side, never surfaced to the
  // caller — and the user can request a fresh link via
  // POST /auth/verify-email/resend.
  try {
    const { token } = await generateEmailVerificationToken(user.id);
    const verifyUrl = `${config.appUrl}/verify-email?token=${token}`;
    const userName = [firstName, lastName].filter(Boolean).join(' ') || undefined;
    const template = emailTemplates.emailVerificationEmail({ userName, verifyUrl });
    emailTransport.sendEmail({ to: email, subject: template.subject, html: template.html })
      .then((sendResult) => {
        if (!sendResult || !sendResult.success) {
          logger.warn(`Verification email failed to send to ${email}: ${sendResult && sendResult.error}`);
        }
      })
      .catch((err) => {
        logger.error(`Verification email send threw for new user ${user.id}: ${err.message}`);
      });
  } catch (err) {
    // Only the token-generation UPDATE can land here — sendEmail() above
    // never throws synchronously (it's an async function; failures reach
    // the .catch chained onto it instead).
    logger.error(`Verification email send threw for new user ${user.id}: ${err.message}`);
  }

  return sanitizeUser(user);
}

/**
 * Authenticate a user and return an access token + refresh token pair.
 */
async function login({ email, password }) {
  const user = await User.findByEmail(email);
  if (!user) {
    throw new UnauthorizedError('Invalid email or password');
  }

  if (user.status !== 'active') {
    throw new UnauthorizedError('Account is inactive');
  }

  // Check brute-force lockout
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new UnauthorizedError('Account temporarily locked due to too many failed login attempts');
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    // Increment failed attempts and potentially lock the account
    const attempts = (user.failed_login_attempts || 0) + 1;
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      await db.query(
        'UPDATE users SET failed_login_attempts = ?, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?',
        [attempts, LOCKOUT_MINUTES, user.id],
      );
    } else {
      await db.query(
        'UPDATE users SET failed_login_attempts = ? WHERE id = ?',
        [attempts, user.id],
      );
    }
    throw new UnauthorizedError('Invalid email or password');
  }

  // Reset failed attempts on successful login
  if (user.failed_login_attempts > 0 || user.locked_until) {
    await db.query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
      [user.id],
    );
  }

  // Update last_login_at
  await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

  // Get user's primary organization
  const orgs = await User.getOrganizations(user.id);
  const primaryOrg = orgs[0] || null;

  // Issue short-lived access token (JWT, 15 min default)
  const accessToken = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: primaryOrg?.id || user.organization_id,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.accessExpiresIn, algorithm: config.jwt.algorithm },
  );

  // Issue opaque refresh token + assign a token family for reuse detection
  const refreshTokenValue = generateRefreshToken();
  const family = crypto.randomUUID();
  const refreshHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');

  await db.query(
    `INSERT INTO user_sessions (user_id, token_hash, token_family, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
    [user.id, refreshHash, family, null, null, REFRESH_SECONDS],
  );

  return {
    accessToken,
    refreshToken: refreshTokenValue,
    expiresIn: ACCESS_SECONDS,
    user: sanitizeUser(user),
    organizations: orgs,
    // The org the JWT was minted for — the login route enriches the user
    // (currency/locale/group/permissions) for THIS org so the first-paint UI
    // matches what every subsequent request will be authorized against.
    activeOrganizationId: primaryOrg?.id || user.organization_id,
  };
}

/**
 * Resolve a requested active organization for a user.
 * Returns { id, name, membership_role } if the user may operate as that org, or
 * null otherwise. Admins may switch to ANY org (single-tenant / relaxed-isolation
 * model); everyone else only to orgs they are a member of. Shared by the active-org
 * re-validation on token refresh so a stale/forged `fireisp_active_org` value can
 * never escalate access.
 */
async function resolveActiveOrg(userId, userRole, requestedOrgId) {
  if (!requestedOrgId) return null;
  const [orgRows] = await db.query(
    'SELECT id, name FROM organizations WHERE id = ? AND deleted_at IS NULL',
    [requestedOrgId],
  );
  if (orgRows.length === 0) return null;
  const [memberRows] = await db.query(
    `SELECT role AS membership_role FROM organization_users
     WHERE user_id = ? AND organization_id = ? AND deleted_at IS NULL`,
    [userId, requestedOrgId],
  );
  if (memberRows.length === 0 && userRole !== 'admin') return null;
  return {
    id: orgRows[0].id,
    name: orgRows[0].name,
    membership_role: memberRows[0]?.membership_role || (userRole === 'admin' ? 'admin' : null),
  };
}

/**
 * Refresh an access token using a valid refresh token.
 * Implements rotation: the old refresh token is consumed and a new pair is issued.
 * Detects token reuse (previously rotated token) and revokes the entire family.
 *
 * `requestedActiveOrgId` (from the `fireisp_active_org` cookie) preserves the active
 * organization across refreshes/reloads; it is re-validated, never trusted blindly.
 */
async function refreshToken(currentRefreshToken, requestedActiveOrgId = null) {
  const oldHash = crypto.createHash('sha256').update(currentRefreshToken).digest('hex');

  // Look up the refresh token session
  const [sessions] = await db.query(
    'SELECT * FROM user_sessions WHERE token_hash = ?',
    [oldHash],
  );

  if (sessions.length === 0) {
    // Token not found: either invalid, already consumed (rotated), or expired and cleaned up.
    // True reuse detection requires keeping revoked sessions, which is a future enhancement.
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  const session = sessions[0];

  // Check expiry
  if (new Date(session.expires_at) <= new Date()) {
    // Expired — clean up and reject
    await db.query('DELETE FROM user_sessions WHERE id = ?', [session.id]);
    throw new UnauthorizedError('Refresh token expired');
  }

  // User must still be active
  const user = await User.findById(session.user_id);
  if (!user || user.status !== 'active') {
    throw new UnauthorizedError('User not found or inactive');
  }

  // Get user's primary organization as the fallback for the new access token
  const orgs = await User.getOrganizations(user.id);
  const primaryOrg = orgs[0] || null;
  const fallbackOrgId = primaryOrg?.id || user.organization_id;

  // Preserve the active organization across refreshes (e.g. a page reload, where
  // the SPA's in-memory access token is gone). The caller passes the org from the
  // `fireisp_active_org` cookie; we RE-VALIDATE it here so a stale or forged value
  // can never grant access to an org the user may not use — invalid → fall back.
  let activeOrgId = fallbackOrgId;
  if (requestedActiveOrgId && Number(requestedActiveOrgId) !== Number(fallbackOrgId)) {
    const resolved = await resolveActiveOrg(user.id, user.role, requestedActiveOrgId);
    if (resolved) activeOrgId = resolved.id;
  }

  // Issue new access token bound to the active organization
  const newAccessToken = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: activeOrgId,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.accessExpiresIn, algorithm: config.jwt.algorithm },
  );

  // Issue new refresh token (rotation)
  const newRefreshValue = generateRefreshToken();
  const newRefreshHash = crypto.createHash('sha256').update(newRefreshValue).digest('hex');
  const family = session.token_family;

  // Rotate: consume the old session and insert its successor in ONE
  // transaction. The DELETE is the atomic claim — when two concurrent
  // requests redeem the same token (e.g. two tabs refreshing together),
  // exactly one deletes the row; the other sees affectedRows 0 and must NOT
  // mint a second session pair from an already-consumed token (the loser's
  // client retries and succeeds with the winner's rotated cookie). The
  // transaction ensures a failed INSERT rolls the claim back — otherwise a
  // single DB blip mid-rotation would destroy the session outright, leaving
  // the user with zero valid refresh tokens.
  await consumeAndReplaceSession(session.id, [user.id, newRefreshHash, family, null, null, REFRESH_SECONDS]);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshValue,
    expiresIn: ACCESS_SECONDS,
    activeOrgId,
  };
}

/**
 * Invalidate a session (logout). Accepts a refresh token to revoke the session.
 */
async function logout(refreshTokenValue) {
  const sessionHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');
  await db.query(
    'DELETE FROM user_sessions WHERE token_hash = ?',
    [sessionHash],
  );
}

/**
 * Request a password reset. Generates a random token valid for 1 hour.
 * Returns the token (caller is responsible for emailing it).
 */
async function requestPasswordReset(email) {
  const user = await User.findByEmail(email);
  if (!user) {
    // Return silently to prevent user enumeration
    return { message: 'If that email exists, a reset link has been sent' };
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  await db.query(
    `UPDATE users SET reset_token_hash = ?, reset_token_expires = DATE_ADD(NOW(), INTERVAL 1 HOUR)
     WHERE id = ?`,
    [tokenHash, user.id],
  );

  return {
    token,
    email: user.email,
    userId: user.id,
    // For the caller (route layer) to build the email greeting without a
    // second DB round-trip.
    userName: [user.first_name, user.last_name].filter(Boolean).join(' ') || undefined,
  };
}

/**
 * Reset password using a valid token.
 */
async function resetPassword(token, newPassword) {
  if (!newPassword || newPassword.length < 8) {
    throw new ValidationError('Password must be at least 8 characters');
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const [rows] = await db.query(
    'SELECT * FROM users WHERE reset_token_hash = ? AND reset_token_expires > NOW()',
    [tokenHash],
  );

  if (rows.length === 0) {
    throw new UnauthorizedError('Invalid or expired reset token');
  }

  const user = rows[0];
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  // Clear the brute-force login lockout too: possession of the emailed reset
  // token is stronger proof of identity than a password (it required access
  // to the account's inbox), so a successful reset should break the
  // failed_login_attempts/locked_until loop from login()'s lockout logic —
  // otherwise the documented account-recovery path doesn't actually recover
  // the account, and repeatedly failing login then "recovering" becomes a
  // pointless grief/DoS loop. Both columns already exist; no migration.
  await db.query(
    `UPDATE users
        SET password_hash = ?, reset_token_hash = NULL, reset_token_expires = NULL,
            failed_login_attempts = 0, locked_until = NULL
      WHERE id = ?`,
    [passwordHash, user.id],
  );

  // Invalidate all existing sessions
  await db.query('DELETE FROM user_sessions WHERE user_id = ?', [user.id]);

  return { message: 'Password reset successfully' };
}

/**
 * Change password for an authenticated user.
 */
async function changePassword(userId, currentPassword, newPassword) {
  if (!newPassword || newPassword.length < 8) {
    throw new ValidationError('New password must be at least 8 characters');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new NotFoundError('User');
  }

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await db.query(
    'UPDATE users SET password_hash = ? WHERE id = ?',
    [passwordHash, user.id],
  );

  // Invalidate all existing sessions for this user (force re-login)
  await db.query('DELETE FROM user_sessions WHERE user_id = ?', [user.id]);

  return { message: 'Password changed successfully' };
}

/**
 * Verify email using a token (sets email_verified_at if the token is valid).
 */
async function verifyEmail(token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const [rows] = await db.query(
    'SELECT * FROM users WHERE email_verify_token_hash = ?',
    [tokenHash],
  );

  if (rows.length === 0) {
    throw new UnauthorizedError('Invalid verification token');
  }

  await db.query(
    'UPDATE users SET email_verified_at = NOW(), email_verify_token_hash = NULL WHERE id = ?',
    [rows[0].id],
  );

  return { message: 'Email verified successfully' };
}

/**
 * Switch the active organization for a user who belongs to multiple
 * organizations.  The caller proves possession of the current refresh token,
 * which we rotate (within the same family) so the previous tokens are
 * invalidated immediately.  A new access token is minted with `orgId` set to
 * the requested organization.
 *
 * Throws ForbiddenError if the user is not a member of the target org.
 */
async function switchOrganization(userId, organizationId, currentRefreshToken) {
  const { ForbiddenError } = require('../utils/errors');

  if (!organizationId) {
    throw new ValidationError('organizationId is required');
  }

  // User must still be active.
  const user = await User.findById(userId);
  if (!user || user.status !== 'active') {
    throw new UnauthorizedError('User not found or inactive');
  }

  // Target org must exist and not be soft-deleted.
  const [orgRows] = await db.query(
    'SELECT id, name FROM organizations WHERE id = ? AND deleted_at IS NULL',
    [organizationId],
  );
  if (orgRows.length === 0) {
    throw new ForbiddenError('Organization not found');
  }
  const targetOrg = orgRows[0];

  // Membership is required for non-admins. Admins may switch to ANY organization
  // (single-tenant / relaxed-isolation model: one operator can manage every ISP).
  const [memberRows] = await db.query(
    `SELECT role AS membership_role FROM organization_users
     WHERE user_id = ? AND organization_id = ? AND deleted_at IS NULL`,
    [userId, organizationId],
  );
  if (memberRows.length === 0 && user.role !== 'admin') {
    throw new ForbiddenError('User is not a member of the requested organization');
  }
  const membership = {
    org_id: targetOrg.id,
    org_name: targetOrg.name,
    membership_role: memberRows[0]?.membership_role || (user.role === 'admin' ? 'admin' : null),
  };

  // Validate + rotate the refresh token.  We require the current refresh token
  // so a stolen access token alone cannot be used to pivot to another org.
  if (!currentRefreshToken) {
    throw new UnauthorizedError('Refresh token required to switch organizations');
  }
  const oldHash = crypto.createHash('sha256').update(currentRefreshToken).digest('hex');
  const [sessions] = await db.query(
    'SELECT * FROM user_sessions WHERE token_hash = ? AND user_id = ?',
    [oldHash, userId],
  );
  if (sessions.length === 0) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }
  const session = sessions[0];
  if (new Date(session.expires_at) <= new Date()) {
    await db.query('DELETE FROM user_sessions WHERE id = ?', [session.id]);
    throw new UnauthorizedError('Refresh token expired');
  }

  // Mint new access token bound to the requested organization.
  const newAccessToken = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: membership.org_id,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.accessExpiresIn, algorithm: config.jwt.algorithm },
  );

  // Rotate refresh token within the same family. As in refreshToken(): the
  // DELETE is the atomic claim (a concurrent redeem loses instead of minting
  // a duplicate pair) and the transaction rolls the claim back if the INSERT
  // fails, so a DB blip can't destroy the session.
  const newRefreshValue = generateRefreshToken();
  const newRefreshHash = crypto.createHash('sha256').update(newRefreshValue).digest('hex');
  await consumeAndReplaceSession(session.id, [user.id, newRefreshHash, session.token_family, null, null, REFRESH_SECONDS]);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshValue,
    expiresIn: ACCESS_SECONDS,
    organization: {
      id: membership.org_id,
      name: membership.org_name,
      membership_role: membership.membership_role,
    },
  };
}

/**
 * Generate an email verification token for a user.
 */
async function generateEmailVerificationToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  await db.query(
    'UPDATE users SET email_verify_token_hash = ? WHERE id = ?',
    [tokenHash, userId],
  );

  return { token };
}

/**
 * Resend the email-verification link for the currently authenticated user.
 * No-op fast path when the address is already verified — avoids generating a
 * fresh token and sending an email that would go straight to an already
 * confirmed inbox.
 */
async function resendVerificationEmail(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new NotFoundError('User');
  }

  if (user.email_verified_at) {
    return { message: 'Email already verified', alreadyVerified: true };
  }

  const { token } = await generateEmailVerificationToken(user.id);
  const verifyUrl = `${config.appUrl}/verify-email?token=${token}`;
  const userName = [user.first_name, user.last_name].filter(Boolean).join(' ') || undefined;
  const template = emailTemplates.emailVerificationEmail({ userName, verifyUrl });

  // Detached — see register() above: the SMTP round-trip must never sit on
  // the response critical path (nodemailer's connection timeout defaults to
  // ~2 minutes). sendEmail() is an async function, so a failure can only
  // ever surface via this .catch, never as an unhandled rejection.
  emailTransport.sendEmail({ to: user.email, subject: template.subject, html: template.html })
    .then((sendResult) => {
      if (!sendResult || !sendResult.success) {
        logger.warn(`Verification email resend failed for ${user.email}: ${sendResult && sendResult.error}`);
      }
    })
    .catch((err) => {
      logger.error(`Verification email resend threw for user ${user.id}: ${err.message}`);
    });

  return { message: 'Verification email sent' };
}

module.exports = {
  register, login, logout, refreshToken, switchOrganization,
  requestPasswordReset, resetPassword, changePassword,
  verifyEmail, generateEmailVerificationToken, resendVerificationEmail,
  // Exported for cookie maxAge calculations in auth routes
  REFRESH_SECONDS,
  ACCESS_SECONDS,
};
