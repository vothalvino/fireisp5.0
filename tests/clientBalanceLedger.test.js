// =============================================================================
// FireISP 5.0 — ClientBalanceLedger.signedAmountSql sign-convention guard
// =============================================================================
// Locks the balance sign convention and the single-source-of-truth invariant:
// the signed expression that powers Client.balance and the ledger running_balance
// must live in exactly ONE place. Representation drift across files is what made
// the ledger read as 0.00 in the first place.
// =============================================================================

const fs = require('fs');
const path = require('path');
const ClientBalanceLedger = require('../src/models/ClientBalanceLedger');

describe('ClientBalanceLedger.signedAmountSql', () => {
  const sql = ClientBalanceLedger.signedAmountSql;

  test('classifies invoice/usage_deduction/debit as positive (owed) and the rest as credit', () => {
    expect(sql).toContain("entry_type IN ('invoice','usage_deduction','debit')");
    expect(sql).toContain('THEN amount ELSE -amount END');
  });

  test('reconciles the debit/credit refund representation', () => {
    expect(sql).toContain('+ debit - credit');
  });

  test('is the single source of truth used by both the GraphQL resolver and the REST endpoint', () => {
    const resolvers = fs.readFileSync(path.join(__dirname, '../src/graphql/resolvers.js'), 'utf8');
    const clients = fs.readFileSync(path.join(__dirname, '../src/routes/clients.js'), 'utf8');
    expect(resolvers).toContain('ClientBalanceLedger.signedAmountSql');
    expect(clients).toContain('ClientBalanceLedger.signedAmountSql');
    // No inline duplicate of the CASE expression may be reintroduced.
    const inlineDup = /CASE WHEN entry_type IN \('invoice','usage_deduction','debit'\)/;
    expect(resolvers).not.toMatch(inlineDup);
    expect(clients).not.toMatch(inlineDup);
  });
});
