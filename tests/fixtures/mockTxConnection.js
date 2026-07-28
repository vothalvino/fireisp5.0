'use strict';
// =============================================================================
// FireISP 5.0 — mock transaction connection
// =============================================================================
// crudController's transactionalUpdate path takes a real connection out of the
// pool (db.getConnection) and runs the fetch, the guard and the UPDATE on it.
// Suites mock db.getConnection as a bare jest.fn(), which resolves to undefined
// and then dies on conn.beginTransaction().
//
// This wires getConnection to a connection whose execute/query DELEGATE to the
// suite's existing db.query mock. That matters: it means every SQL dispatcher a
// suite has already written keeps working untouched, instead of each suite
// needing a second, parallel set of mock responses for the transactional path.
//
// The returned handle exposes the tx verbs so a test can assert them — chiefly
// that a guard which threw caused a rollback and never a commit.
// =============================================================================

function mockTxConnection(db) {
  const conn = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    // Delegate, do not duplicate — the suite's db.query mock stays the single
    // source of truth for what the database returns.
    execute: (...args) => db.query(...args),
    query: (...args) => db.query(...args),
  };
  db.getConnection.mockImplementation(async () => conn);
  return conn;
}

module.exports = { mockTxConnection };
