// =============================================================================
// FireISP 5.0 — Discovery Scan Model
// =============================================================================

const BaseModel = require('./BaseModel');

class DiscoveryScan extends BaseModel {
  static get tableName() { return 'discovery_scans'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'cidr_ranges', 'snmp_version', 'snmp_community',
      'snmp_v3_security_name', 'snmp_v3_auth_protocol', 'snmp_v3_auth_key_encrypted',
      'snmp_v3_priv_protocol', 'snmp_v3_priv_key_encrypted', 'snmp_port',
      'timeout_ms', 'concurrency', 'status', 'scan_started_at', 'scan_completed_at',
      'total_hosts', 'scanned_hosts', 'discovered_hosts', 'error_message', 'created_by',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  // Get results for a scan
  static async getResults(scanId, orgId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      `SELECT dr.*, p.name AS suggested_profile_name, d.name AS device_name
       FROM discovery_results dr
       LEFT JOIN snmp_profiles p ON p.id = dr.suggested_profile_id
       LEFT JOIN devices d ON d.id = dr.device_id
       WHERE dr.scan_id = ? AND dr.organization_id = ?
       ORDER BY dr.ip_address`,
      [scanId, orgId],
    );
    return rows;
  }
}

module.exports = DiscoveryScan;
