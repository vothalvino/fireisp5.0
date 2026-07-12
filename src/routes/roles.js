// =============================================================================
// FireISP 5.0 — Role Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createRole, updateRole, assignPermission, setPermissions } = require('../middleware/schemas/roles');
const db = require('../config/database');
const User = require('../models/User');
const { ForbiddenError, ValidationError } = require('../utils/errors');

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

// Create a role (user group). kind is required and 'admin' is rejected by
// the schema enum (src/middleware/schemas/roles.js) — see the comment there.
router.post('/', requirePermission('roles.manage'), validate(createRole), async (req, res, next) => {
  try {
    const { name, description, kind } = req.body;
    const [result] = await db.query(
      'INSERT INTO roles (name, description, kind) VALUES (?, ?, ?)',
      [name, description, kind],
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
    const { name, description, kind } = req.body;

    const [existingRows] = await db.query('SELECT * FROM roles WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    const existing = existingRows[0];
    if (!existing) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Role not found' } });
    }

    // CRITICAL: permission resolution joins roles BY NAME throughout RBAC
    // (User.getPermissions' organization_users/legacy-role branches,
    // #EFFECTIVE_PERMISSION_PREDICATE) — renaming a system role like 'admin'
    // would silently orphan every membership/legacy-role grant that keys on
    // that name. Changing which persona a system group mirrors (`kind`) is
    // just as destructive for the same reason. Description-only edits don't
    // touch either resolution path, so they stay allowed even for system
    // roles.
    if (existing.is_system) {
      if (name !== undefined && name !== existing.name) {
        return next(new ForbiddenError('System roles cannot be renamed'));
      }
      if (kind !== undefined && kind !== existing.kind) {
        return next(new ForbiddenError('The base persona (kind) of a system role cannot be changed'));
      }
    }

    // Defense in depth: updateRole's schema enum already excludes 'admin',
    // so this is currently unreachable over HTTP — but a non-system role
    // with kind 'admin' would mirror to the legacy RBAC bypass and ignore
    // its own permission list (migration 378), so re-check here too in case
    // the schema ever drifts.
    if (kind === 'admin' && !existing.is_system) {
      return next(new ForbiddenError('Only system roles may have kind admin'));
    }

    const nextName = name !== undefined ? name : existing.name;
    const nextDescription = description !== undefined ? description : existing.description;
    const nextKind = kind !== undefined ? kind : existing.kind;

    await db.query(
      'UPDATE roles SET name = ?, description = ?, kind = ? WHERE id = ? AND deleted_at IS NULL',
      [nextName, nextDescription, nextKind, req.params.id],
    );

    // A kind change re-bases every member's persona: refresh their users.role
    // mirror (drives the RBAC admin bypass, nav surface, technician dashboard)
    // and their non-owner membership rows, or members keep the OLD persona's
    // UI/bypass while the group claims the new one.
    if (nextKind !== existing.kind) {
      await db.query(
        'UPDATE users SET role = ? WHERE group_id = ? AND deleted_at IS NULL',
        [nextKind, req.params.id],
      );
      await db.query(
        `UPDATE organization_users ou
         JOIN users u ON u.id = ou.user_id AND u.deleted_at IS NULL
         SET ou.role = ?
         WHERE u.group_id = ? AND ou.deleted_at IS NULL AND ou.role != 'owner'`,
        [nextKind, req.params.id],
      );
    }

    const [rows] = await db.query('SELECT * FROM roles WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// Delete a role
router.delete('/:id', requirePermission('roles.manage'), async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM roles WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    const role = rows[0];
    if (!role) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Role not found' } });
    }
    if (role.is_system) {
      return next(new ForbiddenError('System roles cannot be deleted'));
    }

    // A group with members can't be removed out from under them. Deliberately
    // counts SOFT-DELETED users too: a later restore would revive an account
    // whose group_id points at a dead group, and permission resolution would
    // silently fall back to the by-name legacy path. (Count-then-delete has a
    // benign race with concurrent assignment; the fk_users_group FK plus this
    // guard make the damage window negligible for an admin-only endpoint.)
    const [[{ cnt }]] = await db.query(
      'SELECT COUNT(*) AS cnt FROM users WHERE group_id = ?',
      [req.params.id],
    );
    if (Number(cnt) > 0) {
      return next(new ValidationError(
        `Cannot delete this group while ${cnt} user(s) still reference it — this count includes ARCHIVED users `
        + '(reassign their group from the Users page → Archived tab, no restore needed). Groups are global, so '
        + 'the count may also include users in other organizations; switch to that organization to reassign them',
      ));
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

// Bulk-replace a role's entire permission set (used by the group editor UI
// instead of many single POST/DELETE round-trips).
router.put('/:id/permissions', requirePermission('roles.manage'), validate(setPermissions), async (req, res, next) => {
  try {
    const [roleRows] = await db.query('SELECT * FROM roles WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    const role = roleRows[0];
    if (!role) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Role not found' } });
    }

    // The admin-kind system groups ('admin', 'super_admin') pass the legacy
    // RBAC bypass (users.role === 'admin', see rbac.js) regardless of what
    // rows exist in role_permissions — their permission list is never
    // actually consulted. Letting a caller edit it would only mislead them
    // into thinking it restricts access, so block it outright (checked by
    // `kind`, not `name`, so it also covers 'super_admin').
    if (role.kind === 'admin') {
      return next(new ForbiddenError("The admin group's permissions are not editable — its access comes from the legacy admin bypass, not this list"));
    }

    const rawIds = Array.isArray(req.body.permission_ids) ? req.body.permission_ids : [];
    const requestedIds = [...new Set(rawIds.map(Number))];
    if (requestedIds.some(id => !Number.isInteger(id) || id <= 0)) {
      return next(new ValidationError('permission_ids must contain only positive integer ids'));
    }

    let requestedPerms = [];
    if (requestedIds.length > 0) {
      [requestedPerms] = await db.query(
        `SELECT p.id, p.name AS slug FROM permissions p WHERE p.id IN (${requestedIds.map(() => '?').join(',')})`,
        requestedIds,
      );
    }
    const foundIds = new Set(requestedPerms.map(p => p.id));
    const unknownIds = requestedIds.filter(id => !foundIds.has(id));
    if (unknownIds.length > 0) {
      return next(new ValidationError(`Unknown permission id(s): ${unknownIds.join(', ')}`));
    }

    // SECURITY: same privilege-amplification guard as POST /:id/permissions
    // above, applied to the DELTA of a bulk replace. A non-admin holder of
    // roles.manage may only ADD permissions they themselves hold; removals
    // are always allowed (you can never escalate by taking permissions away
    // from a group). Admins (legacy global role) may set anything.
    const [currentRows] = await db.query(
      `SELECT p.id, p.name AS slug
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ?`,
      [req.params.id],
    );
    const currentIds = new Set(currentRows.map(r => r.id));
    const addedPerms = requestedPerms.filter(p => !currentIds.has(p.id));

    if (addedPerms.length > 0 && (!req.user || req.user.role !== 'admin')) {
      const held = await User.getPermissions(req.user.id, req.orgId);
      const notHeld = addedPerms.filter(p => !held.includes(p.slug));
      if (notHeld.length > 0) {
        return next(new ForbiddenError(`You cannot grant permission(s) you do not hold: ${notHeld.map(p => p.slug).join(', ')}`));
      }
    }

    // Transactional replace: a mid-flight failure of DELETE-then-INSERT would
    // otherwise leave the group with ZERO permissions — and an empty live
    // group is authoritative (getPermissions), instantly locking out every
    // member while the response reports an error the caller may just retry.
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('DELETE FROM role_permissions WHERE role_id = ?', [req.params.id]);
      if (requestedIds.length > 0) {
        const placeholders = requestedIds.map(() => '(?, ?)').join(', ');
        const params = requestedIds.flatMap(id => [req.params.id, id]);
        await conn.execute(`INSERT INTO role_permissions (role_id, permission_id) VALUES ${placeholders}`, params);
      }
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    const [rows] = await db.query(
      `SELECT p.id, p.name AS slug, p.description
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ?
       ORDER BY p.name`,
      [req.params.id],
    );
    res.json({ data: rows });
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
