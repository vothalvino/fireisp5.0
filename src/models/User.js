// =============================================================================
// FireISP 5.0 — User Model
// =============================================================================

const BaseModel = require('./BaseModel');

// Roles that are valid values for the `organization_users.role` ENUM
// (owner, admin, manager, technician, billing, readonly). The legacy
// `users.role` ENUM also includes 'support', which has no membership-role
// equivalent — those users rely on the users.role permission fallback below.
const ORG_MEMBERSHIP_ROLES = new Set(['owner', 'admin', 'manager', 'technician', 'billing', 'readonly']);

class User extends BaseModel {
  static get tableName() { return 'users'; }

  static get fillable() {
    return [
      'organization_id', 'first_name', 'last_name', 'email',
      'password_hash', 'role', 'phone', 'status',
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
    const user = await super.create(data);
    await User.syncOrgMembership(user);
    return user;
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
   * Get all permissions for a user via organization_users → roles → role_permissions → permissions.
   */
  static async getPermissions(userId, organizationId) {
    const db = require('../config/database');
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
