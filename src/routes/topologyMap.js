// =============================================================================
// FireISP 5.0 — Topology Map Routes — §13
// =============================================================================
// Mounted at /topology (and /v1/topology) in app.js.
//
// §13.1  Map data layers:  GET /map/network, /map/customers, /map/coverage,
//                          /map/fiber-routes, /map/infrastructure,
//                          /map/impact/:deviceId, /map/cascade/:deviceId,
//                          /map/dual-homed
// §13.2  Geofences:        GET/POST /geofences, GET/PUT/DELETE /geofences/:id
//         Infrastructure:  GET/POST /infrastructure, GET/PUT/DELETE /infrastructure/:id
// §13.3  Dependencies:     POST /dependencies, DELETE /dependencies/:id,
//                          GET /dependencies/:deviceId
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createGeofence,
  updateGeofence,
  createInfrastructure,
  updateInfrastructure,
  createDependencyEdge,
} = require('../middleware/schemas/topologyMap');
const svc = require('../services/topologyMapService');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// §13.1 — Network Topology Map data
// ---------------------------------------------------------------------------

// GET /topology/map/network?layer=l2|l3|physical
router.get('/map/network', requirePermission('topology.view'), async (req, res, next) => {
  try {
    const layer = req.query.layer || null;
    const data = await svc.getNetworkGraph(req.orgId, layer);
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /topology/map/customers
router.get('/map/customers', requirePermission('mapping.customer_locations'), async (req, res, next) => {
  try {
    const data = await svc.getCustomerLocations(req.orgId);
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /topology/map/coverage
router.get('/map/coverage', requirePermission('mapping.view'), async (req, res, next) => {
  try {
    const data = await svc.getCoverageData(req.orgId);
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /topology/map/fiber-routes
router.get('/map/fiber-routes', requirePermission('mapping.fiber_routes'), async (req, res, next) => {
  try {
    const data = await svc.getFiberRoutes(req.orgId);
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /topology/map/infrastructure
router.get('/map/infrastructure', requirePermission('mapping.infrastructure'), async (req, res, next) => {
  try {
    const data = await svc.getInfrastructurePins(req.orgId);
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /topology/map/dual-homed
router.get('/map/dual-homed', requirePermission('topology.view'), async (req, res, next) => {
  try {
    const data = await svc.getDualHomedDevices(req.orgId);
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /topology/map/impact/:deviceId
router.get('/map/impact/:deviceId', requirePermission('topology.impact_analysis'), async (req, res, next) => {
  try {
    const data = await svc.getImpactAnalysis(req.orgId, parseInt(req.params.deviceId, 10));
    if (!data.device) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Device not found' } });
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /topology/map/cascade/:deviceId
router.get('/map/cascade/:deviceId', requirePermission('topology.view'), async (req, res, next) => {
  try {
    const data = await svc.getCascadeChain(req.orgId, parseInt(req.params.deviceId, 10));
    if (!data.device) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Device not found' } });
    res.json({ data });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// §13.2 — Geofences
// ---------------------------------------------------------------------------

// GET /topology/geofences
router.get('/geofences', requirePermission('geofences.view'), async (req, res, next) => {
  try {
    const data = await svc.listGeofences(req.orgId);
    res.json({ data });
  } catch (err) { next(err); }
});

// POST /topology/geofences
router.post('/geofences', requirePermission('geofences.manage'), validate(createGeofence), async (req, res, next) => {
  try {
    const row = await svc.createGeofence(req.orgId, req.body, req.user?.id);
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// GET /topology/geofences/:id  — MUST be after /geofences (static)
router.get('/geofences/:id', requirePermission('geofences.view'), async (req, res, next) => {
  try {
    const row = await svc.getGeofence(req.orgId, parseInt(req.params.id, 10));
    if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Geofence not found' } });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// PUT /topology/geofences/:id
router.put('/geofences/:id', requirePermission('geofences.manage'), validate(updateGeofence), async (req, res, next) => {
  try {
    const row = await svc.updateGeofence(req.orgId, parseInt(req.params.id, 10), req.body);
    if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Geofence not found' } });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// DELETE /topology/geofences/:id
router.delete('/geofences/:id', requirePermission('geofences.manage'), async (req, res, next) => {
  try {
    const deleted = await svc.deleteGeofence(req.orgId, parseInt(req.params.id, 10));
    if (!deleted) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Geofence not found' } });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// §13.2 — Infrastructure points
// ---------------------------------------------------------------------------

// GET /topology/infrastructure
router.get('/infrastructure', requirePermission('mapping.infrastructure'), async (req, res, next) => {
  try {
    const data = await svc.listInfrastructure(req.orgId);
    res.json({ data });
  } catch (err) { next(err); }
});

// POST /topology/infrastructure
router.post('/infrastructure', requirePermission('mapping.infrastructure_manage'), validate(createInfrastructure), async (req, res, next) => {
  try {
    const row = await svc.createInfrastructurePoint(req.orgId, req.body);
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// GET /topology/infrastructure/:id  — MUST be after /infrastructure (static)
router.get('/infrastructure/:id', requirePermission('mapping.infrastructure'), async (req, res, next) => {
  try {
    const row = await svc.getInfrastructurePoint(req.orgId, parseInt(req.params.id, 10));
    if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Infrastructure point not found' } });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// PUT /topology/infrastructure/:id
router.put('/infrastructure/:id', requirePermission('mapping.infrastructure_manage'), validate(updateInfrastructure), async (req, res, next) => {
  try {
    const row = await svc.updateInfrastructurePoint(req.orgId, parseInt(req.params.id, 10), req.body);
    if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Infrastructure point not found' } });
    res.json({ data: row });
  } catch (err) { next(err); }
});

// DELETE /topology/infrastructure/:id
router.delete('/infrastructure/:id', requirePermission('mapping.infrastructure_manage'), async (req, res, next) => {
  try {
    const deleted = await svc.deleteInfrastructurePoint(req.orgId, parseInt(req.params.id, 10));
    if (!deleted) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Infrastructure point not found' } });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// §13.3 — Device dependency edges
// ---------------------------------------------------------------------------

// GET /topology/dependencies/:deviceId  — MUST be before POST /dependencies
router.get('/dependencies/:deviceId', requirePermission('topology.view'), async (req, res, next) => {
  try {
    const data = await svc.getDependencyEdges(req.orgId, parseInt(req.params.deviceId, 10));
    res.json({ data });
  } catch (err) { next(err); }
});

// POST /topology/dependencies
router.post('/dependencies', requirePermission('topology.dependency_manage'), validate(createDependencyEdge), async (req, res, next) => {
  try {
    const row = await svc.createDependencyEdge(req.orgId, req.body);
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// DELETE /topology/dependencies/:id
router.delete('/dependencies/:id', requirePermission('topology.dependency_manage'), async (req, res, next) => {
  try {
    const deleted = await svc.deleteDependencyEdge(req.orgId, parseInt(req.params.id, 10));
    if (!deleted) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dependency edge not found' } });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
