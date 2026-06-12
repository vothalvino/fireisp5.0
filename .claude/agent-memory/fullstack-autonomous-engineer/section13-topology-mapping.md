---
name: section13-topology-mapping
description: Section 13 Topology & Mapping — migrations 302-304 complete; 4 new tables, 12 perms, 19 endpoints, react-leaflet frontend; next migration: 305
metadata:
  type: project
---

## Status: COMPLETE — PR #255

Migrations 302-304 are on branch `13-of-isp-platform-feature.md`.

### Database

- **302**: 4 new tables — `map_geofences`, `map_infrastructure_points`, `fiber_route_segments`, `device_dependency_edges`. Stored procedure guards add `latitude DECIMAL(10,7)`, `longitude DECIMAL(10,7)`, `parent_device_id BIGINT UNSIGNED` to `devices`.
- **303**: 12 permissions — `topology.{view,layer_switch,impact_analysis,dependency_manage}`, `mapping.{view,customer_locations,coverage_edit,fiber_routes,infrastructure,infrastructure_manage}`, `geofences.{view,manage}`
- **304**: `geofence_evaluation` scheduled task, task_type=`other`, cron `*/10 * * * *`

### Backend files

- `src/services/topologyMapService.js` — 14 exported functions
- `src/services/geoFenceService.js` — haversine + ray-casting with WebSocket alerts via wsHub.broadcast()
- `src/middleware/schemas/topologyMap.js`
- `src/routes/topologyMap.js` — 19 endpoints at `/api/v1/topology`
- `src/app.js` — wired at `v1.use('/topology', topologyMapRoutes)`
- `src/services/taskRunner.js` — case `geofence_evaluation`
- `tests/topologyMap.test.js` — 11 tests

### Frontend

- `frontend/src/pages/TopologyMapPage.tsx` — 3-tab page using react-leaflet MapContainer
- Route: `<Route path="topology-map" element={<TopologyMapPage />} />`
- ~40 `topologyMap.*` i18n keys in en/es/pt-BR

### Next migration: 305

**Why:** All 4 spec items done: §13.1 network graph, §13.2 geographic map, §13.3 dependency mapping. README now shows 254 tables, 369 endpoints, migrations 001-304.

**How to apply:** Next section work starts at migration 305.

### Post-merge correction: the "pre-existing" i18n failures were NOT pre-existing

The ~20 frontend test failures observed during §13 (i18n.test.ts, Login, Layout, aiSettings) were caused by cp1252 mojibake that §13 work itself introduced into the locale files. They were repaired before merge (commit 4956cad); main is clean and CI green. See [[testing-conventions]].
