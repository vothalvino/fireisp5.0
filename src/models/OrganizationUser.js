// =============================================================================
// FireISP 5.0 — OrganizationUser Model
// =============================================================================

const BaseModel = require('./BaseModel');

class OrganizationUser extends BaseModel {
  static get tableName() { return 'organization_users'; }
  static get fillable() { return ['organization_id', 'user_id', 'role']; }
  static get hasOrgScope() { return true; }
}

module.exports = OrganizationUser;
