// =============================================================================
// FireISP 5.0 — Geocoding Service Tests (§1.1)
// =============================================================================

const config = require('../src/config');
const { geocodeAddress, formatAddress } = require('../src/services/geocodingService');

describe('geocodingService', () => {
  const origKey = config.geocoding.googleApiKey;
  const origFetch = global.fetch;

  afterEach(() => {
    config.geocoding.googleApiKey = origKey;
    global.fetch = origFetch;
    jest.restoreAllMocks();
  });

  describe('formatAddress', () => {
    test('joins non-empty parts with commas', () => {
      expect(formatAddress({ address: 'Av. Reforma 1', city: 'CDMX', state: '', zip_code: '06000', country: 'MX' }))
        .toBe('Av. Reforma 1, CDMX, 06000, MX');
    });
    test('returns empty string for empty input', () => {
      expect(formatAddress({})).toBe('');
    });
  });

  test('throws 503 when no API key is configured', async () => {
    config.geocoding.googleApiKey = '';
    await expect(geocodeAddress({ address: 'somewhere' })).rejects.toMatchObject({ statusCode: 503 });
  });

  test('throws 422 when the address is empty', async () => {
    config.geocoding.googleApiKey = 'test-key';
    await expect(geocodeAddress({})).rejects.toMatchObject({ statusCode: 422 });
  });

  test('returns coordinates on an OK response', async () => {
    config.geocoding.googleApiKey = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'OK',
        results: [{ geometry: { location: { lat: 19.4326, lng: -99.1332 } }, formatted_address: 'CDMX, Mexico' }],
      }),
    });
    const result = await geocodeAddress({ address: 'Zócalo', city: 'CDMX', country: 'MX' });
    expect(result).toEqual({ latitude: 19.4326, longitude: -99.1332, formatted_address: 'CDMX, Mexico' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('throws 422 when the provider returns ZERO_RESULTS', async () => {
    config.geocoding.googleApiKey = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ZERO_RESULTS', results: [] }),
    });
    await expect(geocodeAddress('nowhere at all')).rejects.toMatchObject({ statusCode: 422 });
  });

  test('throws 502 on a non-OK provider status', async () => {
    config.geocoding.googleApiKey = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'REQUEST_DENIED', results: [] }),
    });
    await expect(geocodeAddress('x')).rejects.toMatchObject({ statusCode: 502 });
  });

  test('throws 502 on an HTTP error from the provider', async () => {
    config.geocoding.googleApiKey = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(geocodeAddress('x')).rejects.toMatchObject({ statusCode: 502 });
  });
});
