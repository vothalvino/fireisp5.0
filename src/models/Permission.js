// =============================================================================
// FireISP 5.0 — Permission Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Permission extends BaseModel {
  static get tableName() { return 'permissions'; }
  static get fillable() { return ['name', 'description']; }
  static get hasOrgScope() { return false; }
}

module.exports = Permission;
