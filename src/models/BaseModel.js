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
   * List records with optional filters, pagination, and org scoping.
   */
  static async findAll({ where = {}, orderBy = 'id', order = 'ASC', limit = 50, offset = 0, orgId = null } = {}) {
    const conditions = [];
    const params = [];

    if (orgId !== null && this.hasOrgScope) {
      conditions.push('organization_id = ?');
      params.push(orgId);
    }

    for (const [col, val] of Object.entries(where)) {
      if (this.fillable.includes(col) || col === 'id' || col === 'status' || col === 'organization_id') {
        conditions.push(`\`${col}\` = ?`);
        params.push(val);
      }
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM \`${this.tableName}\` ${whereClause} ORDER BY \`${orderBy}\` ${order === 'DESC' ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const [rows] = await db.query(sql, params);
    return rows;
  }

  /**
   * Count records matching filters.
   */
  static async count({ where = {}, orgId = null } = {}) {
    const conditions = [];
    const params = [];

    if (orgId !== null && this.hasOrgScope) {
      conditions.push('organization_id = ?');
      params.push(orgId);
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

    return this.findById(result.insertId);
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

    const [result] = await db.query(sql, params);
    if (result.affectedRows === 0) throw new NotFoundError(this.tableName);

    return this.findById(id, orgId);
  }

  /**
   * Delete a record by ID.
   */
  static async delete(id, orgId = null) {
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

  /** Whether this model's table has an organization_id column */
  static get hasOrgScope() {
    return false;
  }
}

module.exports = BaseModel;
