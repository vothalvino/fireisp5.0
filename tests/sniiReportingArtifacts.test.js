'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

const catalog = require('../src/services/sniiCatalog');
const { _test } = require('../src/services/sniiReportingService');

function wireFor(contract, value = 'X') {
  return Object.fromEntries(contract.wire_headers.map(header => [header, value]));
}

describe('SNII deterministic artifact encoding', () => {
  test('preserves a negative Mexican longitude and terminates CSV with CRLF', () => {
    const contract = catalog.getElementType('antena_microondas');
    const wire = wireFor(contract);
    wire.LATITUD = 28.632996;
    wire.LONGITUD = -106.069100;
    const csv = _test.toCsv([wire], contract.wire_headers);

    expect(csv).toContain('28.632996,-106.0691');
    expect(csv).not.toContain("'-106.0691");
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  test('keeps official KML JSON key order, string blanks and normalized geo precision', () => {
    const contract = catalog.getElementType('ducto');
    const wire = wireFor(contract);
    wire.AREA_DISPONIBLE = null;
    const kml = _test.toKml([{
      snapshot_payload: {
        wire,
        geometry: {
          type: 'LineString',
          coordinates: [[-106.0691, 28.632996], [-106.10001, 28.70002]],
        },
      },
    }], contract);
    const description = kml.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)[1];
    const parsed = JSON.parse(description);

    expect(Object.keys(parsed)).toEqual(contract.wire_headers);
    expect(parsed.AREA_DISPONIBLE).toBe('');
    expect(Object.values(parsed).every(value => typeof value === 'string')).toBe(true);
    expect(kml).toContain('-106.06910,28.63300,0');
    expect(kml).toContain(`<Document><name>${contract.preparation_filename}</name>`);
  });

  test('accepts a finite closed single-ring Polygon and rejects an open ring', () => {
    const contract = catalog.getElementType('sector_lte');
    const payload = {
      wire: wireFor(contract),
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-106.1, 28.6], [-106.0, 28.6], [-106.0, 28.7], [-106.1, 28.6],
        ]],
      },
    };
    expect(_test.validateWireRecord(contract, payload)
      .filter(error => error.field === '_geometry')).toEqual([]);

    payload.geometry.coordinates[0][3] = [-106.1, 28.61];
    expect(_test.validateWireRecord(contract, payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_polygon_outer_ring' }),
    ]));
  });

  test('enforces reviewed dictionary types, lengths and controlled values', () => {
    const contract = catalog.getElementType('antena_lte');
    const wire = wireFor(contract);
    wire.LATITUD = 91;
    wire.LONGITUD = -106.1;
    wire.CODIGO_IDENTIFICADOR = 'x'.repeat(51);
    wire.TIPO_ANTENA = 'invented-value';
    const errors = _test.validateWireRecord(contract, {
      wire,
      geometry: { type: 'Point', coordinates: [-106.1, 91] },
    });
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'LATITUD', code: 'latitude_range' }),
      expect.objectContaining({ field: 'CODIGO_IDENTIFICADOR', code: 'max_length' }),
      expect.objectContaining({ field: 'TIPO_ANTENA', code: 'catalog_value' }),
      expect.objectContaining({ field: '_geometry', code: 'invalid_point' }),
    ]));
  });

  test.each([null, '', '   ', false])(
    'rejects an invalid effective Point coordinate override (%p)',
    (invalidCoordinate) => {
      const contract = catalog.getElementType('torre');
      const payload = _test.buildReviewedPayload({
        source_type: 'site', latitude: 28.63299, longitude: -106.06910,
      }, {
        element_type: contract.slug,
        official_code: 'TOWER-1',
        ownership: 'owned',
        owner_name: 'Operator',
        field_overrides: { LATITUD: invalidCoordinate },
      });

      expect(payload.geometry).toBeNull();
      expect(_test.validateWireRecord(contract, payload)).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: '_geometry', code: 'required_Point' }),
      ]));
    },
  );

  test('uses validated effective Point overrides for both geometry and CSV wire output', () => {
    const contract = catalog.getElementType('torre');
    const payload = _test.buildReviewedPayload({
      source_type: 'site', latitude: 28.63299, longitude: -106.06910,
    }, {
      element_type: contract.slug,
      official_code: 'TOWER-1',
      ownership: 'owned',
      owner_name: 'Operator',
      field_overrides: { LATITUD: '29.12345', LONGITUD: '-105.54321' },
    });

    expect(payload.wire).toMatchObject({ LATITUD: 29.12345, LONGITUD: -105.54321 });
    expect(payload.geometry).toEqual({ type: 'Point', coordinates: [-105.54321, 29.12345] });
    expect(_test.validateWireRecord(contract, payload)
      .filter(error => ['LATITUD', 'LONGITUD', '_geometry'].includes(error.field))).toEqual([]);
    expect(_test.toCsv([payload.wire], contract.wire_headers)).toContain('29.12345,-105.54321');
  });

  test('rejects a Point payload whose wire coordinates diverge from geometry', () => {
    const contract = catalog.getElementType('torre');
    const wire = wireFor(contract);
    wire.LATITUD = 29.12345;
    wire.LONGITUD = -105.54321;
    expect(_test.validateWireRecord(contract, {
      wire,
      geometry: { type: 'Point', coordinates: [-106.06910, 28.63299] },
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: '_geometry', code: 'point_wire_geometry_mismatch' }),
    ]));
  });

  test.each([null, '', '   '])(
    'rejects a network-link endpoint whose coordinate is missing (%p)',
    (missingCoordinate) => {
      const contract = catalog.getElementType('enlace_microondas');
      const payload = _test.buildReviewedPayload({
        source_type: 'network_link',
        longitude_a: missingCoordinate,
        latitude_a: 28.63299,
        longitude_b: -106.01,
        latitude_b: 28.7,
      }, {
        element_type: contract.slug,
        official_code: 'LINK-1',
        ownership: 'owned',
        owner_name: 'Operator',
        field_overrides: {},
      });

      expect(payload.geometry).toBeNull();
      expect(_test.validateWireRecord(contract, payload)).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: '_geometry', code: 'required_LineString' }),
      ]));
    },
  );

  test.each([
    ['manual Point', 'torre', {
      source_type: 'manual', LATITUD: 28.63, LONGITUD: null,
    }, 'required_Point'],
    ['manual LineString', 'cable_fibra_acceso', {
      source_type: 'manual',
      _geometry: { type: 'LineString', coordinates: [[-106.1, 28.6], [-106, null]] },
    }, 'invalid_linestring'],
    ['fiber LineString blank', 'cable_fibra_acceso', {
      source_type: 'fiber_route',
      gis_path: { type: 'LineString', coordinates: [[-106.1, 28.6], [-106, '']] },
    }, 'invalid_linestring'],
    ['manual Polygon', 'sector_lte', {
      source_type: 'manual',
      _geometry: {
        type: 'Polygon',
        coordinates: [[[-106.1, 28.6], [-106, 28.6], ['', 28.7], [-106.1, 28.6]]],
      },
    }, 'invalid_polygon_outer_ring'],
  ])('rejects missing %s vertices instead of coercing them to zero',
    (_label, elementType, source, code) => {
      const contract = catalog.getElementType(elementType);
      const payload = _test.buildReviewedPayload({
        ...wireFor(contract),
        ...source,
      }, {
        element_type: contract.slug,
        official_code: 'ASSET-1',
        ownership: 'owned',
        owner_name: 'Operator',
        field_overrides: {},
      });
      const errors = _test.validateWireRecord(contract, payload);
      expect(errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: '_geometry', code }),
      ]));
    });

  test('detects duplicate official identifiers within one object type only', () => {
    const item = (id, elementType, code) => ({
      id,
      element_type: elementType,
      snapshot_payload: { wire: { CODIGO_IDENTIFICADOR: code } },
    });
    expect(_test.duplicateOfficialCodeErrors([
      item(1, 'torre', 'T-1'), item(2, 'torre', 'T-1'), item(3, 'poste', 'T-1'),
    ])).toEqual([
      expect.objectContaining({ code: 'duplicate_official_code', item_ids: [1, 2] }),
    ]);
  });

  test('rejects spreadsheet-formula text without corrupting numeric-looking coordinates', () => {
    const contract = catalog.getElementType('sitio_privado');
    const wire = wireFor(contract);
    wire.PROPIETARIO = '-CMD|calc';
    wire.LATITUD = '28.63299';
    wire.LONGITUD = '-106.06910';
    const errors = _test.validateWireRecord(contract, {
      wire,
      geometry: { type: 'Point', coordinates: [-106.06910, 28.63299] },
    });

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'PROPIETARIO', code: 'unsafe_spreadsheet_text' }),
    ]));
    expect(errors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'LONGITUD', code: 'unsafe_spreadsheet_text' }),
    ]));
  });

  test('unicode-escapes active markup in KML descriptions while preserving JSON semantics', () => {
    const contract = catalog.getElementType('ducto');
    const wire = wireFor(contract);
    wire.PROPIETARIO = '<script>alert(1)</script>&';
    const kml = _test.toKml([{
      snapshot_payload: {
        wire,
        geometry: { type: 'LineString', coordinates: [[-106.1, 28.6], [-106.0, 28.7]] },
      },
    }], contract);
    const description = kml.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)[1];

    expect(kml).not.toContain('<script>');
    expect(description).toContain('\\u003cscript\\u003e');
    expect(JSON.parse(description).PROPIETARIO).toBe('<script>alert(1)</script>&');
  });

  test('selects the voluntary private-site object only for the anytime workflow', () => {
    const privateSite = catalog.getElementType('sitio_privado');
    const tower = catalog.getElementType('torre');
    const voluntary = { filing_kind: 'voluntary', filing_window: 'anytime' };

    expect(_test.dueForWindow(privateSite, voluntary)).toBe(true);
    expect(_test.dueForWindow(tower, voluntary)).toBe(false);
  });
});
