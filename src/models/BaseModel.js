// =============================================================================
// FireISP 5.0 — Base Model
// =============================================================================
// Provides common CRUD operations for all models. Each concrete model extends
// this class and overrides `tableName`, `fillable`, etc.
// =============================================================================

const db = require('../config/database');
const { NotFoundError } = require('../utils/errors');

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
   */
  static async findById(id, orgId = null) {
    let sql = `SELECT * FROM \`${this.tableName}\` WHERE id = ?`;
    const params = [id];
    if (orgId !== null && this.hasOrgScope) {
      sql += ' AND organization_id = ?';
      params.push(orgId);
    }
    if (this.softDelete) {
      sql += ' AND deleted_at IS NULL';
    }
    const [rows] = await db.query(sql, params);
    return rows[0] || null;
  }

  /**
   * Find a record by ID or throw NotFoundError.
   */
  static async findByIdOrFail(id, orgId = null) {
    const record = await this.findById(id, orgId);
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
   * List records with optional filters, pagination, and org scoping.
   * @param {object} [options]
   * @param {boolean} [options.withDeleted=false] Include soft-deleted records
   */
  static async findAll({ where = {}, orderBy = 'id', order = 'ASC', limit = 50, offset = 0, orgId = null, withDeleted = false } = {}) {
    const conditions = [];
    const params = [];

    if (orgId !== null && this.hasOrgScope) {
      conditions.push('organization_id = ?');
      params.push(orgId);
    }

    if (this.softDelete && !withDeleted) {
      conditions.push('deleted_at IS NULL');
    }

    for (const [col, val] of Object.entries(where)) {
      if (this.fillable.includes(col) || col === 'id' || col === 'status' || col === 'organization_id') {
        conditions.push(`\`${col}\` = ?`);
        params.push(val);
      }
    }

    // Validate orderBy against allowed columns to prevent SQL injection
    const safeOrderBy = this.sortable.includes(orderBy) ? orderBy : 'id';

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM \`${this.tableName}\` ${whereClause} ORDER BY \`${safeOrderBy}\` ${order === 'DESC' ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const [rows] = await db.query(sql, params);
    return rows;
  }

  /**
   * Count records matching filters.
   * @param {object} [options]
   * @param {boolean} [options.withDeleted=false] Include soft-deleted records
   */
  static async count({ where = {}, orgId = null, withDeleted = false } = {}) {
    const conditions = [];
    const params = [];

    if (orgId !== null && this.hasOrgScope) {
      conditions.push('organization_id = ?');
      params.push(orgId);
    }

    if (this.softDelete && !withDeleted) {
      conditions.push('deleted_at IS NULL');
    }

    for (const [col, val] of Object.entries(where)) {
      if (this.fillable.includes(col) || col === 'id' || col === 'status' || col === 'organization_id') {
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
   */
  static async update(id, data, orgId = null) {
    const filtered = {};
    for (const key of this.fillable) {
      if (data[key] !== undefined) filtered[key] = data[key];
    }

    const cols = Object.keys(filtered);
    if (cols.length === 0) return this.findByIdOrFail(id, orgId);

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

    const [result] = await db.query(sql, params);
    if (result.affectedRows === 0) throw new NotFoundError(this.tableName);

    return this.findById(id, orgId);
  }

  /**
   * Delete a record by ID. Uses soft-delete (sets deleted_at) when the model
   * has softDelete enabled; otherwise performs a hard DELETE.
   */
  static async delete(id, orgId = null) {
    if (this.softDelete) {
      let sql = `UPDATE \`${this.tableName}\` SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`;
      const params = [id];

      if (orgId !== null && this.hasOrgScope) {
        sql += ' AND organization_id = ?';
        params.push(orgId);
      }

      const [result] = await db.query(sql, params);
      if (result.affectedRows === 0) throw new NotFoundError(this.tableName);
      return true;
    }

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
  static async restore(id, orgId = null) {
    if (!this.softDelete) {
      throw new Error(`${this.tableName} does not support soft-delete`);
    }

    let sql = `UPDATE \`${this.tableName}\` SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`;
    const params = [id];

    if (orgId !== null && this.hasOrgScope) {
      sql += ' AND organization_id = ?';
      params.push(orgId);
    }

    const [result] = await db.query(sql, params);
    if (result.affectedRows === 0) throw new NotFoundError(this.tableName);
    return this.findById(id, orgId);
  }

  /** Whether this model's table has an organization_id column */
  static get hasOrgScope() {
    return false;
  }
}

module.exports = BaseModel;
