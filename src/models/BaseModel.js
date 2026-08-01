// =============================================================================
// FireISP 5.0 — Base Model
// =============================================================================
// Provides common CRUD operations for all models. Each concrete model extends
// this class and overrides `tableName`, `fillable`, etc.
// =============================================================================

const db = require('../config/database');
const { NotFoundError, AppError } = require('../utils/errors');

class BaseModel {
  /** @returns {string} The database table name */
  static get tableName() {
    throw new Error('Subclass must define tableName');
  }

  /** @returns {string[]} Columns allowed for insert/update */
  static get fillable() {
    return [];
  }

  /** Whether this model uses soft-delete (deleted_at column) */
  static get softDelete() {
    return false;
  }

  /**
   * Find a record by primary key.
   *
   * `opts` is strictly additive — omit it and this behaves exactly as before.
   *   opts.exec       run the statement on a specific connection (e.g.
   *                   conn.execute.bind(conn)) so the read joins a caller's
   *                   transaction instead of taking its own pooled connection.
   *   opts.forUpdate  append FOR UPDATE, locking the row until that
   *                   transaction commits. Only meaningful with opts.exec:
   *                   a lock taken outside a transaction is released
   *                   immediately and guards nothing.
   *
   * This exists so a caller can do check-then-write atomically WITHOUT
   * reimplementing org scoping, soft-delete and fillable filtering by hand —
   * duplicating those inline is how they drift apart.
   */
  static async findById(id, orgId = null, opts = {}) {
    let sql = `SELECT * FROM \`${this.tableName}\` WHERE id = ?`;
    const params = [id];
    if (orgId !== null && this.hasOrgScope) {
      sql += ' AND organization_id = ?';
      params.push(orgId);
    }
    if (this.softDelete) {
      sql += ' AND deleted_at IS NULL';
    }
    if (opts.forUpdate) {
      sql += ' FOR UPDATE';
    }
    const [rows] = opts.exec ? await opts.exec(sql, params) : await db.query(sql, params);
    return rows[0] || null;
  }

  /**
   * Find a record by ID or throw NotFoundError.
   */
  static async findByIdOrFail(id, orgId = null, opts = {}) {
    const record = await this.findById(id, orgId, opts);
    if (!record) throw new NotFoundError(this.tableName);
    return record;
  }

  /**
   * Find a record by ID including soft-deleted records.
   */
  static async findByIdIncludingDeleted(id, orgId = null) {
    let sql = `SELECT * FROM \`${this.tableName}\` WHERE id = ?`;
    const params = [id];
    if (orgId !== null && this.hasOrgScope) {
      sql += ' AND organization_id = ?';
      params.push(orgId);
    }
    const [rows] = await db.query(sql, params);
    return rows[0] || null;
  }

  /** @returns {string[]} Columns allowed for ORDER BY */
  static get sortable() {
    return [...this.fillable, 'id', 'created_at', 'updated_at'];
  }

  /**
   * Non-fillable columns a model additionally allows as WHERE filters on list
   * endpoints (service-managed columns like sat_status that users must be able
   * to filter by but never write). Empty by default; override per model.
   * @returns {string[]}
   */
  static get filterableColumns() {
    return [];
  }

