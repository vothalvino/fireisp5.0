'use strict';
// =============================================================================
// FireISP 5.0 — daily network health aggregation (j52)
// =============================================================================
// network_health_snapshots was read by three places since migration 117 and
// written by nothing. `populate_network_health_snapshots` returned the string
// "populated by MySQL scheduled event" for an event that was never written, so
// it reported SUCCESS nightly while doing nothing and /network-health has been
// empty for its entire existence — a green job feeding a blank page, which is
// worse than an obviously missing feature because nobody gets a signal.
//
// The properties worth testing are the ARITHMETIC and the HONESTY, not that a
// function runs:
//
//   * ifInOctets is a COUNTER. Averaging it is meaningless; the traffic in an
//     hour is max - min. Getting this wrong produces a plausible-looking number
//     that is off by orders of magnitude, which nobody would catch by eye.
//   * A counter reset must be DISCARDED, not clamped to zero — a fabricated
//     zero drags the daily average down and understates the link.
//   * packet_loss_pct must stay NULL. There is no source for it, and a
//     confident 0.00% on an SLA report is a lie.
//   * The upsert must be idempotent, or a retry double-counts the day.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(), queryReplica: jest.fn(), execute: jest.fn(),
  getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));

const db = require('../src/config/database');
const agg = require('../src/services/networkHealthAggregator');

/** rows = what the aggregate SELECT returns; outages = downtime per device. */
function wire({ rows = [], outages = [] } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (/FROM outages o/.test(sql)) return [outages];
    if (/FROM snmp_metrics_1hr/.test(sql)) return [rows];
    if (/^INSERT INTO network_health_snapshots/.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
}
const inserts = () => db.query.mock.calls.filter(([s]) => /^INSERT INTO network_health_snapshots/.test(s));
const aggregateSql = () => db.query.mock.calls.find(([s]) => /FROM snmp_metrics_1hr/.test(s))[0];

const DEVICE = {
  device_id: 7, organization_id: 1,
  avg_latency_ms: '12.50', max_latency_ms: '40.00',
  avg_throughput_in_mbps: '95.500', peak_throughput_in_mbps: '480.250',
  avg_throughput_out_mbps: '20.100', peak_throughput_out_mbps: '75.000',
};

beforeEach(() => { jest.clearAllMocks(); wire({ rows: [DEVICE] }); });

describe('throughput is a counter DELTA, not an average', () => {
  // These inspect the emitted SQL, so the query has to have been emitted.
  beforeEach(async () => { await agg.aggregateDay(1, '2026-07-30'); });

  it('derives Mbps from max - min, never from avg_if_in_octets', () => {
    // avg_if_in_octets is the average VALUE of an ever-increasing counter.
    // Using it would yield a number in the billions that still renders as a
    // plausible-looking Mbps figure.
    const sql = aggregateSql();
    expect(sql).toMatch(/max_if_in_octets - m\.min_if_in_octets/);
    expect(sql).not.toMatch(/avg_if_in_octets/);
    expect(sql).not.toMatch(/avg_if_out_octets/);
  });

  it('converts bytes to Mbps with the right factors', () => {
    // bytes -> bits (*8), per hour -> per second (/3600), bits -> megabits (/1e6)
    expect(aggregateSql()).toMatch(/\* 8 \/ 3600 \/ 1000000/);
  });

  it('discards an hour whose counter went BACKWARDS', () => {
    // A reboot or 32-bit wrap. CASE WHEN max >= min yields NULL, and SUM skips
    // NULL — so the hour drops out instead of contributing a negative or a zero.
    expect(aggregateSql()).toMatch(/CASE WHEN m\.max_if_in_octets >= m\.min_if_in_octets/);
  });

  it('discards an implausibly large delta too', () => {
    // A reset can also present as a huge forward jump. Clamping to zero would
    // understate the day; dropping the hour is the honest handling.
    expect(aggregateSql()).toMatch(/<= \?\s+THEN per_hour\.in_raw/);
    expect(agg.MAX_PLAUSIBLE_MBPS).toBeGreaterThan(100000);
  });

  it('sums across interfaces so the figure is device total', () => {
    expect(aggregateSql()).toMatch(/GROUP BY m\.device_id, m\.period_start/);
  });
});

describe('uptime comes from outages, not from missing metrics', () => {
  it('a full-day outage yields 0% uptime and 1440 minutes', async () => {
    wire({ rows: [DEVICE], outages: [{ device_id: 7, minutes_down: 1440 }] });
    await agg.aggregateDay(1, '2026-07-30');
    const [, params] = inserts()[0];
    expect(params[4]).toBe(0);      // uptime_pct
    expect(params[11]).toBe(1440);  // total_downtime_minutes
  });

  it('no outage yields 100%', async () => {
    await agg.aggregateDay(1, '2026-07-30');
    expect(inserts()[0][1][4]).toBe(100);
  });

  it('a six-hour outage yields 75%', async () => {
    wire({ rows: [DEVICE], outages: [{ device_id: 7, minutes_down: 360 }] });
    await agg.aggregateDay(1, '2026-07-30');
    expect(inserts()[0][1][4]).toBe(75);
  });

  it('caps at a day, so a multi-day outage cannot go negative', async () => {
    // The SQL clamps to the day's bounds, but a bad row must not produce
    // uptime_pct = -300, which would fail the DECIMAL(5,2) column anyway.
    wire({ rows: [DEVICE], outages: [{ device_id: 7, minutes_down: 99999 }] });
    await agg.aggregateDay(1, '2026-07-30');
    expect(inserts()[0][1][4]).toBe(0);
    expect(inserts()[0][1][11]).toBe(1440);
  });

  it('clamps each outage to the day rather than counting its whole length', async () => {
    await agg.aggregateDay(1, '2026-07-30');
    const sql = db.query.mock.calls.find(([s]) => /FROM outages o/.test(s))[0];
    expect(sql).toMatch(/GREATEST\(o\.started_at, \?\)/);
    expect(sql).toMatch(/LEAST\(COALESCE\(o\.resolved_at, NOW\(\)\)/);
  });

  it('counts an unresolved outage up to now', async () => {
    await agg.aggregateDay(1, '2026-07-30');
    const sql = db.query.mock.calls.find(([s]) => /FROM outages o/.test(s))[0];
    expect(sql).toMatch(/COALESCE\(o\.resolved_at, NOW\(\)\)/);
  });
});

describe('it does not invent numbers it does not have', () => {
  it('writes packet_loss_pct as NULL', async () => {
    // There is no packet-loss column in snmp_metrics_1hr. A confident 0.00% on
    // an SLA report is a lie, and this job exists because something reported
    // success while knowing nothing.
    await agg.aggregateDay(1, '2026-07-30');
    expect(inserts()[0][0]).toMatch(/packet_loss_pct/);
    expect(inserts()[0][0]).toMatch(/VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, NULL, \?\)/);
  });

  it('keeps a missing latency as NULL rather than 0', async () => {
    wire({ rows: [{ ...DEVICE, avg_latency_ms: null, max_latency_ms: null }] });
    await agg.aggregateDay(1, '2026-07-30');
    const params = inserts()[0][1];
    expect(params[5]).toBeNull();
    expect(params[6]).toBeNull();
  });

  it('converts DECIMAL strings to numbers', async () => {
    await agg.aggregateDay(1, '2026-07-30');
    expect(inserts()[0][1][7]).toBe(95.5);
  });
});

describe('re-running a day must not double-count it', () => {
  it('upserts rather than inserting', async () => {
    await agg.aggregateDay(1, '2026-07-30');
    expect(inserts()[0][0]).toMatch(/ON DUPLICATE KEY UPDATE/);
  });

  it('writes subject_key, because it is NOT a generated column', async () => {
    // The obvious design was a generated column, and it cannot work here:
    // MySQL prohibits ON UPDATE CASCADE / ON DELETE SET NULL on a base column
    // of a generated column, and this table carries exactly those on device_id
    // and network_link_id. Four real-MySQL CI jobs reported
    // ER_CANNOT_ADD_FOREIGN before this was a plain column. So the aggregator —
    // the only writer of this table — has to populate it.
    await agg.aggregateDay(1, '2026-07-30');
    expect(inserts()[0][0]).toMatch(/subject_key/);
    expect(inserts()[0][1][0]).toBe('7:0');
  });

  it('folds the NULL half of the key to 0', () => {
    // Without that, MySQL treats the NULLs as distinct and the unique key
    // stops preventing anything — which is the whole point of the column.
    const mig = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../database/migrations/441_network_health_snapshot_key.sql'), 'utf8',
    );
    expect(mig).toMatch(/COALESCE\(device_id, 0\), ':', COALESCE\(network_link_id, 0\)/);
    expect(mig).not.toMatch(/GENERATED ALWAYS AS/);
  });
});

