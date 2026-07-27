'use strict';
// =============================================================================
// FireISP 5.0 — Mexican border-region IVA (8% vs 16%) by postal code
// =============================================================================
// Mexico has two IVA rates. The standard is 16%, but the "estímulo fiscal
// región fronteriza" decrees (norte, DOF 31/12/2018; sur, DOF 30/12/2020)
// reduce it to 8%. Until migration 428 the resolver had exactly one rate per
// org, so an ISP serving both sides of the line had to bill half its customers
// wrongly.
//
// The trigger is the client's SERVICE address (clients.zip_code), not their
// fiscal domicile: the stimulus attaches to where the service is PROVIDED, and
// a subscriber can be billed to an address far from their line.
//
// THE SAFE DIRECTION IS 16%. An unmatched, missing or malformed ZIP falls
// through to the org default. Over-taxing is recoverable with a credit note;
// under-taxing is a liability with SAT — so most of what is asserted here is
// the cases that must NOT get 8%.
//
// (Applying 8% at all also requires the ISP to be enrolled in SAT's padrón de
// beneficiarios. That is an operator obligation, not something code can check.)
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/models/Organization', () => ({ getLocale: jest.fn(), getCurrency: jest.fn() }));

const Organization = require('../src/models/Organization');
const {
  resolveTaxContext, normalizePostalCode, postalSpecMatch,
} = require('../src/services/billingService');

const BORDER_NORTE = '21000-22999,32000-32699,26000-26099,26200-26299,65000-65099,83400-83499,84000-84099,84200-84299,87300-87499,88000-88299,88500-88799';

/**
 * exec stub: a client with the given zip, the seeded border rules, and a 16%
 * org default in tax_rates.
 */
function execFor({ zip, exempt = false, rules = [{ id: 1, rate: '0.0800', postal_codes: BORDER_NORTE }], defaultRate = '0.1600' }) {
  return jest.fn(async (sql) => {
    if (/FROM clients/.test(sql)) return [[{ tax_exempt: exempt ? 1 : 0, locale: 'MX', zip_code: zip }]];
    if (/FROM tax_rules/.test(sql)) return [rules];
    if (/FROM tax_rates/.test(sql)) return [defaultRate === null ? [] : [{ id: 9, rate: defaultRate }]];
    return [[]];
  });
}
const resolve = (opts) => resolveTaxContext(execFor(opts), { orgId: 1, clientId: 5 });

beforeEach(() => {
  jest.clearAllMocks();
  Organization.getLocale.mockResolvedValue('MX');
});

describe('a border ZIP gets 8%', () => {
  it.each([
    ['22000', 'Tijuana, Baja California'],
    ['21000', 'Mexicali — lower edge of the BC range'],
    ['22999', 'upper edge of the BC range'],
    ['32000', 'Ciudad Juárez'],
    ['88000', 'Nuevo Laredo'],
    ['88500', 'Reynosa'],
  ])('%s (%s)', async (zip) => {
    const r = await resolve({ zip });
    expect(r.rate).toBe(0.08);
    expect(r.exempt).toBe(false);
  });
});

describe('everything else stays at 16% — the safe direction', () => {
  it.each([
    ['06000', 'Mexico City — nowhere near the border'],
    ['20999', 'one below the BC range'],
    ['23000', 'one above the BC range'],
    ['44100', 'Guadalajara'],
  ])('%s (%s) falls through to the org default', async (zip) => {
    expect((await resolve({ zip })).rate).toBe(0.16);
  });

  it.each([
    [null, 'no ZIP recorded'],
    ['', 'empty string'],
    ['n/a', 'junk text'],
    ['2200', 'only four digits'],
  ])('%s (%s) never guesses a border rate', async (zip) => {
    // Guessing out of malformed input would under-tax, which is the direction
    // that costs the operator money with SAT.
    expect((await resolve({ zip })).rate).toBe(0.16);
  });

  it('an exempt client is still exempt, border or not', async () => {
    const r = await resolve({ zip: '22000', exempt: true });
    expect(r).toEqual({ rate: 0, taxRateId: null, exempt: true });
  });

  it('does not consult region rules when an explicit tax_rate_id was chosen', async () => {
    // An operator override wins over geography.
    const exec = execFor({ zip: '22000' });
    await resolveTaxContext(exec, { orgId: 1, clientId: 5, contractTaxRateId: 9 });
    expect(exec.mock.calls.some(c => /FROM tax_rules/.test(c[0]))).toBe(false);
  });
});

describe('postal code normalisation', () => {
  it.each([
    ['22000', '22000'],
    ['  22000  ', '22000'],
    ['CP 22000', '22000'],
    ['22000-1234', '22000'],
  ])('%s -> %s', (raw, want) => expect(normalizePostalCode(raw)).toBe(want));

  it.each([null, undefined, '', 'n/a', '2200', '123'])('%s -> null', (raw) => {
    expect(normalizePostalCode(raw)).toBeNull();
  });

  it('refuses an ambiguous string holding two unrelated codes', () => {
    // "22000 o 06000" must not silently pick the border one.
    expect(normalizePostalCode('22000 o 06000')).toBeNull();
  });
});

describe('rule matching is deterministic when several rules match', () => {
  it('the narrowest range wins, so a specific rule beats a broad one', async () => {
    // Migration 427 exists because an ORDER BY that could return either of two
    // rows silently billed some invoices at the wrong rate. This lookup must
    // not reintroduce that: given both a wide and a narrow match, the answer is
    // never "whichever came back first".
    const r = await resolve({
      zip: '22000',
      rules: [
        { id: 1, rate: '0.0800', postal_codes: '21000-22999' },  // wide
        { id: 2, rate: '0.0500', postal_codes: '22000' },        // exact
      ],
    });
    expect(r.rate).toBe(0.05);
  });

  it('ignores a rule with no postal_codes', async () => {
    const r = await resolve({ zip: '22000', rules: [{ id: 3, rate: '0.0800', postal_codes: null }] });
    expect(r.rate).toBe(0.16);
  });
});

describe('postalSpecMatch', () => {
  it('matches single codes and ranges, and reports the narrower one', () => {
    expect(postalSpecMatch('21000-22999', '22000')).toBe(2000);
    expect(postalSpecMatch('22000', '22000')).toBe(1);
    expect(postalSpecMatch('21000-22999,88000', '88000')).toBe(1);
  });

  it('returns null when nothing matches', () => {
    expect(postalSpecMatch('21000-22999', '44100')).toBeNull();
    expect(postalSpecMatch('', '22000')).toBeNull();
    expect(postalSpecMatch(null, '22000')).toBeNull();
  });

  it('tolerates whitespace and a reversed range', () => {
    expect(postalSpecMatch(' 21000 - 22999 , 88000 ', '22000')).toBe(2000);
    expect(postalSpecMatch('22999-21000', '22000')).toBe(2000);
  });
});
