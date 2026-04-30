// =============================================================================
// FireISP 5.0 — Auth Routes
// =============================================================================

const { Router } = require('express');
const authService = require('../services/authService');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const authSchemas = require('../middleware/schemas/auth');
const User = require('../models/User');
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
 * - fireisp_refresh       — opaque refresh token (Path=/api/v1/auth/refresh only, refresh token lifetime)
 * - fireisp_csrf_secret   — CSRF secret (httpOnly, server-only, Path=/api)
 * - fireisp_csrf          — CSRF token derived from secret (NOT httpOnly, SPA-readable, Path=/api)
 *
 * The narrow Path on the refresh cookie means the browser will only attach it
 * to the refresh endpoint, limiting its exposure surface.
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
    path: '/api/v1/auth/refresh',
    maxAge: authService.REFRESH_SECONDS * 1000,
  });
  // Set the CSRF double-submit token (not httpOnly so the SPA can read it)
  setCsrfCookie(res, authService.ACCESS_SECONDS * 1000);
}

/**
 * Clear all auth + CSRF cookies from the response.
 */
function clearAuthCookies(res) {
  res.clearCookie('fireisp_access', { ...COOKIE_BASE, path: '/api' });
  res.clearCookie('fireisp_refresh', { ...COOKIE_BASE, path: '/api/v1/auth/refresh' });
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
      const user = await authService.register(req.body);
      res.status(201).json({ data: user });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/auth/login
router.post('/login',
  validate(authSchemas.login),
  async (req, res, next) => {
    try {
      const result = await authService.login(req.body);
      // Set httpOnly cookies for the browser SPA; JSON tokens remain for API clients
      setAuthCookies(res, result.accessToken, result.refreshToken);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    // Accept refresh token from cookie (browser SPA) or body (API clients)
    const refreshToken = req.cookies?.fireisp_refresh || req.body?.refreshToken;
    if (refreshToken) {
      await authService.logout(refreshToken);
    }
    clearAuthCookies(res);
    res.json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    const { password_hash: _passwordHash, ...safeUser } = user;
    const organizations = await User.getOrganizations(req.user.id);
    res.json({ data: { ...safeUser, organizations } });
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
      const result = await authService.refreshToken(tokenValue);
      // Rotate cookies for browser SPA
      setAuthCookies(res, result.accessToken, result.refreshToken);
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
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
