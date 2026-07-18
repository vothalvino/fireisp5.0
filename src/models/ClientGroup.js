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

  /**
   * Assign existing clients to this group. Org-scoped: only clients in the
   * same org are moved. Returns the count of clients actually assigned.
   */
  static async addMembers(groupId, clientIds, orgId) {
    const ids = [...new Set((clientIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (ids.length === 0) return 0;
    const db = require('../config/database');
    const placeholders = ids.map(() => '?').join(', ');
    const [result] = await db.query(
      `UPDATE clients SET client_group_id = ?
        WHERE id IN (${placeholders}) AND organization_id = ? AND deleted_at IS NULL`,
      [groupId, ...ids, orgId],
    );
    return result.affectedRows || 0;
  }

  /**
   * Remove one client from this group (client_group_id -> NULL). If that
   * client was the group's designated primary, clear primary_client_id too so
   * the group is never left pointing at a non-member. Returns true if a member
   * of THIS group was removed.
   */
  static async removeMember(groupId, clientId, orgId) {
    const db = require('../config/database');
    const [result] = await db.query(
      `UPDATE clients SET client_group_id = NULL
        WHERE id = ? AND client_group_id = ? AND organization_id = ? AND deleted_at IS NULL`,
      [clientId, groupId, orgId],
    );
    const removed = (result.affectedRows || 0) > 0;
    if (removed) {
      await db.query(
        `UPDATE client_groups SET primary_client_id = NULL
          WHERE id = ? AND organization_id = ? AND primary_client_id = ?`,
        [groupId, orgId, clientId],
      );
    }
    return removed;
  }
}

module.exports = ClientGroup;
