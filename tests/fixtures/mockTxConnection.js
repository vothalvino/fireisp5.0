'use strict';
// =============================================================================
// FireISP 5.0 — mock transaction connection
// =============================================================================
// crudController's transactionalWrites path takes a real connection out of the
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

// execute/query are jest.fn()s that FORWARD to db.query for their return value
// but record their own calls. That separation is load-bearing: if they were
// bare arrow functions, a statement run on the transaction and one run on the
// pool would land in the same db.query.mock.calls array, indistinguishable —
// and a test asserting "this ran inside the transaction" could not fail. Review
// of #584 found exactly that: a query left on db.query inside an open
// transaction (a nested pool acquire that can hang the process) was invisible
// to the suite. Assert on conn.execute, and on db.query NOT being called.
function mockTxConnection(db) {
  const conn = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn(),
    release: jest.fn(),
    // Forward for the RESULT — the suite's db.query mock stays the single
    // source of truth for what the database returns — but record separately.
    execute: jest.fn((...args) => db.query(...args)),
    query: jest.fn((...args) => db.query(...args)),
  };
  db.getConnection.mockImplementation(async () => conn);
  return conn;
}

/**
 * SQL statements that ran on the transaction connection.
 */
function txSql(conn) {
  return conn.execute.mock.calls.map(([sql]) => sql);
}

/**
 * SQL that ran on the POOL rather than on the open transaction — each one is a
 * nested connection acquire, and enough of them exhaust the pool and hang.
 *
 * conn.execute forwards to db.query for its RESULT, so every transaction
 * statement also lands in db.query.mock.calls. Subtract one db.query entry per
 * conn.execute call to get what genuinely went to the pool. `ignore` drops
 * statements that legitimately run outside the transaction — chiefly the auth
 * middleware's user lookup, which happens before the route is reached.
 */
function pooledSqlDuringTx(db, conn, ignore = /`users`/) {
  const remaining = db.query.mock.calls
    .map(([sql]) => sql)
    .filter(sql => typeof sql === 'string' && !ignore.test(sql));
  for (const [sql] of conn.execute.mock.calls) {
    const at = remaining.indexOf(sql);
    if (at !== -1) remaining.splice(at, 1);
  }
  return remaining;
}

module.exports = { mockTxConnection, txSql, pooledSqlDuringTx };
