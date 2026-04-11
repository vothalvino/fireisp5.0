// =============================================================================
// FireISP 5.0 — Contact Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Contact extends BaseModel {
  static get tableName() { return 'contacts'; }

  static get fillable() {
    return [
      'client_id', 'first_name', 'last_name', 'email', 'phone',
      'role', 'is_primary', 'notes',
    ];
  }

  static get hasOrgScope() { return false; }
}

module.exports = Contact;
