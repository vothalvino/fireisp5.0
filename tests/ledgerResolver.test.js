// =============================================================================
// FireISP 5.0 — GraphQL LedgerEntry resolver regression tests
// =============================================================================
// Guards the ClientDetail-breaking bug: the LedgerEntry.balanceAfter resolver
// read a nonexistent `balance_after` column (real column is `running_balance`),
// which made the non-null GraphQL field error and nulled the whole client query
// — so "clicking a client did not work". notes must map `description`.
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn(), execute: jest.fn(), getConnection: jest.fn() }));

const resolvers = require('../src/graphql/resolvers');

describe('GraphQL LedgerEntry field resolvers', () => {
  test('balanceAfter maps running_balance (NOT the nonexistent balance_after)', () => {
    expect(resolvers.LedgerEntry.balanceAfter({ running_balance: '12.50' })).toBe('12.50');
    // The old column name must no longer be relied upon.
    expect(resolvers.LedgerEntry.balanceAfter({ balance_after: '99.99' })).toBeUndefined();
  });

  test('notes maps the description column', () => {
    expect(resolvers.LedgerEntry.notes({ description: 'late fee' })).toBe('late fee');
    expect(resolvers.LedgerEntry.notes({ description: null })).toBeNull();
  });

  test('currency falls back when NULL (non-null GraphQL field must never throw)', () => {
    expect(resolvers.LedgerEntry.currency({ currency: 'USD' })).toBe('USD');
    // credit-balance refund rows leave currency NULL — must not return null/undefined.
    expect(resolvers.LedgerEntry.currency({ currency: null })).toBe('MXN');
    expect(resolvers.LedgerEntry.currency({})).toBe('MXN');
  });

  test('other snake_case columns map correctly', () => {
    const row = { entry_type: 'charge', reference_type: 'invoice', reference_id: 7, created_at: '2026-01-01T00:00:00Z' };
    expect(resolvers.LedgerEntry.entryType(row)).toBe('charge');
    expect(resolvers.LedgerEntry.referenceType(row)).toBe('invoice');
    expect(resolvers.LedgerEntry.referenceId(row)).toBe(7);
    expect(resolvers.LedgerEntry.createdAt(row)).toBe('2026-01-01T00:00:00Z');
  });
});