  /**
   * List records with optional filters, pagination, and org scoping.
   * @param {object} [options]
   * @param {boolean} [options.withDeleted=false] Include soft-deleted records
   * @param {boolean} [options.onlyDeleted=false] ONLY soft-deleted records (an
   *   archived-records view, e.g. the Users page's Archived tab). Wins over
   *   withDeleted.
   */
  static async findAll({ where = {}, orderBy = 'id', order = 'ASC', limit = 50, offset = 0, orgId = null, withDeleted = false, onlyDeleted = false } = {}) {
    // An archived-records view of a hard-delete model is by definition empty.
    // Without this, onlyDeleted would silently no-op and present the full
    // ACTIVE list as "archived" — inverted semantics, worse than an error.
    if (onlyDeleted && !this.softDelete) return [];

    const conditions = [];
    const params = [];

    if (orgId !== null && this.hasOrgScope) {
      conditions.push('organization_id = ?');
      params.push(orgId);
    }

    if (this.softDelete && onlyDeleted) {
      conditions.push('deleted_at IS NOT NULL');
    } else if (this.softDelete && !withDeleted) {
      conditions.push('deleted_at IS NULL');
    }

    for (const [col, val] of Object.entries(where)) {
      if (this.fillable.includes(col) || this.filterableColumns.includes(col) || col === 'id' || col === 'status' || col === 'organization_id') {
        conditions.push(`\`${col}\` = ?`);
        params.push(val);
      }
    }

    // Validate orderBy against allowed columns to prevent SQL injection
    const safeOrderBy = this.sortable.includes(orderBy) ? orderBy : 'id';

    // Inline limit and offset as integer literals (not bind parameters) to avoid
    // the mysqld_stmt_execute regression with LIMIT ?/OFFSET ? on the prepared-
    // statement protocol.  Both values are validated as safe non-negative integers
    // before interpolation so there is no SQL-injection risk.
    const safeLimit  = Math.max(1, parseInt(limit,  10) || 50);
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM \`${this.tableName}\` ${whereClause} ORDER BY \`${safeOrderBy}\` ${order === 'DESC' ? 'DESC' : 'ASC'} LIMIT ${safeLimit} OFFSET ${safeOffset}`;

    const [rows] = await db.query(sql, params);
    return rows;
  }

