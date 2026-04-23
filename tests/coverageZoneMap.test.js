// =============================================================================
// FireISP 5.0 — Coverage Zone Map Editor Tests (M5.8)
// =============================================================================
// Tests for coverageZoneService.js — GeoJSON ↔ MySQL POLYGON conversion,
// CRUD operations, and validation of the GeoJSON Polygon format.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/services/auditLog', () => ({
  log: jest.fn().mockResolvedValue(undefined),
}));

const db = require('../src/config/database');
const auditLog = require('../src/services/auditLog');
const coverageZoneService = require('../src/services/coverageZoneService');

// ---------------------------------------------------------------------------
// Helper fixtures
// ---------------------------------------------------------------------------

const POLYGON_GEOJSON = {
  type: 'Polygon',
  coordinates: [[
    [-98.5, 19.5],
    [-98.0, 19.5],
    [-98.0, 20.0],
    [-98.5, 20.0],
    [-98.5, 19.5],
  ]],
};

const DB_ROW = {
  id: 1,
  organization_id: 10,
  service_area_id: 2,
  name: 'Zone Alpha',
  description: null,
  zone_type: 'fiber',
  max_download_mbps: 500,
  max_upload_mbps: 100,
  color: '#10B981',
  status: 'active',
  created_at: '2026-04-23T00:00:00.000Z',
  updated_at: '2026-04-23T00:00:00.000Z',
  boundary: JSON.stringify(POLYGON_GEOJSON),
};

// ---------------------------------------------------------------------------
// listZones()
// ---------------------------------------------------------------------------

