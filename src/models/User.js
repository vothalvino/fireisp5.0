// =============================================================================
// FireISP 5.0 — User Model
// =============================================================================

const BaseModel = require('./BaseModel');

// Roles that are valid values for the `organization_users.role` ENUM
// (owner, admin, manager, technician, billing, readonly, support — 'support'
// added by migration 378 so support-kind groups can be mirrored).
const ORG_MEMBERSHIP_ROLES = new Set(['owner', 'admin', 'manager', 'technician', 'billing', 'readonly', 'support']);

class User extends BaseModel {
  static get tableName() { return 'users'; }

  static get fillable() {
    return [
      'organization_id', 'first_name', 'last_name', 'email',
      'password_hash', 'role', 'group_id', 'phone', 'status',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  /**
   * Create a user, then mirror their role into an `organization_users`
   * membership row so RBAC (which resolves via organization_users) works and the
   * account appears under its organization in /auth/me. Without this, a staff
   * user created through the admin UI got only a `users` row and therefore had
   * NO effective permissions — every gated endpoint 403'd ("everything fails to
   * load"). Idempotent and safe: INSERT IGNORE against the soft-delete-aware
   * unique key, and only for roles valid in the organization_users.role ENUM.
   */
  static async create(data) {
    await User.resolveGroupMirror(data);
    const user = await super.create(data);
    await User.syncOrgMembership(user);
    return user;
  }

  /**
   * Keep users.group_id (authoritative, migration 378) and the legacy
   * users.role mirror in sync, whichever the caller supplied:
   *   - group_id given → role is forced to the group's kind (the legacy name
   *     ~40 backend and ~35 frontend call sites still key on);
   *   - only role given (legacy API callers, seeds) → group_id resolves to the
   *     same-named system group so permissions flow through the group path.
   * Throws ValidationError for a missing/deleted group or one without a kind
   * (pre-378 custom rows must be given a kind before they become assignable).
   * Mutates and returns `data`.
   */
  static async resolveGroupMirror(data) {
    if (!data) return data;
    const db = require('../config/database');
    const { ValidationError } = require('../utils/errors');

    if (data.group_id !== undefined && data.group_id !== null) {
      const [[group]] = await db.query(
        'SELECT id, name, kind FROM roles WHERE id = ? AND deleted_at IS NULL LIMIT 1',
        [data.group_id],
      );
      if (!group) throw new ValidationError('group_id does not reference an existing user group');
      if (!group.kind) {
        throw new ValidationError(`User group "${group.name}" has no kind — set its base persona before assigning it`);
      }
      data.role = group.kind;
    } else if (data.role) {
      const [[group]] = await db.query(
        'SELECT id FROM roles WHERE name = ? AND is_system = TRUE AND deleted_at IS NULL LIMIT 1',
        [data.role],
      );
      if (group) data.group_id = group.id;
    }
    return data;
  }

  /**
   * Ensure an `organization_users` membership row exists for the user that
   * mirrors their legacy users.role. No-op when the user has no org / role, or
   * when the role is not a valid organization_users.role value (e.g. 'support',
   * which is covered by the users.role permission fallback instead).
   */
  static async syncOrgMembership(user) {
    if (!user || !user.organization_id || !user.role) return;
    if (!ORG_MEMBERSHIP_ROLES.has(user.role)) return;
    const db = require('../config/database');
    await db.query(
      `INSERT IGNORE INTO organization_users (organization_id, user_id, role)
       VALUES (?, ?, ?)`,
      [user.organization_id, user.id, user.role],
    );
  }

  /**
   * ARCHIVE a staff account (the users API's DELETE): soft-delete PLUS forcing
   * status='inactive' in the same statement, so a later restore never revives
   * a login-able account — restored users come back inactive and must be
   * re-activated explicitly. Archived users cannot authenticate twice over:
   * findByEmail/findById exclude soft-deleted rows, and every auth path also
   * checks status === 'active'.
   */
  static async delete(id, orgId = null) {
    const db = require('../config/database');
    const { NotFoundError } = require('../utils/errors');
    let sql = "UPDATE users SET deleted_at = NOW(), status = 'inactive' WHERE id = ? AND deleted_at IS NULL";
    const params = [id];
    if (orgId !== null && this.hasOrgScope) {
      sql += ' AND organization_id = ?';
      params.push(orgId);
    }
    const [result] = await db.query(sql, params);
    if (result.affectedRows === 0) throw new NotFoundError(this.tableName);
    return true;
  }

  /**
   * Strip sensitive / internal columns from a user row before returning it in
   * any API response.  Delegates to src/utils/userSanitize so the logic still
   * works when test suites auto-mock the User model.
   */
  static sanitize(user) {
    return require('../utils/userSanitize').sanitizeUser(user);
  }

  static async findByEmail(email) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM users WHERE email = ? AND deleted_at IS NULL',
      [email],
    );
    return rows[0] || null;
  }

