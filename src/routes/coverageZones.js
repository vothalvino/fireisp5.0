// =============================================================================
// FireISP 5.0 — Coverage Zone Routes
// =============================================================================
// The boundary column is a MySQL POLYGON (SRID 4326). This router uses
// coverageZoneService to transparently convert between GeoJSON (used by the
// API and map editor) and the MySQL spatial type.
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const coverageZoneService = require('../services/coverageZoneService');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// GET / — list all coverage zones for the org (optionally filter by service_area_id)
router.get('/', requirePermission('coverage_zones.view'), async (req, res, next) => {
  try {
    const { service_area_id } = req.query;
    const zones = await coverageZoneService.listZones({
      orgId: req.orgId,
      serviceAreaId: service_area_id ? Number(service_area_id) : undefined,
    });
    res.json({ data: zones });
  } catch (err) {
    next(err);
  }
});

// GET /:id — get a single coverage zone
router.get('/:id', requirePermission('coverage_zones.view'), async (req, res, next) => {
  try {
    const zone = await coverageZoneService.getZone(req.params.id, req.orgId);
    res.json({ data: zone });
  } catch (err) {
    next(err);
  }
});

// POST / — create a coverage zone (boundary as GeoJSON Polygon)
router.post('/', requirePermission('coverage_zones.create'), async (req, res, next) => {
  try {
    const zone = await coverageZoneService.createZone(req.orgId, req.body, req.user?.id);
    res.status(201).json({ data: zone });
  } catch (err) {
    next(err);
  }
});

// PUT /:id — update a coverage zone (boundary as GeoJSON Polygon if provided)
router.put('/:id', requirePermission('coverage_zones.update'), async (req, res, next) => {
  try {
    const zone = await coverageZoneService.updateZone(
      req.params.id, req.orgId, req.body, req.user?.id,
    );
    res.json({ data: zone });
  } catch (err) {
    next(err);
  }
});

// DELETE /:id — soft-delete
router.delete('/:id', requirePermission('coverage_zones.delete'), async (req, res, next) => {
  try {
    await coverageZoneService.deleteZone(req.params.id, req.orgId, req.user?.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /:id/restore — restore soft-deleted zone
router.post('/:id/restore', requirePermission('coverage_zones.update'), async (req, res, next) => {
  try {
    const zone = await coverageZoneService.restoreZone(req.params.id, req.orgId, req.user?.id);
    res.json({ data: zone });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
