// =============================================================================
// FireISP 5.0 — Auth Routes
// =============================================================================

const { Router } = require('express');
const authService = require('../services/authService');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const authSchemas = require('../middleware/schemas/auth');
const User = require('../models/User');
const Organization = require('../models/Organization');
const { sanitizeUser } = require('../utils/userSanitize');
const config = require('../config');
const { setCsrfCookie, clearCsrfCookie } = require('../middleware/csrf');

const router = Router();

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

const COOKIE_BASE = {
  httpOnly: true,
  sameSite: 'strict',
  // Only send over HTTPS in production; allows plain-HTTP in development
  secure: config.env === 'production',
};

/**
 * Set httpOnly SameSite=Strict auth cookies on the response.
 * - fireisp_access        — short-lived JWT (Path=/api, access token lifetime)
 * - fireisp_refresh       — opaque refresh token (Path=/api/v1/auth, refresh token lifetime)
 * - fireisp_csrf_secret   — CSRF secret (httpOnly, server-only, Path=/api)
 * - fireisp_csrf          — CSRF token derived from secret (NOT httpOnly, SPA-readable, Path=/api)
 *
 * The Path on the refresh cookie limits its exposure surface to the auth
 * endpoints under /api/v1/auth — notably /refresh and /switch-organization,
 * both of which require the current refresh token to re-mint tokens. Do NOT
 * narrow this back to /refresh: /switch-organization would then never receive
 * the cookie and would fail with "Refresh token required to switch organizations".
 *
 * The SPA reads `fireisp_csrf` and sends it as the `X-CSRF-Token` header on
 * every state-changing request.  The server verifies it against the secret.
 */
function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie('fireisp_access', accessToken, {
    ...COOKIE_BASE,
    path: '/api',
    maxAge: authService.ACCESS_SECONDS * 1000,
  });
  res.cookie('fireisp_refresh', refreshToken, {
    ...COOKIE_BASE,
    // Scoped to /api/v1/auth (not just /refresh) so the browser also attaches it
    // to /switch-organization, which requires the current refresh token to
    // re-mint tokens bound to the new org. See clearAuthCookies + the doc above.
    path: '/api/v1/auth',
    maxAge: authService.REFRESH_SECONDS * 1000,
  });
  // Set the CSRF double-submit token (not httpOnly so the SPA can read it)
  setCsrfCookie(res, authService.ACCESS_SECONDS * 1000);
}

/**
 * Persist the active organization so it survives a token refresh / page reload.
 *
 * The SPA keeps the access token in memory only (wiped on reload), so without this
 * the active org would revert to the user's primary org on the next /refresh. We
 * store it in an httpOnly cookie scoped to /api/v1/auth/refresh — the only endpoint
 * that reads it — and authService.refreshToken RE-VALIDATES the value, so the cookie
 * being client-visible-as-a-name cannot escalate access. The SPA never needs to read
 * it (it learns the active org from /auth/me), hence httpOnly.
 */
function setActiveOrgCookie(res, orgId) {
  if (orgId === null || orgId === undefined) return;
  res.cookie('fireisp_active_org', String(orgId), {
    ...COOKIE_BASE,
    path: '/api/v1/auth/refresh',
    maxAge: authService.REFRESH_SECONDS * 1000,
  });
}

/**
 * Clear all auth + CSRF cookies from the response.
 */