describe('scoping and defaults', () => {
  it('aggregates every org when given null, without a bare equality', async () => {
    // Single-tenant installs carry NULL organization_id on devices, so
    // `d.organization_id = NULL` would match nothing and silently produce zero
    // snapshots on exactly the installs most likely to be single-tenant.
    await agg.aggregateDay(null, '2026-07-30');
    expect(aggregateSql()).toMatch(/\? IS NULL OR d\.organization_id = \?/);
  });

  it('defaults to YESTERDAY, not today', async () => {
    // Today is still accumulating; writing a partial day as final understates
    // throughput and uptime for whatever has not happened yet.
    const y = new Date(Date.now() - 86400000);
    const expected = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    const res = await agg.aggregateDay(1);
    expect(res.snapshot_date).toBe(expected);
  });

  it('reports how many devices it wrote', async () => {
    const res = await agg.aggregateDay(1, '2026-07-30');
    expect(res).toEqual({ snapshot_date: '2026-07-30', devices: 1 });
  });

  it('writes nothing when there are no metrics', async () => {
    wire({ rows: [] });
    const res = await agg.aggregateDay(1, '2026-07-30');
    expect(res.devices).toBe(0);
    expect(inserts()).toHaveLength(0);
  });
});

describe('the task no longer lies about doing nothing', () => {
  const src = () => require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../src/services/taskRunner.js'), 'utf8',
  );

  it('populate_network_health_snapshots actually aggregates', () => {
    expect(src()).toMatch(/case 'populate_network_health_snapshots':\s*\n\s*return networkHealthAggregator\.aggregateDay/);
  });

  it('populate_revenue_summary does real work too', () => {
    // Implemented in the sibling PR. It briefly threw "not implemented" — an
    // honest interim state — and now aggregates.
    const s = src();
    expect(s).toMatch(/return revenueSummaryAggregator\.populate\(organizationId\)/);
    expect(s).not.toMatch(/Revenue summary is populated by MySQL scheduled event/);
  });

  it('no task still claims a MySQL event populates it', () => {
    expect(src()).not.toMatch(/populated by MySQL scheduled event/);
  });
});
