// =============================================================================
// FireISP 5.0 — Lead Model
// =============================================================================
// Lead capture and prospect pipeline (§1.2 Customer Lifecycle). See migration 193.
// =============================================================================

const BaseModel = require('./BaseModel');

class Lead extends BaseModel {
  static get tableName() { return 'leads'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'email', 'phone', 'company', 'source', 'status',
      'estimated_value', 'currency', 'assigned_to', 'address', 'city', 'state',
      'zip_code', 'latitude', 'longitude', 'notes', 'converted_client_id', 'converted_at',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  /**
   * Aggregate counts grouped by pipeline stage for an organization.
   * Returns an object keyed by status, e.g. { new: 4, contacted: 2, ... }.
   */
  static async pipelineCounts(orgId = null) {
    const db = require('../config/database');
    let sql = 'SELECT status, COUNT(*) AS count FROM leads WHERE deleted_at IS NULL';
    const params = [];
    if (orgId !== null) { sql += ' AND organization_id = ?'; params.push(orgId); }
    sql += ' GROUP BY status';
    const [rows] = await db.query(sql, params);
    const counts = {};
    for (const r of rows) counts[r.status] = Number(r.count);
    return counts;
  }
}

module.exports = Lead;
