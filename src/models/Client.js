// =============================================================================
// FireISP 5.0 — Client Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Client extends BaseModel {
  static get tableName() { return 'clients'; }

  static get fillable() {
    return [
      'organization_id', 'client_group_id', 'name', 'email', 'phone', 'client_type',
      'locale', 'tax_id', 'curp', 'address', 'city', 'state', 'zip_code',
      'country', 'latitude', 'longitude', 'geocoded_at', 'credit_score',
      'risk_rating', 'notes', 'status',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  /**
   * Get contacts for this client.
   */
  static async getContacts(clientId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM contacts WHERE client_id = ? AND deleted_at IS NULL ORDER BY id',
      [clientId],
    );
    return rows;
  }

  /**
   * Get MX profile for this client (if locale = 'MX').
   */
  static async getMxProfile(clientId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM client_mx_profiles WHERE client_id = ? AND deleted_at IS NULL',
      [clientId],
    );
    return rows[0] || null;
  }

  /**
   * Get all custom fields (key/value) for this client.
   */
  static async getCustomFields(clientId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT id, field_key, field_value, created_at, updated_at FROM client_custom_fields WHERE client_id = ? AND deleted_at IS NULL ORDER BY field_key',
      [clientId],
    );
    return rows;
  }

  /**
   * Create or update a custom field for this client (upsert on field_key).
   */
  static async setCustomField(clientId, key, value) {
    const db = require('../config/database');
    await db.query(
      `INSERT INTO client_custom_fields (client_id, field_key, field_value)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE field_value = VALUES(field_value), deleted_at = NULL`,
      [clientId, key, value ?? null],
    );
    const [rows] = await db.query(
      'SELECT id, field_key, field_value, created_at, updated_at FROM client_custom_fields WHERE client_id = ? AND field_key = ? AND deleted_at IS NULL',
      [clientId, key],
    );
    return rows[0] || null;
  }

  /**
   * Soft-delete a custom field by key.
   */
  static async deleteCustomField(clientId, key) {
    const db = require('../config/database');
    const [result] = await db.query(
      'UPDATE client_custom_fields SET deleted_at = NOW() WHERE client_id = ? AND field_key = ? AND deleted_at IS NULL',
      [clientId, key],
    );
    return result.affectedRows > 0;
  }

  /**
   * Get uploaded documents (ID, photo, etc.) for this client from the files table.
   */
  static async getDocuments(clientId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      `SELECT id, category, file_name, file_path, file_size, mime_type, uploaded_by, notes, created_at
         FROM files
        WHERE entity_type = 'client' AND entity_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC`,
      [clientId],
    );
    return rows;
  }

  /**
   * Detect potential duplicate clients within the same organization by matching
   * email, phone, or tax_id. When `excludeId` is set that client is omitted
   * (used when checking duplicates for an existing record).
   */
  static async findDuplicates({ email, phone, tax_id, excludeId = null, orgId = null } = {}) {
    const db = require('../config/database');
    const matchClauses = [];
    const params = [];

    if (email)  { matchClauses.push('email = ?');  params.push(email); }
    if (phone)  { matchClauses.push('phone = ?');  params.push(phone); }
    if (tax_id) { matchClauses.push('tax_id = ?'); params.push(tax_id); }

    if (matchClauses.length === 0) return [];

    let sql = `SELECT id, name, email, phone, tax_id, client_type, status, created_at
                 FROM clients
                WHERE deleted_at IS NULL AND (${matchClauses.join(' OR ')})`;

    if (orgId !== null) { sql += ' AND organization_id = ?'; params.push(orgId); }
    if (excludeId !== null) { sql += ' AND id <> ?'; params.push(excludeId); }

    sql += ' ORDER BY id LIMIT 50';

    const [rows] = await db.query(sql, params);
    return rows;
  }

  /**
   * Merge a source client into a target client. Reassigns the source's
   * relationship/billing records to the target, then soft-deletes the source.
   * Runs inside a transaction. Both clients must belong to `orgId`.
   *
   * @returns {Promise<{ moved: Record<string, number> }>} per-table row counts moved
   */
  static async merge(sourceId, targetId, orgId = null) {
    const db = require('../config/database');
    const { ValidationError, NotFoundError } = require('../utils/errors');

    if (String(sourceId) === String(targetId)) {
      throw new ValidationError('Cannot merge a client into itself');
    }

    const source = await this.findById(sourceId, orgId);
    if (!source) throw new NotFoundError('Source client');
    const target = await this.findById(targetId, orgId);
    if (!target) throw new NotFoundError('Target client');

    // Tables whose client_id rows are reassigned wholesale from source to target.
    const reassignTables = [
      'contracts', 'invoices', 'payments', 'tickets', 'contacts', 'quotes',
      'credit_notes', 'client_balance_ledger', 'speed_tests', 'ip_assignments',
    ];

    const conn = await db.getConnection();
    const moved = {};
    try {
      await conn.beginTransaction();

      for (const table of reassignTables) {
        const [res] = await conn.query(
          `UPDATE \`${table}\` SET client_id = ? WHERE client_id = ?`,
          [targetId, sourceId],
        );
        if (res.affectedRows > 0) moved[table] = res.affectedRows;
      }

      // Custom fields: only move keys the target does not already have, to respect
      // the (client_id, field_key) unique constraint.
      const [cf] = await conn.query(
        `UPDATE client_custom_fields s
            LEFT JOIN client_custom_fields t
              ON t.client_id = ? AND t.field_key = s.field_key AND t.deleted_at IS NULL
            SET s.client_id = ?
          WHERE s.client_id = ? AND s.deleted_at IS NULL AND t.id IS NULL`,
        [targetId, targetId, sourceId],
      );
      if (cf.affectedRows > 0) moved.client_custom_fields = cf.affectedRows;

      // Files (ID documents, photos, notification logs).
      const [files] = await conn.query(
        'UPDATE files SET entity_id = ? WHERE entity_type = \'client\' AND entity_id = ?',
        [targetId, sourceId],
      );
      if (files.affectedRows > 0) moved.files = files.affectedRows;

      // Soft-delete the now-empty source client.
      await conn.query(
        'UPDATE clients SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
        [sourceId],
      );

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    return { moved };
  }
}

module.exports = Client;
