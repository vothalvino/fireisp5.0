'use strict';
// =============================================================================
// FireISP 5.0 — a new fiscal document may not contradict the resolved tax
// =============================================================================
// Two directions, both of which put a false statement in front of SAT on a
// document that cannot be un-sent:
//
//   * tax on an IVA-EXEMPT client — was already rejected on POST /invoices;
//   * NO tax when a rate applies — was NOT. `subtotal 100 / total 100` with no
//     tax fields infers tax_amount 0, satisfies both of the route's existing
//     invariants (tax matches rate, total matches subtotal + tax), and stamps
//     ObjetoImp=01 with no Impuestos node: a positive assertion to the tax
//     authority that the sale was not taxable.
//
// The guard REJECTS rather than rewriting. An operator who sent 1000.00 and got
// back an invoice for 1160.00 has been handed a document they never approved; a
// 422 is recoverable, a silently altered fiscal total is not.
//
// The hard part is not firing where it should not. It compares against
// resolveTaxContext instead of re-deriving locale rules, so a non-MX org — or an
// MX org that has deliberately configured 0% — is never blocked. Those cases
// are the bulk of what is asserted below, because a guard that breaks every
// non-Mexican deployment is worse than the bug.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/models/Organization', () => ({ getLocale: jest.fn(), getCurrency: jest.fn() }));

const Organization = require('../src/models/Organization');
const { assertTaxCoherentForCreate } = require('../src/services/billingService');

/**
 * Stand-in for db.query. resolveTaxContext issues two reads: the client row,
 * then the tax_rates row.
 */
function execFor({ exempt = false, clientLocale = 'MX', rate = null }) {
  return jest.fn(async (sql) => {
    if (/FROM clients/.test(sql)) {
      return [[{ tax_exempt: exempt ? 1 : 0, locale: clientLocale }]];
    }
    if (/FROM tax_rates/.test(sql)) {
      return rate === null ? [[]] : [[{ id: 7, rate: String(rate) }]];
    }
    return [[]];
  });
}

const call = (exec, over = {}) => assertTaxCoherentForCreate(exec, {
  orgId: 1, clientId: 5, taxAmount: 0, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  Organization.getLocale.mockResolvedValue('MX');
});

describe('rejects a zero-tax document when a rate applies', () => {
  it('rejects when the org has a 16% default and the caller sent no tax', async () => {
    await expect(call(execFor({ rate: 0.16 })))
      .rejects.toMatchObject({ statusCode: 422, code: 'TAX_REQUIRED' });
  });

  it('rejects on the MX 16% fallback, with no configured rate at all', async () => {
    // resolveTaxContext's safety net for an MX org — the case an operator hits
    // before they have configured Settings → Taxes, i.e. day one.
    await expect(call(execFor({ rate: null })))
      .rejects.toMatchObject({ statusCode: 422, code: 'TAX_REQUIRED' });
  });

  it('names the rate that applies, so the message is actionable', async () => {
    await expect(call(execFor({ rate: 0.16 }))).rejects.toThrow(/16%/);
  });

  it('treats a rounding crumb as no tax', async () => {
    // Half a cent is not tax; without a tolerance a 0.001 artefact would slip
    // through the guard entirely.
    await expect(call(execFor({ rate: 0.16 }), { taxAmount: 0.004 }))
      .rejects.toMatchObject({ code: 'TAX_REQUIRED' });
  });

  it('cannot be excused by naming a 0% tax_rate_id', async () => {
    // The vector that would defeat this guard entirely. Migration 121 seeds a
    // SHARED rate ('Tax Exempt', 0.0000, organization_id NULL, active) and the
    // explicit-id branch of resolveTaxContext admits organization_id IS NULL by
    // design — so passing the caller's own tax_rate_id into the resolver makes
    // the check circular and it always passes.
    //
    // The guard therefore does not accept a rate id at all. This asserts the
    // resolver is asked what SHOULD apply, with no explicit-id parameter: the
    // second bind of the tax_rates query is the org, and the id binds are the
    // `|| 0` sentinel, never a caller value.
    const exec = execFor({ rate: 0.16 });
    // Passed under BOTH plausible names: the parameter the guard used to accept
    // (contractTaxRateId) and the request field it came from (tax_rate_id).
    // Using only the latter made this assertion pass even with the circular
    // parameter restored — the mutation flowed through a name the test never set.
    await expect(call(exec, { taxAmount: 0, contractTaxRateId: 999, tax_rate_id: 999 }))
      .rejects.toMatchObject({ code: 'TAX_REQUIRED' });

    const rateQuery = exec.mock.calls.find(c => /FROM tax_rates/.test(c[0]));
    expect(rateQuery[1][0]).toBe(0);   // explicit-id bind is the sentinel...
    expect(rateQuery[1][3]).toBe(0);   // ...in the ORDER BY too
  });

  it('rejects a DECIMAL zero arriving as the STRING "0.00"', async () => {
    // MySQL round-trips DECIMAL as a string, and the quote path passes
    // quote.tax_amount straight from a row. A truthy check on '0.00' is TRUE,
    // so a non-numeric comparison would silently pass every zero-tax quote.
    await expect(call(execFor({ rate: 0.16 }), { taxAmount: '0.00' }))
      .rejects.toMatchObject({ code: 'TAX_REQUIRED' });
  });
});

describe('rejects tax on an exempt client', () => {
  it('rejects the other direction too', async () => {
    await expect(call(execFor({ exempt: true }), { taxAmount: 16 }))
      .rejects.toMatchObject({ statusCode: 422, code: 'CLIENT_TAX_EXEMPT' });
  });

  it('says "quote" when converting a quote', async () => {
    await expect(call(execFor({ exempt: true }), { taxAmount: 16, docType: 'quote' }))
      .rejects.toThrow(/quote/);
  });
});

describe('does NOT fire where zero tax is correct', () => {
  it('allows zero tax for an exempt client', async () => {
    await expect(call(execFor({ exempt: true }))).resolves.toBeUndefined();
  });

  it('allows zero tax for a non-MX org with no configured rate', async () => {
    // The one that would break every non-Mexican deployment. resolveTaxContext
    // returns rate 0 here, so there is nothing to contradict.
    Organization.getLocale.mockResolvedValue('US');
    await expect(call(execFor({ rate: null, clientLocale: 'US' }))).resolves.toBeUndefined();
  });

  it('allows zero tax when the org deliberately configured a 0% default', async () => {
    // An MX org may legitimately run 0% (exports). The guard must follow the
    // configured rate, not a hardcoded assumption about Mexico.
    await expect(call(execFor({ rate: 0 }))).resolves.toBeUndefined();
  });

  it('allows a document that carries tax', async () => {
    await expect(call(execFor({ rate: 0.16 }), { taxAmount: 16 })).resolves.toBeUndefined();
  });

  it('allows a NON-ZERO rate that differs from the resolved one', async () => {
    // Deliberately out of scope: a reduced rate, a mixed-rate document or a
    // per-line override is a legitimate invoice. The guard is about tax being
    // ENTIRELY ABSENT, not about matching the default.
    await expect(call(execFor({ rate: 0.16 }), { taxAmount: 8 })).resolves.toBeUndefined();
  });

  it('does nothing without a client to resolve against', async () => {
    const exec = execFor({ rate: 0.16 });
    await expect(call(exec, { clientId: null })).resolves.toBeUndefined();
    expect(exec).not.toHaveBeenCalled();
  });
});
