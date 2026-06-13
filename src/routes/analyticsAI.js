// =============================================================================
// FireISP 5.0 — Analytics AI Routes (§18.4)
// =============================================================================
// Heuristic/statistical analytics — NOT real ML model training.
// Anomaly detection: z-score; churn: rule-based; forecasting: §15 linear regression.
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const db = require('../config/database');
const analyticsService = require('../services/analyticsService');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// GET /analytics/anomalies — list detected anomalies
router.get('/anomalies', requirePermission('analytics_anomalies.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50, severity, metric, device_id, is_acknowledged } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const offset = (pageNum - 1) * limitNum;

    const conditions = ['organization_id = ?'];
    const params = [req.orgId];
    if (severity)         { conditions.push('severity = ?');         params.push(severity); }
    if (metric)           { conditions.push('metric = ?');           params.push(metric); }
    if (device_id)        { conditions.push('device_id = ?');        params.push(device_id); }
    if (is_acknowledged !== undefined) {
      conditions.push('is_acknowledged = ?');
      params.push(is_acknowledged === 'true' ? 1 : 0);
    }

    const where = conditions.join(' AND ');
    const [rows] = await db.query(
      `SELECT * FROM analytics_anomalies WHERE ${where} ORDER BY detected_at DESC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset],
    );
    const [countResult] = await db.query(`SELECT COUNT(*) AS total FROM analytics_anomalies WHERE ${where}`, params);
    res.json({ data: rows, meta: { total: countResult[0].total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

// POST /analytics/anomalies/detect — run anomaly detection now
router.post('/anomalies/detect', requirePermission('analytics_anomalies.view'), async (req, res, next) => {
  try {
    const { window } = req.query;
    const result = await analyticsService.detectAnomalies(req.orgId, { window: window ? parseInt(window, 10) : 48 });
    res.json({ data: result });
  } catch (err) { next(err); }
});

// POST /analytics/anomalies/:id/acknowledge
router.post('/anomalies/:id/acknowledge', requirePermission('analytics_anomalies.acknowledge'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT id FROM analytics_anomalies WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Anomaly not found' } });
    await db.query(
      'UPDATE analytics_anomalies SET is_acknowledged = 1, acknowledged_by = ?, acknowledged_at = NOW() WHERE id = ?',
      [req.user.id, req.params.id],
    );
    const [updated] = await db.query('SELECT * FROM analytics_anomalies WHERE id = ?', [req.params.id]);
    res.json({ data: updated[0] });
  } catch (err) { next(err); }
});

// GET /analytics/predictive-failure — SFP degradation + ONU offline analysis
router.get('/predictive-failure', requirePermission('analytics_anomalies.view'), async (req, res, next) => {
  try {
    const result = await analyticsService.predictiveFailure(req.orgId);
    res.json({ data: result });
  } catch (err) { next(err); }
});

// GET /analytics/alert-correlation — correlated alert groups (reuses §6)
router.get('/alert-correlation', requirePermission('analytics_anomalies.view'), async (req, res, next) => {
  try {
    const { window_minutes } = req.query;
    const result = await analyticsService.alertCorrelation(req.orgId, {
      window_minutes: window_minutes ? parseInt(window_minutes, 10) : 30,
    });
    res.json({ data: result });
  } catch (err) { next(err); }
});

// GET /analytics/bandwidth-forecast — reuses §15 capacity forecast
router.get('/bandwidth-forecast', requirePermission('analytics_anomalies.view'), async (req, res, next) => {
  try {
    const { months } = req.query;
    const result = await analyticsService.bandwidthForecast(req.orgId, {
      months: months ? parseInt(months, 10) : 6,
    });
    res.json({ data: result });
  } catch (err) { next(err); }
});

// GET /analytics/churn-scores — list current churn risk scores
router.get('/churn-scores', requirePermission('churn_scores.view'), async (req, res, next) => {
  try {
    const { risk_band, page, limit } = req.query;
    const result = await analyticsService.getChurnScores(req.orgId, { risk_band, page, limit });
    res.json(result);
  } catch (err) { next(err); }
});

// POST /analytics/churn-scores/compute — run churn score computation
router.post('/churn-scores/compute', requirePermission('churn_scores.compute'), async (req, res, next) => {
  try {
    const result = await analyticsService.computeChurnScores(req.orgId);
    res.json({ data: result });
  } catch (err) { next(err); }
});

module.exports = router;
