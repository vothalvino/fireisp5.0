// =============================================================================
// FireISP 5.0 — OltSplitter Model (§7.1)
// =============================================================================

const BaseModel = require('./BaseModel');

class OltSplitter extends BaseModel {
  static get tableName() { return 'olt_splitters'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'site_id', 'olt_port_id',
      'ratio', 'splitter_type', 'location_detail', 'installed_at',
      'status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  static get sortable() {
    return ['id', 'name', 'ratio', 'status', 'created_at'];
  }
}

module.exports = OltSplitter;
