// =============================================================================
// FireISP 5.0 — SnmpProfile Model
// =============================================================================

const BaseModel = require('./BaseModel');

class SnmpProfile extends BaseModel {
  static get tableName() { return 'snmp_profiles'; }

  static get fillable() {
    return [
      // organization_id is fillable so crudController can inject it on create
      // and so the route can ADOPT an unattributed legacy row. It is never
      // accepted from a request body — BaseModel.update refuses it outright
      // (#612), because validate() ignores undeclared fields rather than
      // stripping them.
      //
      // is_system is deliberately ABSENT: a tenant must not be able to mark
      // its own profile as system (which would make it visible to every other
      // tenant) or unmark a shipped one to edit it. Only migration 440 sets it.
      'organization_id',
      'name', 'manufacturer', 'model_pattern',
      'device_type', 'snmp_version', 'poll_interval_sec', 'description',
      'is_default', 'status',
    ];
  }

  // organization_id added by migration 440. Scoping must stay ON: with it off
  // BaseModel omits the predicate SILENTLY and any tenant could rewrite or
  // delete another's polling profiles — which decides what their monitoring
  // sees, so the damage lands on the very thing you would use to notice it.
  //
  // Reads must ALSO admit system profiles (organization_id NULL, is_system 1)
  // and unattributed legacy rows; BaseModel cannot express `= ? OR IS NULL`,
  // so those are hand-written in src/routes/snmpProfiles.js.
  static get hasOrgScope() { return true; }

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
