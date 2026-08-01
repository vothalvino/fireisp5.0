'use strict';
// =============================================================================
// FireISP 5.0 — monthly revenue summary aggregation (j52)
// =============================================================================
// revenue_summary is read by five queries in reportService (Churn Revenue
// Impact, Capacity Forecast, …) and was written by nothing.
// `populate_revenue_summary` returned "populated by MySQL scheduled event" for
// an event that never existed, and a returned message counts as success — so
// the task went green nightly while those reports had no data at all.
//
// What is worth testing here is the DEFINITIONS, because every one of them is a
// choice that can be silently wrong:
//
//   * An annual contract contributes price/12 to MRR, not price. Getting this
//     wrong inflates MRR twelvefold for annual customers and nothing errors.
//   * price_override beats plan price, and the contract's billing_cycle beats
//     the plan's — taking one override while ignoring the other is the obvious
//     way to be subtly wrong.
//   * "Active" and "outstanding" must be evaluated AT THE END OF THE PERIOD.
//     Recomputing March using today's roster silently rewrites history.
//   * Draft invoices are not revenue.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(), queryReplica: jest.fn(), execute: jest.fn(),
  getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/models/Organization', () => ({ getCurrency: jest.fn() }));

const db = require('../src/config/database');
const Organization = require('../src/models/Organization');
const agg = require('../src/services/revenueSummaryAggregator');

function wire({ contracts = {}, flow = {}, money = {}, currency = 'MXN', orgs = [{ id: 1 }, { id: 2 }] } = {}) {
  Organization.getCurrency.mockResolvedValue(currency);
  db.query.mockImplementation(async (sql) => {
    if (/FROM contracts c\s+JOIN plans p/.test(sql)) {
      return [[{ total_mrr: '0', total_contracts_active: 0, total_clients_active: 0, ...contracts }]];
    }
    if (/new_contracts/.test(sql) && /churned_contracts/.test(sql)) {
      return [[{ new_contracts: 0, churned_contracts: 0, ...flow }]];
    }
    if (/total_outstanding/.test(sql)) {
      return [[{ total_revenue: '0', total_collected: '0', total_outstanding: '0', ...money }]];
    }
    if (/^INSERT INTO revenue_summary/.test(sql)) return [{ affectedRows: 1 }];
    if (/FROM organizations/.test(sql)) return [orgs];
    return [[]];
  });
}
const insert = () => db.query.mock.calls.find(([s]) => /^INSERT INTO revenue_summary/.test(s));
const sqlFor = (re) => db.query.mock.calls.find(([s]) => re.test(s))[0];

beforeEach(() => { jest.clearAllMocks(); wire(); });

describe('MRR normalises the billing cycle', () => {
  it('divides by the right number of months per cycle', () => {
    expect(agg.CYCLE_MONTHS).toEqual({ monthly: 1, quarterly: 3, semi_annual: 6, annual: 12 });
  });

  it('an annual contract contributes price/12, not price', async () => {
    // The failure this prevents inflates MRR twelvefold for annual customers
    // and produces no error anywhere.
    await agg.populate(1, '2026-07-01');
    const sql = sqlFor(/JOIN plans p/);
    expect(sql).toMatch(/WHEN 'annual'\s+THEN 12/);
    expect(sql).toMatch(/WHEN 'quarterly'\s+THEN 3/);
    expect(sql).toMatch(/WHEN 'semi_annual'\s+THEN 6/);
  });

  it("uses the CONTRACT's cycle over the plan's", async () => {
    await agg.populate(1, '2026-07-01');
    expect(sqlFor(/JOIN plans p/)).toMatch(/COALESCE\(c\.billing_cycle, p\.billing_cycle\)/);
  });

  it("uses the CONTRACT's price override over the plan's price", async () => {
    // Taking one override while ignoring the other is the subtle version of
    // this bug, so both are asserted.
    await agg.populate(1, '2026-07-01');
    expect(sqlFor(/JOIN plans p/)).toMatch(/COALESCE\(c\.price_override, p\.price\)/);
  });
});

describe('the period is a point in the past, not today', () => {
  it('counts contracts active at the END of the period', async () => {
    // Recomputing March must describe March, not today's roster.
    await agg.populate(1, '2026-03-01');
    const sql = sqlFor(/JOIN plans p/);
    expect(sql).toMatch(/c\.start_date <= LAST_DAY\(\?\)/);
    expect(sql).toMatch(/c\.end_date IS NULL OR c\.end_date >= LAST_DAY\(\?\)/);
    expect(sql).not.toMatch(/CURDATE\(\)|NOW\(\)/);
  });

  it('measures outstanding as at the end of the period', async () => {
    await agg.populate(1, '2026-03-01');
    expect(sqlFor(/total_outstanding/)).toMatch(/i\.issue_date <= LAST_DAY\(\?\)/);
  });

  it('bounds new and churned contracts to the period', async () => {
    await agg.populate(1, '2026-03-01');
    const sql = sqlFor(/churned_contracts/);
    expect(sql).toMatch(/c\.start_date BETWEEN \? AND LAST_DAY\(\?\)/);
    expect(sql).toMatch(/c\.end_date BETWEEN \? AND LAST_DAY\(\?\)/);
  });

  it('does not attribute a churn with no end_date to an arbitrary month', async () => {
    // end_date is the only ending this schema records — there is no
    // cancelled_at — so a contract cancelled without one is left uncounted
    // rather than dropped into whichever month happens to be running.
    await agg.populate(1, '2026-03-01');
    expect(sqlFor(/churned_contracts/)).toMatch(/c\.end_date IS NOT NULL/);
  });
});