  /**
   * Count records matching filters.
   * @param {object} [options]
   * @param {boolean} [options.withDeleted=false] Include soft-deleted records
   * @param {boolean} [options.onlyDeleted=false] ONLY soft-deleted records (wins over withDeleted)
   */
  static async count({ where = {}, orgId = null, withDeleted = false, onlyDeleted = false } = {}) {
    if (onlyDeleted && !this.softDelete) return 0;

    const conditions = [];
    const params = [];

    if (orgId !== null && this.hasOrgScope) {
      conditions.push('organization_id = ?');
      params.push(orgId);
    }

    if (this.softDelete && onlyDeleted) {
      conditions.push('deleted_at IS NOT NULL');
    } else if (this.softDelete && !withDeleted) {
      conditions.push('deleted_at IS NULL');
    }

    for (const [col, val] of Object.entries(where)) {
      if (this.fillable.includes(col) || this.filterableColumns.includes(col) || col === 'id' || col === 'status' || col === 'organization_id') {
        conditions.push(`\`${col}\` = ?`);
        params.push(val);
      }
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT COUNT(*) AS total FROM \`${this.tableName}\` ${whereClause}`;
    const [rows] = await db.query(sql, params);
    return rows[0].total;
  }

  /**
   * Insert a new record. Only `fillable` columns are accepted.
   */
  static async create(data) {
    const filtered = {};
    for (const key of this.fillable) {
      if (data[key] !== undefined) filtered[key] = data[key];
    }

    const cols = Object.keys(filtered);
    if (cols.length === 0) throw new Error('No fillable data provided');

    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT INTO \`${this.tableName}\` (${cols.map(c => `\`${c}\``).join(', ')}) VALUES (${placeholders})`;
    const [result] = await db.query(sql, Object.values(filtered));

    return this.findByIdIncludingDeleted(result.insertId);
  }

  /**
   * Update a record by ID. Only `fillable` columns are accepted.
   *
   * A record can NEVER be moved between tenants through here.
   *
   * #604 put this check in crudController.applyUpdate, which was the right
   * idea at the wrong altitude: 12 routes call Model.update(req.params.id,
   * req.body, req.orgId) DIRECTLY and never touch crudController, so the exact
   * exploit #604 closed stayed reachable on contracts, devices, chargebacks,
   * billing disputes, refund requests, IP pools, network links, CPE profiles
   * and firmware versions/campaigns. Reproduced at runtime on nine of them.
   *
   * The chain that makes it reachable is three individually-sensible pieces:
   * organization_id MUST be in `fillable` (create injects it), the update
   * schemas do not declare it, and validate() IGNORES undeclared fields rather
   * than stripping them. So the field flows from the request body into the SET
   * clause. The WHERE binds req.orgId, so a caller can only PUSH their own row
   * into another tenant — but that is still an authenticated user injecting a
   * contract, dispute or firmware campaign into an org that never created it.
   *
   * Enforced here because this is the narrowest point every caller passes
   * through. No escape hatch: nothing in src/ passes organization_id to
   * update() deliberately (verified by grep across all 32 call sites), so a
   * legitimate re-home does not exist to accommodate. If one is ever needed it
   * should be an explicit, separately-audited method — not a flag on the
   * generic path that every route already uses.
   */
  static async update(id, data, orgId = null, opts = {}) {
    if (this.hasOrgScope && data && Object.prototype.hasOwnProperty.call(data, 'organization_id')) {
      throw new AppError(
        'A record cannot be moved to another organization.',
        422,
        'ORG_IMMUTABLE',
      );
    }

    const filtered = {};
    for (const key of this.fillable) {
      if (data[key] !== undefined) filtered[key] = data[key];
    }

    const cols = Object.keys(filtered);
    // opts is threaded through every read below: inside a transaction the
    // read-back MUST use the same connection, or it sees pre-commit state
    // from a different pooled connection and returns stale values.
    if (cols.length === 0) return this.findByIdOrFail(id, orgId, opts);

    const setClauses = cols.map(c => `\`${c}\` = ?`).join(', ');
    let sql = `UPDATE \`${this.tableName}\` SET ${setClauses} WHERE id = ?`;
    const params = [...Object.values(filtered), id];

    if (orgId !== null && this.hasOrgScope) {
      sql += ' AND organization_id = ?';
      params.push(orgId);
    }

    if (this.softDelete) {
      sql += ' AND deleted_at IS NULL';
    }

    const [result] = opts.exec ? await opts.exec(sql, params) : await db.query(sql, params);
    if (result.affectedRows === 0) throw new NotFoundError(this.tableName);

    // Never forUpdate here — the row is already locked by the caller's earlier
    // SELECT ... FOR UPDATE, and re-locking on the read-back is noise.
    return this.findById(id, orgId, { exec: opts.exec });
  }

  /**
   * Delete a record by ID. Uses soft-delete (sets deleted_at) when the model
   * has softDelete enabled; otherwise performs a hard DELETE.
   */
  static async delete(id, orgId = null, opts = {}) {
    if (this.softDelete) {
      let sql = `UPDATE \`${this.tableName}\` SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`;
      const params = [id];

      if (orgId !== null && this.hasOrgScope) {
        sql += ' AND organization_id = ?';
        params.push(orgId);
      }

      const [result] = opts.exec ? await opts.exec(sql, params) : await db.query(sql, params);
      if (result.affectedRows === 0) throw new NotFoundError(this.tableName);
      return true;
    }

    let sql = `DELETE FROM \`${this.tableName}\` WHERE id = ?`;
    const params = [id];

    if (orgId !== null && this.hasOrgScope) {
      sql += ' AND organization_id = ?';
      params.push(orgId);
    }

    const [result] = opts.exec ? await opts.exec(sql, params) : await db.query(sql, params);
    if (result.affectedRows === 0) throw new NotFoundError(this.tableName);
    return true;
  }

  /**
   * Permanently delete a record, bypassing soft-delete.
   */
  static async forceDelete(id, orgId = null) {
    let sql = `DELETE FROM \`${this.tableName}\` WHERE id = ?`;
    const params = [id];

    if (orgId !== null && this.hasOrgScope) {
      sql += ' AND organization_id = ?';
      params.push(orgId);
    }

    const [result] = await db.query(sql, params);
    if (result.affectedRows === 0) throw new NotFoundError(this.tableName);
    return true;
  }

  /**
   * Restore a soft-deleted record by clearing its deleted_at timestamp.
   */
  static async restore(id, orgId = null, opts = {}) {
    if (!this.softDelete) {
      throw new Error(`${this.tableName} does not support soft-delete`);
    }

    let sql = `UPDATE \`${this.tableName}\` SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`;
    const params = [id];

    if (orgId !== null && this.hasOrgScope) {
      sql += ' AND organization_id = ?';
      params.push(orgId);
    }

    const [result] = opts.exec ? await opts.exec(sql, params) : await db.query(sql, params);
    if (result.affectedRows === 0) throw new NotFoundError(this.tableName);
    // Same connection for the read-back: outside the transaction it cannot see
    // the un-delete that has not committed yet.
    return this.findById(id, orgId, { exec: opts.exec });
  }

  /** Whether this model's table has an organization_id column */
  static get hasOrgScope() {
    return false;
  }
}

module.exports = BaseModel;
