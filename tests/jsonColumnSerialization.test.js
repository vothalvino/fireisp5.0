// =============================================================================
// FireISP 5.0 — JSON-column serialization on models with normalizeInput
// =============================================================================
// concession_titles.services_authorized is JSON NOT NULL and payment_gateways
// .config_json is JSON. The validators accept plain strings, so the models must
// serialize into valid JSON before the INSERT or it fails "Invalid JSON text".

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const ConcessionTitle = require('../src/models/ConcessionTitle');
const PaymentGateway = require('../src/models/PaymentGateway');

describe('ConcessionTitle.normalizeInput — JSON list columns', () => {
  test('wraps a comma-separated services string into a JSON array', () => {
    const out = ConcessionTitle.normalizeInput({ services_authorized: 'Internet fijo, telefonía' });
    expect(out.services_authorized).toBe(JSON.stringify(['Internet fijo', 'telefonía']));
    expect(() => JSON.parse(out.services_authorized)).not.toThrow();
  });

  test('stringifies an array and passes an existing JSON-array string through', () => {
    expect(ConcessionTitle.normalizeInput({ spectrum_bands: ['2.4GHz', '5GHz'] }).spectrum_bands)
      .toBe(JSON.stringify(['2.4GHz', '5GHz']));
    const already = JSON.stringify(['AWS']);
    expect(ConcessionTitle.normalizeInput({ services_authorized: already }).services_authorized).toBe(already);
  });

  test('leaves null/undefined untouched', () => {
    expect(ConcessionTitle.normalizeInput({ spectrum_bands: null }).spectrum_bands).toBeNull();
    expect(ConcessionTitle.normalizeInput({ title_number: 'CT-1' }).services_authorized).toBeUndefined();
  });
});

describe('PaymentGateway.normalizeInput — config_json', () => {
  test('stringifies an object and passes valid JSON through', () => {
    expect(PaymentGateway.normalizeInput({ config_json: { a: 1 } }).config_json).toBe('{"a":1}');
    expect(PaymentGateway.normalizeInput({ config_json: '{"b":2}' }).config_json).toBe('{"b":2}');
  });

  test('wraps a non-JSON string so it cannot fail the INSERT', () => {
    const out = PaymentGateway.normalizeInput({ config_json: 'not json' });
    expect(() => JSON.parse(out.config_json)).not.toThrow();
    expect(out.config_json).toBe('"not json"');
  });
});
