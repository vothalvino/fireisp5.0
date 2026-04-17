// =============================================================================
// FireISP 5.0 — Alert Routes
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const alertSchemas = require('../middleware/schemas/alerts');
const alertService = require('../services/alertService');
const db = require('../config/database');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// GET /api/alerts/rules — List alert rules
router.get('/rules', requirePermission('devices.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const offset = (pageNum - 1) * limitNum;

    const [rows] = await db.query(
      'SELECT * FROM alert_rules WHERE organization_id = ? ORDER BY name LIMIT ? OFFSET ?',
      [req.orgId, limitNum, offset],
    );
    const [countResult] = await db.query(
      'SELECT COUNT(*) AS total FROM alert_rules WHERE organization_id = ?',
      [req.orgId],
    );
    const total = countResult[0].total;

    res.json({
      data: rows,
      meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) { next(err); }
});

// POST /api/alerts/rules — Create an alert rule
router.post('/rules', requirePermission('devices.create'), validate(alertSchemas.createRule), async (req, res, next) => {
  try {
    const [result] = await db.query(
      `INSERT INTO alert_rules (organization_id, name, description, metric, operator, threshold, device_id, duration_minutes, severity, auto_create_outage, notification_channels, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, req.body.name, req.body.description || null, req.body.metric,
        req.body.operator || '>', req.body.threshold, req.body.device_id || null,
        req.body.duration_minutes || 5, req.body.severity || 'major',
        req.body.auto_create_outage || false,
        req.body.notification_channels ? JSON.stringify(req.body.notification_channels) : null,
        req.body.is_enabled !== false],
    );
    const [rows] = await db.query('SELECT * FROM alert_rules WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

// PUT /api/alerts/rules/:id — Update an alert rule
router.put('/rules/:id', requirePermission('devices.update'), validate(alertSchemas.updateRule), async (req, res, next) => {
  try {
    const fields = [];
    const params = [];
    const allowed = ['name', 'description', 'metric', 'operator', 'threshold', 'device_id',
      'duration_minutes', 'severity', 'auto_create_outage', 'is_enabled'];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`\`${key}\` = ?`);
        params.push(key === 'notification_channels' ? JSON.stringify(req.body[key]) : req.body[key]);
      }
    }
    if (req.body.notification_channels !== undefined) {
      fields.push('notification_channels = ?');
      params.push(JSON.stringify(req.body.notification_channels));
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: { message: 'No fields to update' } });
    }

    params.push(req.params.id, req.orgId);
    await db.query(
      `UPDATE alert_rules SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?`,
      params,
    );
    const [rows] = await db.query('SELECT * FROM alert_rules WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/alerts/rules/:id — Delete an alert rule
router.delete('/rules/:id', requirePermission('devices.delete'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'DELETE FROM alert_rules WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: { message: 'Alert rule not found' } });
    }
    res.status(204).send();
  } catch (err) { next(err); }
});

// GET /api/alerts/events — Alert event history
router.get('/events', requirePermission('devices.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const result = await alertService.getAlertHistory(req.orgId, { page: pageNum, limit: limitNum });
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/alerts/events/:id/acknowledge — Acknowledge an alert
router.post('/events/:id/acknowledge', requirePermission('devices.update'), async (req, res, next) => {
  try {
    await alertService.acknowledgeAlert(req.params.id, req.user.id);
    res.json({ data: { acknowledged: true } });
  } catch (err) { next(err); }
});

// POST /api/alerts/evaluate — Manually trigger alert evaluation
router.post('/evaluate', requirePermission('devices.update'), async (req, res, next) => {
  try {
    const data = await alertService.evaluateAlerts(req.orgId);
    res.json({ data });
  } catch (err) { next(err); }
});

module.exports = router;
