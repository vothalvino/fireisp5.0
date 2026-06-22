// =============================================================================
// FireISP 5.0 — Role Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createRole, updateRole, assignPermission } = require('../middleware/schemas/roles');
const db = require('../config/database');
const User = require('../models/User');
const { ForbiddenError } = require('../utils/errors');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// List all roles
router.get('/', requirePermission('roles.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const offset = (pageNum - 1) * limitNum;

    const [rows] = await db.query(
      `SELECT * FROM roles WHERE deleted_at IS NULL ORDER BY name LIMIT ${limitNum} OFFSET ${offset}`,
    );
    const [countResult] = await db.query('SELECT COUNT(*) AS total FROM roles WHERE deleted_at IS NULL');
    const total = countResult[0].total;

    res.json({
      data: rows,
      meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
});

// List the full catalogue of assignable permissions (for role editors).
// Declared before '/:id' so the literal path is not captured as an id.
router.get('/permissions', requirePermission('roles.view'), async (_req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name AS slug, description, module FROM permissions ORDER BY module, name',
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// Get a single role with its permissions
router.get('/:id', requirePermission('roles.view'), async (req, res, next) => {
  try {
    const [roles] = await db.query('SELECT * FROM roles WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!roles[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Role not found' } });
    }

    const [permissions] = await db.query(
      `SELECT p.id, p.name AS slug, p.description
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ?
       ORDER BY p.name`,
      [req.params.id],
    );

    res.json({ data: { ...roles[0], permissions } });
  } catch (err) {
    next(err);
  }
});

// Create a role
router.post('/', requirePermission('roles.manage'), validate(createRole), async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const [result] = await db.query(
      'INSERT INTO roles (name, description) VALUES (?, ?)',
      [name, description],
    );
    const [rows] = await db.query('SELECT * FROM roles WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Update a role
router.put('/:id', requirePermission('roles.manage'), validate(updateRole), async (req, res, next) => {
  try {
    const { name, description } = req.body;
    await db.query(
      'UPDATE roles SET name = ?, description = ? WHERE id = ? AND deleted_at IS NULL',
      [name, description, req.params.id],
    );
    const [rows] = await db.query('SELECT * FROM roles WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!rows[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Role not found' } });
    }
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Delete a role
router.delete('/:id', requirePermission('roles.manage'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM roles WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!rows[0]) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Role not found' } });
    }
    await db.query('UPDATE roles SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Assign a permission to a role
router.post('/:id/permissions', requirePermission('roles.manage'), validate(assignPermission), async (req, res, next) => {
  try {
    const { permission_id } = req.body;
    // SECURITY: prevent privilege amplification. A non-admin holder of
    // roles.manage may only grant a permission they themselves hold — otherwise
    // they could attach users.update / api_tokens.create to their own role and
    // escalate. Admins (legacy global role) may grant anything.
    if (!req.user || req.user.role !== 'admin') {
      const [permRows] = await db.query('SELECT name FROM permissions WHERE id = ?', [permission_id]);
      const slug = permRows[0] && permRows[0].name;
      if (!slug) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Permission not found' } });
      }
      const held = await User.getPermissions(req.user.id, req.orgId);
      if (!held.includes(slug)) {
        return next(new ForbiddenError('You cannot grant a permission you do not hold'));
      }
    }
    await db.query(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
      [req.params.id, permission_id],
    );
    const [rows] = await db.query(
      `SELECT p.id, p.name AS slug, p.description
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ?
       ORDER BY p.name`,
      [req.params.id],
    );
    res.status(201).json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// Remove a permission from a role
router.delete('/:id/permissions/:permissionId', requirePermission('roles.manage'), async (req, res, next) => {
  try {
    await db.query(
      'DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?',
      [req.params.id, req.params.permissionId],
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
