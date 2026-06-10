// =============================================================================
// FireISP 5.0 — ClientGroup Model
// =============================================================================
// Family/account grouping (shared billing, family plan). See migration 192.
// =============================================================================

const BaseModel = require('./BaseModel');

class ClientGroup extends BaseModel {
  static get tableName() { return 'client_groups'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'billing_mode', 'primary_client_id', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  /**
   * Get the member clients belonging to this group.
   */
  static async getMembers(groupId, orgId = null) {
    const db = require('../config/database');
    let sql = `SELECT id, name, email, phone, client_type, status
                 FROM clients
                WHERE client_group_id = ? AND deleted_at IS NULL`;
    const params = [groupId];
    if (orgId !== null) { sql += ' AND organization_id = ?'; params.push(orgId); }
    sql += ' ORDER BY id';
    const [rows] = await db.query(sql, params);
    return rows;
  }
}

module.exports = ClientGroup;
