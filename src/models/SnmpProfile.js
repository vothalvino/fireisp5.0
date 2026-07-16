// =============================================================================
// FireISP 5.0 — SnmpProfile Model
// =============================================================================

const BaseModel = require('./BaseModel');

class SnmpProfile extends BaseModel {
  static get tableName() { return 'snmp_profiles'; }

  static get fillable() {
    return [
      'name', 'manufacturer', 'model_pattern',
      'device_type', 'snmp_version', 'poll_interval_sec', 'description',
      'is_default', 'status',
    ];
  }

  // snmp_profiles has no organization_id column (single-tenant per ISP), so
  // org scoping is disabled to avoid "Unknown column 'organization_id'" errors.
  static get hasOrgScope() { return false; }

  // snmp_profiles has a deleted_at column, so soft-delete stays enabled.
  static get softDelete() { return true; }

  static async getOids(profileId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM snmp_profile_oids WHERE profile_id = ? AND deleted_at IS NULL ORDER BY sort_order',
      [profileId],
    );
    return rows;
  }

  static async addOid(data) {
    const db = require('../config/database');
    const [result] = await db.query(
      `INSERT INTO snmp_profile_oids (profile_id, oid, metric_column, label, oid_type, is_per_interface, aggregate, transform, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.profile_id, data.oid, data.metric_column, data.label, data.oid_type,
        data.is_per_interface || false, data.aggregate || false, data.transform || null, data.sort_order || 0,
      ],
    );
    const [rows] = await db.query('SELECT * FROM snmp_profile_oids WHERE id = ?', [result.insertId]);
    return rows[0];
  }
}

module.exports = SnmpProfile;
