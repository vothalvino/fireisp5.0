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
   * Org-scoped override of BaseModel.findById. `radius` has no
   * organization_id column (hasOrgScope=false), so BaseModel.findById (and
   * therefore the inherited findByIdOrFail, which calls `this.findById`)
   * would silently skip org scoping entirely — GET /radius/:id (and, via
   * crudController's update/destroy/restore, PUT/DELETE/restore too) would
   * return/operate on ANY org's row on this instance. Joins through
   * `clients` (client_id is NOT NULL, unlike the nullable contract_id — see
   * findCredentialsById) to enforce org scoping while keeping BaseModel's
   * exact `(id, orgId = null)` signature, so every caller — crudController's
   * get/update/destroy/restore, and any other `Radius.findByIdOrFail(...)`
   * call site — is scoped for free with no route-level changes. Returns the
   * full row (including password); the crudController route wires
   * `serialize: Radius.sanitize` separately to strip it before it reaches
   * an HTTP response.
   */
  static async findById(id, orgId = null) {
    const db = require('../config/database');
    let sql = 'SELECT r.* FROM `radius` r JOIN clients cl ON cl.id = r.client_id WHERE r.id = ?';
    const params = [id];
    if (orgId !== null) {
      sql += ' AND cl.organization_id = ?';
      params.push(orgId);
    }
    if (this.softDelete) {
      sql += ' AND r.deleted_at IS NULL';
    }
    const [rows] = await db.query(sql, params);
    return rows[0] || null;
  }

  /**
   * Org-scoped override of BaseModel.findAll — same rationale as findById
   * above. Used by crudController's `list` handler for GET /radius; without
   * this override every org's RADIUS rows on the instance would be returned
   * to any caller with `devices.view` or `radius.credentials.view` in ANY
   * org. Mirrors BaseModel.findAll's exact option shape and column-filter
   * allowlist (fillable + id/status) so query-string filtering keeps
   * working; only the FROM/JOIN and the org condition differ.
   */
  static async findAll({ where = {}, orderBy = 'id', order = 'ASC', limit = 50, offset = 0, orgId = null, withDeleted = false, onlyDeleted = false } = {}) {
    if (onlyDeleted && !this.softDelete) return [];

    const db = require('../config/database');
    const conditions = [];
    const params = [];

    if (orgId !== null) {
      conditions.push('cl.organization_id = ?');
      params.push(orgId);
    }

    if (this.softDelete && onlyDeleted) {
      conditions.push('r.deleted_at IS NOT NULL');
    } else if (this.softDelete && !withDeleted) {
      conditions.push('r.deleted_at IS NULL');
    }

    for (const [col, val] of Object.entries(where)) {
      if (this.fillable.includes(col) || col === 'id' || col === 'status') {
        conditions.push(`r.\`${col}\` = ?`);
        params.push(val);
      }
    }

    const safeOrderBy = this.sortable.includes(orderBy) ? orderBy : 'id';
    const safeLimit = Math.max(1, parseInt(limit, 10) || 50);
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT r.* FROM \`radius\` r JOIN clients cl ON cl.id = r.client_id ${whereClause} ORDER BY r.\`${safeOrderBy}\` ${order === 'DESC' ? 'DESC' : 'ASC'} LIMIT ${safeLimit} OFFSET ${safeOffset}`;

    const [rows] = await db.query(sql, params);
    return rows;
  }

  /**
   * Org-scoped override of BaseModel.count — same rationale as findAll
   * above. Used by crudController's `list` handler to compute
   * `meta.total`; without this override the total would count every org's
   * rows, leaking the existence/volume of other orgs' RADIUS accounts even
   * though the row data itself was already fixed by findAll.
   */
  static async count({ where = {}, orgId = null, withDeleted = false, onlyDeleted = false } = {}) {
    if (onlyDeleted && !this.softDelete) return 0;

    const db = require('../config/database');
    const conditions = [];
    const params = [];

    if (orgId !== null) {
      conditions.push('cl.organization_id = ?');
      params.push(orgId);
    }

    if (this.softDelete && onlyDeleted) {
      conditions.push('r.deleted_at IS NOT NULL');
    } else if (this.softDelete && !withDeleted) {
      conditions.push('r.deleted_at IS NULL');
    }

    for (const [col, val] of Object.entries(where)) {
      if (this.fillable.includes(col) || col === 'id' || col === 'status') {
        conditions.push(`r.\`${col}\` = ?`);
        params.push(val);
      }
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT COUNT(*) AS total FROM \`radius\` r JOIN clients cl ON cl.id = r.client_id ${whereClause}`;
    const [rows] = await db.query(sql, params);
    return rows[0].total;
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
