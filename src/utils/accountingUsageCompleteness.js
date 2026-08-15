'use strict';

/**
 * Build the fail-closed overlap predicate used by monetary/FUP consumers.
 *
 * Application lifecycles are unverifiable until the first accepted follow-up
 * changes their projection away from `start`. Deprecated direct-SQL rows are
 * individually unverifiable accounting events. A pre-period open observation
 * is relevant only while it overlaps the configured session-liveness window;
 * a legacy Stop ends at its event timestamp.
 *
 * `periodStartSql` and `periodEndExclusiveSql` are trusted, static SQL
 * expressions supplied by callers (normally DATE(?) / UTC_TIMESTAMP()).
 */
function buildUnverifiableSessionOverlap(
  alias = 'unverifiable',
  periodStartSql = 'DATE(?)',
  periodEndExclusiveSql = 'DATE_ADD(DATE(?), INTERVAL 1 DAY)',
) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) {
    throw new TypeError('Invalid accounting overlap SQL alias');
  }
  const parsed = Number.parseInt(process.env.RADIUS_SESSION_LIVENESS_MINUTES || '60', 10);
  const livenessMinutes = Math.min(Math.max(Number.isFinite(parsed) ? parsed : 60, 1), 1440);
  return `(${alias}.session_instance_id IS NULL OR ${alias}.event_type = 'start')
          AND CASE
                WHEN ${alias}.session_instance_id IS NULL AND ${alias}.event_type = 'stop'
                  THEN ${alias}.event_at
                ELSE DATE_ADD(
                  COALESCE(${alias}.last_accounting_received_at,
                           ${alias}.last_accounting_at,
                           ${alias}.event_at),
                  INTERVAL ${livenessMinutes} MINUTE)
              END >= ${periodStartSql}
          AND ${alias}.event_at < ${periodEndExclusiveSql}`;
}

module.exports = { buildUnverifiableSessionOverlap };