describe('money definitions', () => {
  it('excludes draft, cancelled and void invoices from revenue', async () => {
    // A draft is not revenue. Counting it would overstate every month.
    await agg.populate(1, '2026-07-01');
    expect(sqlFor(/total_revenue/)).toMatch(/i\.status NOT IN \('draft','cancelled','void'\)/);
  });

  it('counts only COMPLETED payments as collected', async () => {
    await agg.populate(1, '2026-07-01');
    expect(sqlFor(/total_collected/)).toMatch(/pay\.status = 'completed'/);
  });

  it('treats only unpaid statuses as outstanding', async () => {
    await agg.populate(1, '2026-07-01');
    expect(sqlFor(/total_outstanding/)).toMatch(/i\.status IN \('issued','sent','overdue'\)/);
  });

  it('scopes every query to the organisation', async () => {
    await agg.populate(1, '2026-07-01');
    for (const re of [/JOIN plans p/, /churned_contracts/, /total_outstanding/]) {
      expect(sqlFor(re)).toMatch(/organization_id = \?/);
    }
  });
});

describe('ARPU', () => {
  it('is MRR divided by active clients', async () => {
    wire({ contracts: { total_mrr: '1000.00', total_clients_active: 8, total_contracts_active: 8 } });
    const res = await agg.populate(1, '2026-07-01');
    expect(res.arpu).toBe(125);
  });

  it('is 0 rather than Infinity when there are no clients', async () => {
    // The column is NOT NULL, so 0 is what the schema allows — but the guard
    // exists to stop Infinity/NaN reaching a DECIMAL column at all.
    wire({ contracts: { total_mrr: '500.00', total_clients_active: 0 } });
    const res = await agg.populate(1, '2026-07-01');
    expect(res.arpu).toBe(0);
  });
});

describe('writing', () => {
  it('upserts, so a daily recompute does not duplicate the month', async () => {
    await agg.populate(1, '2026-07-01');
    expect(insert()[0]).toMatch(/ON DUPLICATE KEY UPDATE/);
  });

  it("stamps the organisation's currency", async () => {
    wire({ currency: 'USD' });
    const res = await agg.populate(1, '2026-07-01');
    expect(res.currency).toBe('USD');
    expect(insert()[1]).toContain('USD');
  });

  it('records when it was calculated', async () => {
    await agg.populate(1, '2026-07-01');
    expect(insert()[0]).toMatch(/calculated_at\s+= NOW\(\)/);
  });

  it('defaults to the current month', async () => {
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const res = await agg.populate(1);
    expect(res.period_date).toBe(expected);
  });

  it('fans out across every active organisation when given none', async () => {
    // The seeded task (migration 123) carries organization_id NULL, meaning
    // "the whole install". An earlier version of this threw instead — which
    // would have turned a task that silently did nothing into one that FAILED
    // every night on every install, unfixable without editing the database.
    const res = await agg.populate(null, '2026-07-01');
    expect(res.organizations).toBe(2);
    const inserts = db.query.mock.calls.filter(([s]) => /^INSERT INTO revenue_summary/.test(s));
    expect(inserts).toHaveLength(2);
  });

  it('only fans out to ACTIVE organisations', async () => {
    await agg.populate(null, '2026-07-01');
    const q = db.query.mock.calls.find(([s]) => /FROM organizations/.test(s))[0];
    expect(q).toMatch(/status = 'active'/);
    expect(q).toMatch(/deleted_at IS NULL/);
  });

  it("one organisation's failure does not stop the others", async () => {
    // A nightly reporting job, not a transaction: bad data in one tenant must
    // not leave the rest of the install unsummarised.
    let n = 0;
    const real = db.query.getMockImplementation();
    db.query.mockImplementation(async (sql, params) => {
      if (/JOIN plans p/.test(sql) && ++n === 1) throw new Error('bad data');
      return real(sql, params);
    });
    const res = await agg.populate(null, '2026-07-01');
    expect(res.organizations).toBe(1);
  });
});

describe('the task dispatches it', () => {
  const src = () => require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../src/services/taskRunner.js'), 'utf8',
  );

  it('populate_revenue_summary calls the aggregator', () => {
    expect(src()).toMatch(/return revenueSummaryAggregator\.populate\(organizationId\)/);
  });

  it('passes the organisation straight through, null included', () => {
    // null means "the whole install" and the service fans out; the task must
    // not second-guess that by refusing.
    expect(src()).toMatch(/return revenueSummaryAggregator\.populate\(organizationId\)/);
    expect(src()).not.toMatch(/requires an organization_id/);
  });

  it('no task still claims a MySQL event populates it', () => {
    expect(src()).not.toMatch(/populated by MySQL scheduled event/);
  });
});
