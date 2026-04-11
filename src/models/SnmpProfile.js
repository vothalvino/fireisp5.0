// =============================================================================
// FireISP 5.0 — SnmpProfile Model
// =============================================================================

const BaseModel = require('./BaseModel');

class SnmpProfile extends BaseModel {
  static get tableName() { return 'snmp_profiles'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'manufacturer', 'model_pattern',
      'device_type', 'snmp_version', 'poll_interval_sec', 'description',
      'is_default', 'status',
    ];
  }

  static get hasOrgScope() { return true; }

  static async getOids(profileId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM snmp_profile_oids WHERE profile_id = ? ORDER BY sort_order',
      [profileId],
    );
    return rows;
  }

  static async addOid(data) {
    const db = require('../config/database');
    const [result] = await db.query(
      `INSERT INTO snmp_profile_oids (profile_id, oid, metric_column, label, oid_type, is_per_interface, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [data.profile_id, data.oid, data.metric_column, data.label, data.oid_type, data.is_per_interface || false, data.sort_order || 0],
    );
    const [rows] = await db.query('SELECT * FROM snmp_profile_oids WHERE id = ?', [result.insertId]);
    return rows[0];
  }
}

module.exports = SnmpProfile;