function clearAuthCookies(res) {
  res.clearCookie('fireisp_access', { ...COOKIE_BASE, path: '/api' });
  res.clearCookie('fireisp_refresh', { ...COOKIE_BASE, path: '/api/v1/auth' });
  res.clearCookie('fireisp_active_org', { ...COOKIE_BASE, path: '/api/v1/auth/refresh' });
  clearCsrfCookie(res);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// POST /api/auth/register
router.post('/register',
  validate(authSchemas.register),
  async (req, res, next) => {
    try {
      // SECURITY: only forward the public-registration fields. Never pass the
      // raw body through — `role` / `organizationId` are honoured by
      // authService.register, so an anonymous caller supplying role:'admin'
      // would otherwise self-register as a platform administrator.
      const { firstName, lastName, email, password } = req.body;
      const user = await authService.register({ firstName, lastName, email, password });
      res.status(201).json({ data: user });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/auth/login
/**
 * Attach the org- and group-derived fields the SPA needs on first paint:
 * currency, compliance locale, the user's group {id, name, kind}, and the
 * resolved permission list (drives action-button visibility via can()).
 * Shared by /auth/login and /auth/me so both responses stay in lockstep —
 * a field present only in /me hides UI until a manual refresh (see the
 * organization_locale regression fixed in #378's review).
 */
async function enrichAuthUser(user, activeOrgId) {
  const db = require('../config/database');
  let group = null;
  if (user.group_id) {
    const [[row]] = await db.query(
      'SELECT id, name, kind FROM roles WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [user.group_id],
    );
    group = row || null;
  }
  return {
    ...user,
    organization_currency: activeOrgId ? await Organization.getCurrency(activeOrgId) : 'MXN',
    organization_locale: activeOrgId ? await Organization.getLocale(activeOrgId) : 'global',
    group,
    permissions: activeOrgId ? await User.getPermissions(user.id, activeOrgId) : [],
  };
}

router.post('/login',
  validate(authSchemas.login),
  async (req, res, next) => {
    try {
      const result = await authService.login(req.body);
      if (result.user) {
        // Enrich for the org the JWT was minted for (primary membership org,
        // falling back to the home org) — NOT blindly the home org, which can
        // differ for membership-only users and would show the wrong
        // currency/locale/permissions until the first /auth/me.
        const activeOrgId = result.activeOrganizationId ?? result.user.organization_id;
        result.user = await enrichAuthUser(result.user, activeOrgId);
      }
      // Set httpOnly cookies for the browser SPA; JSON tokens remain for API clients
      setAuthCookies(res, result.accessToken, result.refreshToken);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/auth/logout
// Deliberately NOT authenticate-gated: after the 60-minute access token
// expires, a token-gated logout 401s without revoking anything — the
// still-valid 7-day refresh cookie then silently re-authenticates the user
// on the next visit, making logout a no-op exactly when it matters most.
// The refresh token itself is the credential here: we only revoke a session
// the caller can present.
//
// Cookie clearing is gated on browser-bound session context (an auth cookie
// or a Bearer header — neither can be attached by a cross-site form POST,
// since the cookies are SameSite=Strict and custom headers need CORS). A
// bare cross-site POST therefore gets a 200 with NO Set-Cookie headers;
// without this gate, an attacker page could force-logout a victim, because
// browsers APPLY Set-Cookie from cross-site responses even though they
// don't SEND SameSite=Strict cookies with the request. A body refreshToken
// (attacker-suppliable via cross-site form) revokes only the session it
// itself names — self-harm — and never triggers cookie clearing.
router.post('/logout', validate(authSchemas.refreshToken), async (req, res, next) => {
  try {
    // Accept refresh token from cookie (browser SPA) or body (API clients)
    const cookieToken = req.cookies?.fireisp_refresh;
    const bodyToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined;
    const refreshToken = cookieToken || bodyToken;
    if (refreshToken) {
      await authService.logout(refreshToken);
    }
    const hasBearer = typeof req.headers?.authorization === 'string' &&
      req.headers.authorization.startsWith('Bearer ');
    if (cookieToken || req.cookies?.fireisp_access || hasBearer) {
      clearAuthCookies(res);
    }
    res.json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    const safeUser = sanitizeUser(user);
    const organizations = await User.getOrganizations(req.user.id);
    // Report the ACTIVE organization (from the access-token `orgId` claim), not the
    // user's stored home org — otherwise the org switcher snaps back after a switch.
    const activeOrgId = req.user.organizationId ?? safeUser.organization_id;
    // The active org's currency, fetched directly. NOT derived from `organizations`
    // (which lists only the user's memberships): a super-admin can switch to an org
    // they are not a member of, and its currency would otherwise be unavailable —
    // making every such org fall back to the default currency in the UI.
    const enriched = await enrichAuthUser(safeUser, activeOrgId);
    res.json({
      data: {
        ...enriched,
        organization_id: activeOrgId,
        organizations,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/password-reset/request — request a password reset email
router.post('/password-reset/request',
  validate(authSchemas.requestPasswordReset),
  async (req, res, next) => {
    try {
      const result = await authService.requestPasswordReset(req.body.email);
      // Always return success to prevent user enumeration
      res.json({ message: result.message || 'If that email exists, a reset link has been sent' });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/auth/password-reset — reset password with token
router.post('/password-reset',
  validate(authSchemas.resetPassword),
  async (req, res, next) => {
    try {
      const result = await authService.resetPassword(req.body.token, req.body.password);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/auth/change-password — change password for authenticated user
router.post('/change-password', authenticate,
  validate(authSchemas.changePassword),
  async (req, res, next) => {
    try {
      const result = await authService.changePassword(req.user.id, req.body.currentPassword, req.body.newPassword);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/auth/verify-email — verify email with token
router.post('/verify-email',
  validate(authSchemas.verifyEmail),
  async (req, res, next) => {
    try {
      const result = await authService.verifyEmail(req.body.token);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/auth/refresh — rotate access token using refresh token
// Accepts the refresh token from the httpOnly cookie (browser SPA) or
// request body (API clients / programmatic callers).
router.post('/refresh',
  validate(authSchemas.refreshToken),
  async (req, res, next) => {
    try {
      // Prefer the httpOnly cookie; fall back to explicit body field
      const tokenValue = req.cookies?.fireisp_refresh || req.body?.refreshToken;
      if (!tokenValue) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Refresh token required' } });
      }
      // Pass the active-org cookie so a reload-triggered refresh keeps the
      // switched org instead of reverting to the user's primary org.
      const result = await authService.refreshToken(tokenValue, req.cookies?.fireisp_active_org);
      // Rotate cookies for browser SPA
      setAuthCookies(res, result.accessToken, result.refreshToken);
      // Re-persist the (re-validated) active org so it keeps surviving reloads.
      setActiveOrgCookie(res, result.activeOrgId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/auth/switch-organization — switch the active organization for a
// user with multiple memberships.  Mints a new access token whose `orgId`
// claim is the requested organization, and rotates the refresh token within
// the same family.  The user must currently be a member of the target org.
router.post('/switch-organization', authenticate,
  validate(authSchemas.switchOrganization),
  async (req, res, next) => {
    try {
      // Accept refresh token from cookie (browser SPA) or body (API clients)
      const refreshToken = req.cookies?.fireisp_refresh || req.body?.refreshToken;
      const result = await authService.switchOrganization(
        req.user.id,
        req.body.organizationId,
        refreshToken,
      );
      // Rotate cookies for browser SPA
      setAuthCookies(res, result.accessToken, result.refreshToken);
      // Persist the new active org so a later /refresh (page reload) keeps it.
      setActiveOrgCookie(res, result.organization.id);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
