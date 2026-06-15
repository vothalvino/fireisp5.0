// =============================================================================
// FireISP 5.0 — Technician Tracking Routes — §12.3
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/database');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// POST /technician-tracking/breadcrumb
router.post('/breadcrumb', requirePermission('technician_tracking.ingest'), async (req, res, next) => {
  try {
    const { latitude, longitude, accuracy_m, recorded_at } = req.body;
    if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) {
      return res.status(422).json({ error: 'latitude and longitude are required' });
    }
    await db.query(
      'INSERT INTO technician_gps_breadcrumbs (user_id, latitude, longitude, accuracy_m, recorded_at) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, latitude, longitude, accuracy_m || null, recorded_at || new Date()],
    );
    res.status(201).json({ data: { ok: true } });
  } catch (err) { next(err); }
});

// GET /technician-tracking/positions — MUST be before /:userId/history
router.get('/positions', requirePermission('technician_tracking.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT tgb.user_id, tgb.latitude, tgb.longitude, tgb.accuracy_m, tgb.recorded_at,
              u.first_name, u.last_name
       FROM technician_gps_breadcrumbs tgb
       JOIN users u ON u.id = tgb.user_id
       JOIN (
         SELECT user_id, MAX(recorded_at) AS max_recorded
         FROM technician_gps_breadcrumbs
         GROUP BY user_id
       ) latest ON latest.user_id = tgb.user_id AND latest.max_recorded = tgb.recorded_at
       WHERE u.organization_id = ?`,
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// POST /technician-tracking/route-optimize
router.post('/route-optimize', requirePermission('technician_tracking.view'), async (req, res, next) => {
  try {
    const { technician_id, start_lat, start_lng } = req.body;
    if (!technician_id) return res.status(422).json({ error: 'technician_id is required' });
    const [orders] = await db.query(
      `SELECT id, title, latitude, longitude, scheduled_at
       FROM work_orders
       WHERE assigned_to = ? AND organization_id = ?
         AND status IN ('pending','assigned','in_progress')
         AND latitude IS NOT NULL AND longitude IS NOT NULL
         AND deleted_at IS NULL`,
      [technician_id, req.orgId],
    );
    if (orders.length === 0) {
      return res.json({ data: { route: [], total_distance_km: 0 } });
    }
    const haversine = (lat1, lng1, lat2, lng2) => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    let currentLat = parseFloat(start_lat) || 0;
    let currentLng = parseFloat(start_lng) || 0;
    const remaining = [...orders];
    const route = [];
    let totalDist = 0;
    while (remaining.length > 0) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = haversine(currentLat, currentLng, remaining[i].latitude, remaining[i].longitude);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      const next = remaining.splice(bestIdx, 1)[0];
      totalDist += bestDist;
      currentLat = parseFloat(next.latitude);
      currentLng = parseFloat(next.longitude);
      route.push({ ...next, distance_from_prev_km: Math.round(bestDist * 100) / 100 });
    }
    res.json({ data: { route, total_distance_km: Math.round(totalDist * 100) / 100 } });
  } catch (err) { next(err); }
});

// GET /technician-tracking/:userId/history
router.get('/:userId/history', requirePermission('technician_tracking.view'), async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit) || 200));
    const [rows] = await db.query(
      `SELECT id, user_id, latitude, longitude, accuracy_m, recorded_at
       FROM technician_gps_breadcrumbs
       WHERE user_id = ?
       ORDER BY recorded_at DESC LIMIT ${limit}`,
      [req.params.userId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

module.exports = router;