describe('coverageZoneService.listZones()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lists zones for an org without service_area_id filter', async () => {
    db.query.mockResolvedValueOnce([[DB_ROW]]);

    const result = await coverageZoneService.listZones({ orgId: 10 });

    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/organization_id = \?/);
    expect(sql).not.toMatch(/service_area_id = \?/);
    expect(params).toEqual([10]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Zone Alpha');
    // boundary should be parsed from JSON string to object
    expect(result[0].boundary).toEqual(POLYGON_GEOJSON);
  });

  test('filters by service_area_id when provided', async () => {
    db.query.mockResolvedValueOnce([[DB_ROW]]);

    await coverageZoneService.listZones({ orgId: 10, serviceAreaId: 2 });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/service_area_id = \?/);
    expect(params).toEqual([10, 2]);
  });

  test('returns empty array when no zones found', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const result = await coverageZoneService.listZones({ orgId: 99 });
    expect(result).toEqual([]);
  });

  test('parses null boundary gracefully', async () => {
    db.query.mockResolvedValueOnce([[{ ...DB_ROW, boundary: null }]]);
    const result = await coverageZoneService.listZones({ orgId: 10 });
    expect(result[0].boundary).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getZone()
// ---------------------------------------------------------------------------

describe('coverageZoneService.getZone()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns a zone when found', async () => {
    db.query.mockResolvedValueOnce([[DB_ROW]]);
    const zone = await coverageZoneService.getZone(1, 10);
    expect(zone.id).toBe(1);
    expect(zone.boundary).toEqual(POLYGON_GEOJSON);
  });

  test('throws NOT_FOUND when zone does not exist', async () => {
    db.query.mockResolvedValueOnce([[]]);
    await expect(coverageZoneService.getZone(999, 10))
      .rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
  });

  test('throws NOT_FOUND when zone belongs to a different org', async () => {
    db.query.mockResolvedValueOnce([[]]);
    await expect(coverageZoneService.getZone(1, 99))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ---------------------------------------------------------------------------
// createZone()
// ---------------------------------------------------------------------------

describe('coverageZoneService.createZone()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('inserts zone and returns it with parsed GeoJSON boundary', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 1 }]) // INSERT
      .mockResolvedValueOnce([[DB_ROW]]);        // SELECT after insert

    const zone = await coverageZoneService.createZone(10, {
      name: 'Zone Alpha',
      zone_type: 'fiber',
      boundary: POLYGON_GEOJSON,
      status: 'active',
    }, 5);

    // Verify INSERT used ST_GeomFromGeoJSON
    const [insertSql, insertParams] = db.query.mock.calls[0];
    expect(insertSql).toMatch(/ST_GeomFromGeoJSON/);
    expect(insertParams).toContain(JSON.stringify(POLYGON_GEOJSON));
    expect(insertParams).toContain('Zone Alpha');

    expect(zone.name).toBe('Zone Alpha');
    expect(zone.boundary).toEqual(POLYGON_GEOJSON);
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'create',
      tableName: 'coverage_zones',
    }));
  });

  test('throws VALIDATION_ERROR when name is missing', async () => {
    await expect(coverageZoneService.createZone(10, {
      boundary: POLYGON_GEOJSON,
    }, 5)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('throws VALIDATION_ERROR when boundary type is not Polygon', async () => {
    await expect(coverageZoneService.createZone(10, {
      name: 'Bad',
      boundary: { type: 'LineString', coordinates: [] },
    }, 5)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('throws VALIDATION_ERROR when boundary ring has fewer than 4 positions', async () => {
    await expect(coverageZoneService.createZone(10, {
      name: 'Too few',
      boundary: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] },
    }, 5)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('throws VALIDATION_ERROR when boundary is null', async () => {
    await expect(coverageZoneService.createZone(10, {
      name: 'No boundary',
      boundary: null,
    }, 5)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

// ---------------------------------------------------------------------------
// updateZone()
// ---------------------------------------------------------------------------

describe('coverageZoneService.updateZone()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates scalar fields without changing boundary', async () => {
    db.query
      .mockResolvedValueOnce([[DB_ROW]])                          // getZone (existing)
      .mockResolvedValueOnce([{ affectedRows: 1 }])               // UPDATE
      .mockResolvedValueOnce([[{ ...DB_ROW, status: 'retired' }]]); // getZone after

    const zone = await coverageZoneService.updateZone(1, 10, { status: 'retired' }, 5);
    expect(zone.status).toBe('retired');

    const [updateSql] = db.query.mock.calls[1];
    expect(updateSql).not.toMatch(/ST_GeomFromGeoJSON/);
    expect(updateSql).toMatch(/status = \?/);
  });

  test('updates boundary with ST_GeomFromGeoJSON when provided', async () => {
    const newBoundary = {
      type: 'Polygon',
      coordinates: [[[-99, 20], [-98, 20], [-98, 21], [-99, 21], [-99, 20]]],
    };
    db.query
      .mockResolvedValueOnce([[DB_ROW]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ ...DB_ROW, boundary: JSON.stringify(newBoundary) }]]);

    await coverageZoneService.updateZone(1, 10, { boundary: newBoundary }, 5);

    const [updateSql, params] = db.query.mock.calls[1];
    expect(updateSql).toMatch(/ST_GeomFromGeoJSON/);
    expect(params).toContain(JSON.stringify(newBoundary));
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'update' }));
  });

  test('returns existing zone unchanged when no fields provided', async () => {
    db.query.mockResolvedValueOnce([[DB_ROW]]);
    const zone = await coverageZoneService.updateZone(1, 10, {}, 5);
    expect(zone.name).toBe(DB_ROW.name);
    expect(db.query).toHaveBeenCalledTimes(1); // only the initial getZone SELECT
  });

  test('throws NOT_FOUND when zone does not exist', async () => {
    db.query.mockResolvedValueOnce([[]]);
    await expect(coverageZoneService.updateZone(999, 10, { name: 'X' }, 5))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ---------------------------------------------------------------------------
// deleteZone()
// ---------------------------------------------------------------------------

describe('coverageZoneService.deleteZone()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('soft-deletes a zone and logs audit', async () => {
    db.query
      .mockResolvedValueOnce([[DB_ROW]])         // getZone check
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE deleted_at

    await coverageZoneService.deleteZone(1, 10, 5);

    const [deleteSql] = db.query.mock.calls[1];
    expect(deleteSql).toMatch(/deleted_at = NOW\(\)/);
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'soft_delete' }));
  });

  test('throws NOT_FOUND when zone does not exist', async () => {
    db.query.mockResolvedValueOnce([[]]);
    await expect(coverageZoneService.deleteZone(999, 10, 5))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// ---------------------------------------------------------------------------
// restoreZone()
// ---------------------------------------------------------------------------

describe('coverageZoneService.restoreZone()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('restores a soft-deleted zone', async () => {
    db.query
      .mockResolvedValueOnce([[DB_ROW]])            // SELECT deleted zone
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE deleted_at = NULL
      .mockResolvedValueOnce([[DB_ROW]]);            // getZone after restore

    const zone = await coverageZoneService.restoreZone(1, 10, 5);
    expect(zone.id).toBe(1);

    const [restoreSql] = db.query.mock.calls[1];
    expect(restoreSql).toMatch(/deleted_at = NULL/);
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'restore' }));
  });

  test('throws NOT_FOUND when no soft-deleted zone found', async () => {
    db.query.mockResolvedValueOnce([[]]);
    await expect(coverageZoneService.restoreZone(999, 10, 5))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