  /**
   * Get all permissions for a user in an organization.
   *
   * Resolution order (migration 378):
   *   1. users.group_id — AUTHORITATIVE when the user has a live group and can
   *      access the org (homed there or holding a membership row). An empty
   *      group deliberately yields [] — it does NOT fall through, so a custom
   *      group that denies everything really denies everything.
   *   2. organization_users membership role → roles-by-name (pre-378 path).
   *   3. Legacy users.role, only for users homed in the org.
   */
  static async getPermissions(userId, organizationId) {
    const db = require('../config/database');

    // 1. Group path — resolve access + live group first so an empty permission
    //    set is authoritative rather than falling through to legacy grants.
    const [[groupUser]] = await db.query(`
      SELECT g.id AS group_id,
             (u.organization_id = ? OR EXISTS (
               SELECT 1 FROM organization_users ou
               WHERE ou.user_id = u.id AND ou.organization_id = ? AND ou.deleted_at IS NULL
             )) AS has_access
      FROM users u
      JOIN roles g ON g.id = u.group_id AND g.deleted_at IS NULL
      WHERE u.id = ? AND u.deleted_at IS NULL
      LIMIT 1
    `, [organizationId, organizationId, userId]);
    if (groupUser && Number(groupUser.has_access)) {
      const [groupPerms] = await db.query(`
        SELECT DISTINCT p.name AS slug
        FROM role_permissions rp
        JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = ?
      `, [groupUser.group_id]);
      return groupPerms.map(r => r.slug);
    }

    const [rows] = await db.query(`
      SELECT DISTINCT p.name AS slug
      FROM organization_users ou
      JOIN roles r ON r.id = (
        SELECT r2.id FROM roles r2 WHERE r2.name = ou.role AND r2.deleted_at IS NULL LIMIT 1
      )
      JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ou.user_id = ? AND ou.organization_id = ?
        AND ou.deleted_at IS NULL
    `, [userId, organizationId]);
    if (rows.length > 0) return rows.map(r => r.slug);

    // Fallback: no organization_users membership row for this user/org. Resolve
    // permissions from the legacy users.role so a staff account that was created
    // without an explicit membership (admin-UI-created users, single-tenant
    // installs) still receives its role's permissions instead of being silently
    // locked out of every page. Mirrors the admin RBAC bypass, which already
    // trusts users.role. Only used when the membership path returns nothing, so
    // multi-tenant memberships always take precedence.
    const [fallback] = await db.query(`
      SELECT DISTINCT p.name AS slug
      FROM users u
      JOIN roles r ON r.name = u.role AND r.deleted_at IS NULL
      JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE u.id = ? AND u.organization_id = ? AND u.deleted_at IS NULL
    `, [userId, organizationId]);
    return fallback.map(r => r.slug);
  }

