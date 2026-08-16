'use strict';

const catalog = require('../src/services/sniiCatalog');
const reviewedContract = require('./fixtures/sniiCatalogContract.json');

describe('versioned SNII artifact catalog', () => {
  test('is immutable, uniquely keyed and safe to use as an attachment filename', () => {
    expect(Object.isFrozen(catalog.ELEMENT_TYPES)).toBe(true);
    expect(catalog.CATALOG_VERSION).toMatch(/^snii-\d{4}-\d{2}-\d{2}-contract-v\d+$/);

    const slugs = new Set();
    const filenames = new Set();
    for (const element of catalog.ELEMENT_TYPES) {
      expect(Object.isFrozen(element)).toBe(true);
      expect(Object.isFrozen(element.wire_headers)).toBe(true);
      expect(Object.isFrozen(element.required_headers)).toBe(true);
      expect(element.slug).toMatch(/^[a-z0-9_]+$/);
      expect(slugs.has(element.slug)).toBe(false);
      slugs.add(element.slug);

      const generatedExtension = element.geometry === 'Point' ? 'csv' : 'kml';
      expect(element.preparation_filename).toBe(`${element.slug}.${generatedExtension}`);
      expect(element.preparation_filename).not.toMatch(/[\\/\r\n\0]/);
      expect(filenames.has(element.preparation_filename)).toBe(false);
      filenames.add(element.preparation_filename);
    }
  });

  test('does not silently invent or reorder official headers', () => {
    for (const element of catalog.ELEMENT_TYPES) {
      expect(element.wire_headers.length).toBeGreaterThan(0);
      expect(new Set(element.wire_headers).size).toBe(element.wire_headers.length);
      for (const header of element.wire_headers) {
        expect(header).toMatch(/^[A-Z0-9_]+$/);
      }
      for (const required of element.required_headers) {
        expect(element.wire_headers).toContain(required);
      }
      for (const controlledHeader of Object.keys(element.catalog_values)) {
        expect(element.wire_headers).toContain(controlledHeader);
        expect(element.catalog_values[controlledHeader].length).toBeGreaterThan(0);
      }
    }
  });

  test('canonicalizes only declared exact object types and aliases', () => {
    expect(catalog.canonicalElementType(' TORRE ')).toBe('torre');
    expect(catalog.canonicalElementType('tower')).toBe('torre');
    expect(catalog.canonicalElementType('../torre')).toBeNull();
    expect(catalog.canonicalElementType('customer_cpe')).toBeNull();
    expect(catalog.getElementType('unknown')).toBeNull();
  });

  test('matches the reviewed historical workbook contract exactly', () => {
    const fields = [
      'slug', 'geometry', 'periodicity', 'official_filenames',
      'preparation_filename', 'generated_format', 'wire_headers',
      'required_headers', 'catalog_values', 'field_constraints',
      'validation_supported', 'preparation_supported',
    ];
    const actual = catalog.ELEMENT_TYPES.map(element => Object.fromEntries(
      fields.map(field => [field, element[field]]),
    ));
    expect(actual).toEqual(reviewedContract.objects);
    expect(reviewedContract.metadata).toMatchObject({
      catalog_version: catalog.CATALOG_VERSION,
      dictionary_workbook_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      annex_v_workbook_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      posture: 'historical_2024_amendment_bootstrap_reference',
    });

    expect(actual).toHaveLength(39);
    expect(actual.filter(item => item.geometry === 'Point')).toHaveLength(27);
    expect(actual.filter(item => item.geometry !== 'Point')).toHaveLength(12);
    expect(actual.filter(item => item.periodicity === 'annual')).toHaveLength(24);
    expect(actual.filter(item => item.periodicity === 'semiannual')).toHaveLength(11);
    expect(actual.filter(item => item.periodicity === 'voluntary')).toHaveLength(1);
    expect(actual.filter(item => item.periodicity === 'event_driven')).toHaveLength(3);
  });
});
