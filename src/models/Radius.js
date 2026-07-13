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
      'mac_address', 'profile', 'status', 'auth_method',
      'simultaneous_use', 'vlan_id', 'inner_vlan_id',
    ];
  }

  static get hasOrgScope() { return false; }

  static get softDelete() { return true; }

  /**
   * Every `radius` column except the cleartext PPPoE `password`. Used to
   * project password-free responses (GET /radius, GET /radius/:id, GET
   * /radius/contract/:contractId) without hand-guessing the list at each
   * call site. Credential-bearing responses go through the separate
   * `radius.credentials.view`-gated routes in src/routes/radius.js instead.
   */
  static get SAFE_COLUMNS() {
    return [
      'id', 'client_id', 'contract_id', 'nas_id', 'username',
      'ip_address', 'ipv6_address', 'ipv6_delegated_prefix', 'ipv6_prefix_len',
      'ipv4_pool_id', 'ipv6_pool_id', 'mac_address', 'profile', 'auth_method',
      'status', 'simultaneous_use', 'vlan_id', 'inner_vlan_id',
      'service_profile_id', 'created_at', 'updated_at', 'deleted_at', 'active_flag',
    ];
  }

  /**
   * Strip the cleartext `password` column from a radius record. Delegates to
   * src/utils/radiusSanitize.js (see that module for why it lives outside
   * the model).
   */
  static sanitize(record) {
    return require('../utils/radiusSanitize').sanitizeRadius(record);
  }

  /**
   * Find RADIUS account(s) for a contract, scoped to the given organization
   * via a join through `contracts` — the `radius` table itself has no
   * `organization_id` column (hasOrgScope is false), and without this join
   * any authenticated user with `devices.view` in ANY org could pass another
   * org's contractId and receive that org's RADIUS accounts. Excludes the
   * cleartext `password` column; use findByContractCredentials for the
   * `radius.credentials.view`-gated route.
   */
  static async findByContract(contractId, orgId) {
    const db = require('../config/database');
    const cols = this.SAFE_COLUMNS.map((c) => `r.\`${c}\``).join(', ');
    const [rows] = await db.query(
      `SELECT ${cols} FROM radius r
       JOIN contracts c ON c.id = r.contract_id AND c.organization_id = ?
       WHERE r.contract_id = ? AND r.deleted_at IS NULL`,
      [orgId, contractId],
    );
    return rows;
  }

  /**
   * Same as findByContract but returns the full row, including the
   * cleartext `password` column. Only call this from routes gated by
   * `radius.credentials.view`.
   */
  static async findByContractCredentials(contractId, orgId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      `SELECT r.* FROM radius r
       JOIN contracts c ON c.id = r.contract_id AND c.organization_id = ?
       WHERE r.contract_id = ? AND r.deleted_at IS NULL`,
      [orgId, contractId],
    );
    return rows;
  }

  /**
   * Find a single RADIUS account by id, scoped to the given organization via
   * a join through `clients` (client_id is NOT NULL and ON DELETE RESTRICT,
   * unlike contract_id which is nullable and SET NULL when its contract is
   * deleted — joining through clients still resolves the org for those
   * orphaned-contract rows instead of silently hiding them). Returns the
   * full row including `password`; only call from routes gated by
   * `radius.credentials.view`.
   */
  static async findCredentialsById(id, orgId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      `SELECT r.* FROM radius r
       JOIN clients cl ON cl.id = r.client_id AND cl.organization_id = ?
       WHERE r.id = ? AND r.deleted_at IS NULL`,
      [orgId, id],
    );
    return rows[0] || null;
  }
}

module.exports = Radius;
