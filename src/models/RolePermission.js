// =============================================================================
// FireISP 5.0 — RolePermission Model
// =============================================================================

const BaseModel = require('./BaseModel');

class RolePermission extends BaseModel {
  static get tableName() { return 'role_permissions'; }
  static get fillable() { return ['role_id', 'permission_id']; }
  static get hasOrgScope() { return false; }
}

module.exports = RolePermission;
