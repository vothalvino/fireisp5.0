// =============================================================================
// FireISP 5.0 — Device Group Model
// =============================================================================

const BaseModel = require('./BaseModel');

class DeviceGroup extends BaseModel {
  static get tableName() { return 'device_groups'; }

  static get fillable() {
    return ['organization_id', 'name', 'description', 'group_type', 'color', 'status'];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  // Get members (devices) of a group
  static async getMembers(groupId, orgId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      `SELECT d.id, d.name, d.type, d.manufacturer, d.model, d.ip_address, d.status
       FROM device_group_members dgm
       JOIN devices d ON d.id = dgm.device_id
       WHERE dgm.device_group_id = ? AND d.deleted_at IS NULL AND d.organization_id = ?
       ORDER BY d.name`,
      [groupId, orgId],
    );
    return rows;
  }

  // Add device(s) to a group
  static async addMembers(groupId, deviceIds) {
    const db = require('../config/database');
    if (!deviceIds || deviceIds.length === 0) return 0;
    const vals = deviceIds.map(() => '(?,?)').join(',');
    const params = deviceIds.flatMap(id => [groupId, id]);
    const [result] = await db.query(
      `INSERT IGNORE INTO device_group_members (device_group_id, device_id) VALUES ${vals}`,
      params,
    );
    return result.affectedRows;
  }

  // Remove device from a group
  static async removeMember(groupId, deviceId) {
    const db = require('../config/database');
    const [result] = await db.query(
      'DELETE FROM device_group_members WHERE device_group_id = ? AND device_id = ?',
      [groupId, deviceId],
    );
    return result.affectedRows;
  }
}

module.exports = DeviceGroup;
