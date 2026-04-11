// =============================================================================
// FireISP 5.0 — Client Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Client extends BaseModel {
  static get tableName() { return 'clients'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'email', 'phone', 'client_type',
      'locale', 'tax_id', 'address', 'city', 'state', 'zip_code',
      'country', 'notes', 'status',
    ];
  }

  static get hasOrgScope() { return true; }

  /**
   * Get contacts for this client.
   */
  static async getContacts(clientId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM contacts WHERE client_id = ? ORDER BY id',
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
      'SELECT * FROM client_mx_profiles WHERE client_id = ?',
      [clientId],
    );
    return rows[0] || null;
  }
}

module.exports = Client;
