// =============================================================================
// FireISP 5.0 — User Model
// =============================================================================

const BaseModel = require('./BaseModel');

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
      SELECT DISTINCT p.slug
      FROM organization_users ou
      JOIN roles r ON r.id = (
        SELECT r2.id FROM roles r2 WHERE r2.name = ou.role AND r2.deleted_at IS NULL LIMIT 1
      )
      JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ou.user_id = ? AND ou.organization_id = ?
        AND ou.deleted_at IS NULL
    `, [userId, organizationId]);
    return rows.map(r => r.slug);
  }

  /**
   * Get the user's role for a specific organization.
   */
  static async getOrgRole(userId, organizationId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT role FROM organization_users WHERE user_id = ? AND organization_id = ? AND deleted_at IS NULL',
      [userId, organizationId],
    );
    return rows[0]?.role || null;
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
