// =============================================================================
// Primary/control-plane database context helper
// =============================================================================
// Production always exposes database.withPrimaryContext(). A large number of
// older unit/integration tests intentionally replace the database module with a
// minimal query-only double, though. Let those lightweight test adapters keep
// exercising their original route behavior without weakening the production
// tenant boundary: outside NODE_ENV=test a missing primary-context primitive is
// a hard error.

const db = require('../config/database');

function runInPrimaryContext(callback) {
  if (typeof db.withPrimaryContext === 'function') {
    return db.withPrimaryContext(callback);
  }
  if (process.env.NODE_ENV === 'test') return callback();
  throw new Error('Primary database context is unavailable');
}

module.exports = { runInPrimaryContext };
