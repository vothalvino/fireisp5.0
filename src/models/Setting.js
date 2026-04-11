// =============================================================================
// FireISP 5.0 — Setting Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Setting extends BaseModel {
  static get tableName() { return 'settings'; }
  static get fillable() { return ['organization_id', 'key', 'value', 'description']; }
  static get hasOrgScope() { return true; }
}

module.exports = Setting;
