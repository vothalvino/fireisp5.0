// =============================================================================
// FireISP 5.0 — Auth Routes
// =============================================================================

const { Router } = require('express');
const authService = require('../services/authService');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const User = require('../models/User');

const router = Router();

// POST /api/auth/register
router.post('/register',
  validate({
    firstName: { type: 'string', required: true, min: 1, max: 100 },
    lastName: { type: 'string', required: true, min: 1, max: 100 },
    email: { type: 'email', required: true },
    password: { type: 'string', required: true, min: 8 },
  }),
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
  validate({
    email: { type: 'email', required: true },
    password: { type: 'string', required: true },
  }),
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
    const { password_hash: _ph, ...safeUser } = user;
    const organizations = await User.getOrganizations(req.user.id);
    res.json({ data: { ...safeUser, organizations } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
