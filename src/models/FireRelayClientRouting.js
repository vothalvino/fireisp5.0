// =============================================================================
// FireISP 5.0 — FireRelayClientRouting Model
// =============================================================================

const BaseModel = require('./BaseModel');

class FireRelayClientRouting extends BaseModel {
  static get tableName() {
    return 'firerelay_client_routing';
  }

  static get fillable() {
    return ['client_id', 'node_id'];
  }

  static get hasOrgScope() {
    return false;
  }

  static get softDelete() { return true; }
}

module.exports = FireRelayClientRouting;
