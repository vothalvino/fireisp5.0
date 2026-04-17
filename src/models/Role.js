// =============================================================================
// FireISP 5.0 — Role Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Role extends BaseModel {
  static get tableName() { return 'roles'; }
  static get fillable() { return ['organization_id', 'name', 'description']; }
  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = Role;
