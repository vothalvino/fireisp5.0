// =============================================================================
// FireISP 5.0 — RADIUS Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Radius extends BaseModel {
  static get tableName() { return 'radius'; }

  static get fillable() {
    return [
      'contract_id', 'nas_id', 'username', 'password',
      'ip_address', 'ipv4_pool_id', 'ipv6_address',
      'ipv6_delegated_prefix', 'ipv6_prefix_len', 'ipv6_pool_id',
      'status',
    ];
  }

  static get hasOrgScope() { return false; }

  /**
   * Find RADIUS account(s) for a contract.
   */
  static async findByContract(contractId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM radius WHERE contract_id = ?',
      [contractId],
    );
    return rows;
  }
}

module.exports = Radius;
