// =============================================================================
// FireISP 5.0 — ClientBalanceLedger Model
// =============================================================================

const BaseModel = require('./BaseModel');

// NOTE: this table is a HISTORY / audit trail (the Ledger tab, the statement
// PDF, GET /clients/:id/balance-ledger, GraphQL Client.ledger) — it is NOT
// the source of a client's current account balance. Not every money path
// writes a ledger entry consistently, so its running total can drift from
// reality (e.g. an invoice generated with no matching debit row). The
// headline "Account Balance" shown anywhere in the product is computed live
// from invoices + payments by src/services/clientBalanceService.js instead.
class ClientBalanceLedger extends BaseModel {
  static get tableName() { return 'client_balance_ledger'; }

  static get fillable() {
    return [
      'organization_id', 'client_id', 'balance_type', 'amount',
      'entry_type', 'reference_id', 'description',
    ];
  }

  static get hasOrgScope() { return true; }

  // Signed amount for balance math (postpaid: positive = the client owes us).
  // Reconciles BOTH ledger representations — the amount+entry_type writers and
  // the debit/credit refund path — since each row populates exactly one. Single
  // source of truth so the GraphQL resolver and the REST endpoint can never
  // drift apart (representation drift is what made the ledger read as 0.00).
  static get signedAmountSql() {
    return "(CASE WHEN entry_type IN ('invoice','usage_deduction','debit') "
      + 'THEN amount ELSE -amount END) + debit - credit';
  }
}

module.exports = ClientBalanceLedger;
