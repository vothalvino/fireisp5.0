// =============================================================================
// FireISP 5.0 — ClientBalanceLedger Model
// =============================================================================

const BaseModel = require('./BaseModel');

class ClientBalanceLedger extends BaseModel {
  static get tableName() { return 'client_balance_ledger'; }

  static get fillable() {
    return [
      'organization_id', 'client_id', 'balance_type', 'amount',
      'entry_type', 'reference_id', 'description',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = ClientBalanceLedger;
