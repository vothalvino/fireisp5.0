// =============================================================================
// FireISP 5.0 — Auth Routes
// =============================================================================

const { Router } = require('express');
const authService = require('../services/authService');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const authSchemas = require('../middleware/schemas/auth');
const User = require('../models/User');

const router = Router();

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
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const token = req.headers.authorization?.slice(7);
    await authService.logout(token);
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

// POST /api/auth/refresh — rotate access token (refresh token rotation)
router.post('/refresh',
  validate(authSchemas.refreshToken),
  async (req, res, next) => {
    try {
      const result = await authService.refreshToken(req.body.token);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