  /**
   * SQL predicate: is the user (aliased `u`, LEFT-JOINed to their
   * `organization_users` row FOR THE TARGET ORG as `ou`) authorized for a
   * permission in that org? Mirrors requirePermission() + getPermissions():
   *   1. a legacy `users.role = 'admin'` bypasses RBAC (the 378 mirror keeps
   *      this equivalent to "member of an admin-kind group or legacy admin");
   *   2. else the user's GROUP (users.group_id, migration 378) is authoritative
   *      when it is live — including when it grants nothing, so the legacy
   *      branches below only apply to users with no live group;
   *   3. else the org-membership role, when it resolves to a live role that
   *      grants at least one permission (getPermissions' pre-378 path);
   *   4. else fall back to the legacy users.role, but only for users homed in
   *      the target org (getPermissions' fallback queries WHERE u.organization_id).
   * Callers must LEFT JOIN ou ON the TARGET org (not the user's home org) so
   * cross-org memberships (SSO-provisioned or switch-organization users) are
   * honoured, and must additionally scope to users connected to the org:
   * `(u.organization_id = ? OR ou.id IS NOT NULL)`. That scoping deliberately
   * excludes membership-less legacy admins homed in OTHER orgs — they could
   * technically pass requirePermission anywhere, but tenant isolation must win
   * for assignment/listing purposes.
   * Bind order inside the predicate:
   * [permissionSlug (group), permissionSlug (membership), organizationId, permissionSlug (legacy)].
   */
  static get #EFFECTIVE_PERMISSION_PREDICATE() {
    return `(
      u.role = 'admin'
      OR EXISTS (
        SELECT 1 FROM roles g
        JOIN role_permissions rpg ON rpg.role_id = g.id
        JOIN permissions pg ON pg.id = rpg.permission_id
        WHERE g.id = u.group_id
          AND g.deleted_at IS NULL
          AND pg.name = ?
      )
      OR (
        NOT EXISTS (
          SELECT 1 FROM roles g2 WHERE g2.id = u.group_id AND g2.deleted_at IS NULL
        )
        AND (
          EXISTS (
            SELECT 1 FROM roles r
            JOIN role_permissions rp ON rp.role_id = r.id
            JOIN permissions p ON p.id = rp.permission_id
            WHERE r.name = ou.role
              AND r.deleted_at IS NULL
              AND p.name = ?
          )
          OR (
            u.organization_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM roles r2
              JOIN role_permissions rp2 ON rp2.role_id = r2.id
              WHERE r2.name = ou.role AND r2.deleted_at IS NULL
            )
            AND EXISTS (
              SELECT 1 FROM roles r3
              JOIN role_permissions rp3 ON rp3.role_id = r3.id
              JOIN permissions p3 ON p3.id = rp3.permission_id
              WHERE r3.name = u.role
                AND r3.deleted_at IS NULL
                AND p3.name = ?
            )
          )
        )
      )
    )`;
  }

  /**
   * List active users authorized for `permissionSlug` in an organization: users
   * homed in the org plus cross-org members with a live organization_users row
   * (see #EFFECTIVE_PERMISSION_PREDICATE). Used to populate "assignable user"
   * pickers — e.g. only staff who can actually work with work orders should be
   * selectable as a work order's assignee.
   * Bind order: [orgId (ou join), orgId (connected), slug, slug, orgId, slug].
   */
  static async getUsersWithPermission(organizationId, permissionSlug) {
    const db = require('../config/database');
    const [rows] = await db.query(`
      SELECT DISTINCT u.id, u.first_name, u.last_name, u.email
      FROM users u
      LEFT JOIN organization_users ou
        ON ou.user_id = u.id AND ou.organization_id = ? AND ou.deleted_at IS NULL
      WHERE u.deleted_at IS NULL
        AND u.status = 'active'
        AND (u.organization_id = ? OR ou.id IS NOT NULL)
        AND ${User.#EFFECTIVE_PERMISSION_PREDICATE}
      ORDER BY u.first_name, u.last_name
    `, [organizationId, organizationId, permissionSlug, permissionSlug, organizationId, permissionSlug]);
    return rows;
  }

  /**
   * Staff recipients for a set of legacy role names, resolved the RBAC-
   * authoritative way (migration 400) instead of querying `users.role`
   * directly: an `organization_users` membership row for the TARGET org is
   * authoritative when one exists (its `role`, not the user's legacy role,
   * decides inclusion); only a user with NO membership row falls back to
   * their legacy `users.role`, and only when they are homed in this org.
   * Mirrors `getUsersWithPermission`'s `LEFT JOIN organization_users` shape,
   * keyed on role name instead of permission slug. Used by
   * `notificationHooks.resolveStaffRecipients()` for bell/email fan-out
   * (device online/offline, alert triggered/escalated, outage
   * reported/resolved, ip_pool.threshold).
   *
   * `organization_users.role` is a SUPERSET ENUM of `users.role` — it also
   * allows `'owner'` and `'manager'`, neither of which is a valid `users.role`
   * value, so no caller can ever pass them in `roles`. Without special
   * handling, an ORG OWNER (organization_users.role='owner') requesting
   * `roles=['admin', ...]` would fail BOTH branches: the membership branch
   * (`'owner'` isn't in the requested list) AND the legacy-fallback branch
   * (they DO have a membership row, so the fallback never applies to them) —
   * silently dropped from every notification. This is not hypothetical: the
   * default install (`src/scripts/seed.js`) creates user 1 with
   * `users.role='admin'` + `organization_users.role='owner'` for org 1 — the
   * exact shape that regresses. Fix: when the caller asks for `'admin'`,
   * ALSO match a membership role of `'owner'` — 'owner' outranks 'admin'
   * everywhere else in this codebase (`requireRole('owner','admin')`
   * patterns, `userTunnelService`'s `ou.role IN ('owner','admin')`,
   * `roles.js`'s owner guards). This expansion applies ONLY to the
   * membership branch (`'owner'` can never appear in the legacy branch,
   * since it isn't a `users.role` value).
   *
   * Deliberately does NOT expand `'manager'` the same way: a user whose
   * membership role is `'manager'` (even with a legacy `users.role` of
   * `'admin'`) is intentionally EXCLUDED — their authoritative role really is
   * manager, and this codebase's admin-tier shortcuts are owner/admin only.
   * (Under the OLD users.role-only query, such a user WAS included via the
   * legacy shortcut; this is a deliberate product-semantics change now that
   * resolution is membership-authoritative, not a regression.)
   *
   * Deliberately does NOT filter `email IS NOT NULL` — a staffer with no
   * email on file must still receive an in-app bell row; callers gate their
   * own email leg on `recipient.email` truthiness.
   *
   * Cross-org members (homed in another organization, holding a membership
   * row for THIS org) ARE included — same precedent as
   * `getUsersWithPermission`/`hasEffectivePermission`.
   *
   * Bind order: [orgId (ou join), ...membershipRoles (membership branch,
   * 'owner'-expanded when 'admin' was requested), orgId (homed-fallback
   * branch), ...roles (legacy-role branch, UN-expanded)].
   */
  static async getStaffByEffectiveRole(organizationId, roles) {
    const db = require('../config/database');
    const membershipRoles = roles.includes('admin')
      ? [...new Set([...roles, 'owner'])]
      : roles;
    const membershipPlaceholders = membershipRoles.map(() => '?').join(', ');
    const legacyPlaceholders = roles.map(() => '?').join(', ');
    const [rows] = await db.query(`
      SELECT DISTINCT u.id, u.email, u.first_name
      FROM users u
      LEFT JOIN organization_users ou
        ON ou.user_id = u.id AND ou.organization_id = ? AND ou.deleted_at IS NULL
      WHERE u.status = 'active' AND u.deleted_at IS NULL
        AND (
          (ou.id IS NOT NULL AND ou.role IN (${membershipPlaceholders}))
          OR (ou.id IS NULL AND u.organization_id = ? AND u.role IN (${legacyPlaceholders}))
        )
    `, [organizationId, ...membershipRoles, organizationId, ...roles]);
    return rows;
  }

  /**
   * Whether a single user is authorized for `permissionSlug` in an organization
   * (see #EFFECTIVE_PERMISSION_PREDICATE — includes cross-org members). Used to
   * validate an assignee before it is written to a record. Deliberately does NOT
   * require status = 'active' so that editing an existing record whose assignee
   * was later deactivated does not spuriously fail; the picker filters to active
   * users for new assignments.
   * Bind order: [orgId (ou join), userId, orgId (connected), slug, slug, orgId, slug].
   */
  static async hasEffectivePermission(userId, organizationId, permissionSlug) {
    if (!userId) return false;
    const db = require('../config/database');
    const [rows] = await db.query(`
      SELECT 1
      FROM users u
      LEFT JOIN organization_users ou
        ON ou.user_id = u.id AND ou.organization_id = ? AND ou.deleted_at IS NULL
      WHERE u.id = ? AND u.deleted_at IS NULL
        AND (u.organization_id = ? OR ou.id IS NOT NULL)
        AND ${User.#EFFECTIVE_PERMISSION_PREDICATE}
      LIMIT 1
    `, [organizationId, userId, organizationId, permissionSlug, permissionSlug, organizationId, permissionSlug]);
    return rows.length > 0;
  }

  /**
   * Get the user's role for a specific organization. Falls back to the legacy
   * users.role when there is no organization_users membership row (see
   * getPermissions for the rationale).
   */
  static async getOrgRole(userId, organizationId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT role FROM organization_users WHERE user_id = ? AND organization_id = ? AND deleted_at IS NULL',
      [userId, organizationId],
    );
    if (rows[0]) return rows[0].role;

    const [fallback] = await db.query(
      'SELECT role FROM users WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [userId, organizationId],
    );
    return fallback[0]?.role || null;
  }

  /**
   * Replace the set of organizations a staff user may access. Target orgs get
   * an active membership row (resurrecting soft-deleted ones); memberships not
   * in the list are soft-deleted. 'owner' rows are never overwritten or removed
   * here — org ownership changes must be explicit, not a side effect of the
   * user form. Ensures users.organization_id (home org) stays within the list.
   * @param {number} userId
   * @param {number[]} orgIds     non-empty list of organization ids
   * @param {string}   membershipRole  role to stamp on rows (the group's kind)
   */
  static async setUserOrganizations(userId, orgIds, membershipRole) {
    const db = require('../config/database');
    const { ValidationError } = require('../utils/errors');
    const ids = [...new Set((orgIds || []).map(Number).filter(Number.isInteger))];
    if (ids.length === 0) {
      throw new ValidationError('organization_ids must contain at least one organization');
    }
    const role = ORG_MEMBERSHIP_ROLES.has(membershipRole) ? membershipRole : 'readonly';

    // One upsert per org: the soft-delete-aware unique key (org, user,
    // active_flag) only collides with an ACTIVE row, so this creates a fresh
    // row when none is active and re-stamps the role (never demoting 'owner')
    // when one is. Soft-deleted history rows are left untouched.
    for (const orgId of ids) {
      await db.query(
        `INSERT INTO organization_users (organization_id, user_id, role)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           role = IF(organization_users.role = 'owner', organization_users.role, VALUES(role))`,
        [orgId, userId, role],
      );
    }

    await db.query(
      `UPDATE organization_users
       SET deleted_at = NOW()
       WHERE user_id = ? AND deleted_at IS NULL AND role != 'owner'
         AND organization_id NOT IN (${ids.map(() => '?').join(',')})`,
      [userId, ...ids],
    );

    // Home org must remain accessible; repoint it if it was deselected.
    const [[u]] = await db.query(
      'SELECT organization_id FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [userId],
    );
    if (u && !ids.includes(Number(u.organization_id))) {
      await db.query('UPDATE users SET organization_id = ? WHERE id = ?', [ids[0], userId]);
    }
  }

  /**
   * Re-stamp the user's active membership rows with their group's kind after a
   * group change, so getOrgRole()/requireRole()/WG scoping (which read the
   * membership role) agree with the new group. 'owner' rows are preserved.
   */
  static async refreshMembershipRoles(userId, kind) {
    if (!ORG_MEMBERSHIP_ROLES.has(kind)) return;
    const db = require('../config/database');
    await db.query(
      `UPDATE organization_users SET role = ?
       WHERE user_id = ? AND deleted_at IS NULL AND role != 'owner'`,
      [kind, userId],
    );
  }

  /**
   * Count ACTIVE admin-kind users of an org other than `excludeUserId` — the
   * last-admin lockout guard for group changes and deletions.
   */
  static async countOtherAdminKindUsers(organizationId, excludeUserId) {
    const db = require('../config/database');
    const [[row]] = await db.query(
      `SELECT COUNT(*) AS cnt
       FROM users u
       WHERE u.deleted_at IS NULL AND u.status = 'active' AND u.role = 'admin'
         AND u.id != ?
         AND (u.organization_id = ? OR EXISTS (
           SELECT 1 FROM organization_users ou
           WHERE ou.user_id = u.id AND ou.organization_id = ? AND ou.deleted_at IS NULL
         ))`,
      [excludeUserId, organizationId, organizationId],
    );
    return Number(row.cnt);
  }

  /**
   * Get all organizations a user belongs to.
   */
  static async getOrganizations(userId) {
    const db = require('../config/database');
    const [rows] = await db.query(`
      SELECT o.*, ou.role AS membership_role
      FROM organization_users ou
      JOIN organizations o ON o.id = ou.organization_id
      WHERE ou.user_id = ? AND ou.deleted_at IS NULL AND o.deleted_at IS NULL
    `, [userId]);
    return rows;
  }
}

module.exports = User;
