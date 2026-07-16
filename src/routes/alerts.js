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
const { encrypt } = require('../utils/encryption');
const escalationSchemas = require('../middleware/schemas/alertEscalations');
const maintenanceSchemas = require('../middleware/schemas/maintenanceWindows');
const channelSchemas = require('../middleware/schemas/alertNotificationChannels');
const suppressionSchemas = require('../middleware/schemas/alertSuppressionRules');

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
      `SELECT * FROM alert_rules WHERE organization_id = ? AND deleted_at IS NULL ORDER BY name LIMIT ${limitNum} OFFSET ${offset}`,
      [req.orgId],
    );
    const [countResult] = await db.query(
      'SELECT COUNT(*) AS total FROM alert_rules WHERE organization_id = ? AND deleted_at IS NULL',
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
      `INSERT INTO alert_rules (organization_id, name, description, metric, operator, threshold, device_id, duration_minutes, severity, auto_create_outage, auto_create_ticket, notification_channels, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, req.body.name, req.body.description || null, req.body.metric,
        req.body.operator || '>', req.body.threshold, req.body.device_id || null,
        req.body.duration_minutes || 5, req.body.severity || 'major',
        req.body.auto_create_outage || false,
        req.body.auto_create_ticket || false,
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
      'duration_minutes', 'severity', 'auto_create_outage', 'auto_create_ticket', 'is_enabled'];

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
      `UPDATE alert_rules SET ${fields.join(', ')} WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`,
      params,
    );
    const [rows] = await db.query('SELECT * FROM alert_rules WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/alerts/rules/:id — Delete an alert rule
router.delete('/rules/:id', requirePermission('devices.delete'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'UPDATE alert_rules SET deleted_at = NOW() WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
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

// ---- Escalation Chains ----

router.get('/escalation-chains', requirePermission('alert_escalations.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const offset = (pageNum - 1) * limitNum;
    const [rows] = await db.query(
      `SELECT * FROM alert_escalation_chains WHERE organization_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`,
      [req.orgId],
    );
    const [countResult] = await db.query(
      'SELECT COUNT(*) AS total FROM alert_escalation_chains WHERE organization_id = ? AND deleted_at IS NULL',
      [req.orgId],
    );
    const total = countResult[0].total;
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (err) { next(err); }
});

router.post('/escalation-chains', requirePermission('alert_escalations.create'), validate(escalationSchemas.createChain), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'INSERT INTO alert_escalation_chains (organization_id, name, description) VALUES (?, ?, ?)',
      [req.orgId, req.body.name, req.body.description || null],
    );
    const [rows] = await db.query('SELECT * FROM alert_escalation_chains WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.put('/escalation-chains/:id', requirePermission('alert_escalations.update'), validate(escalationSchemas.updateChain), async (req, res, next) => {
  try {
    const fields = [];
    const params = [];
    if (req.body.name !== undefined) { fields.push('name = ?'); params.push(req.body.name); }
    if (req.body.description !== undefined) { fields.push('description = ?'); params.push(req.body.description); }
    if (fields.length === 0) return res.status(400).json({ error: { message: 'No fields to update' } });
    params.push(req.params.id, req.orgId);
    await db.query(`UPDATE alert_escalation_chains SET ${fields.join(', ')} WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`, params);
    const [rows] = await db.query('SELECT * FROM alert_escalation_chains WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/escalation-chains/:id', requirePermission('alert_escalations.delete'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'UPDATE alert_escalation_chains SET deleted_at = NOW() WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: { message: 'Escalation chain not found' } });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.get('/escalation-chains/:id/steps', requirePermission('alert_escalations.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT aes.* FROM alert_escalation_steps aes JOIN alert_escalation_chains aec ON aec.id = aes.chain_id WHERE aes.chain_id = ? AND aec.organization_id = ? AND aec.deleted_at IS NULL ORDER BY aes.step_number',
      [req.params.id, req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/escalation-chains/:id/steps', requirePermission('alert_escalations.create'), validate(escalationSchemas.createStep), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'INSERT INTO alert_escalation_steps (chain_id, step_number, delay_minutes, notification_channel, recipient_email, recipient_phone, webhook_url, message_template) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [req.params.id, req.body.step_number, req.body.delay_minutes || 15, req.body.notification_channel,
        req.body.recipient_email || null, req.body.recipient_phone || null, req.body.webhook_url || null, req.body.message_template || null],
    );
    const [rows] = await db.query('SELECT * FROM alert_escalation_steps WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/escalation-chains/:id/steps/:stepId', requirePermission('alert_escalations.delete'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'DELETE aes FROM alert_escalation_steps aes JOIN alert_escalation_chains aec ON aec.id = aes.chain_id WHERE aes.id = ? AND aes.chain_id = ? AND aec.organization_id = ?',
      [req.params.stepId, req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: { message: 'Step not found' } });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---- Maintenance Windows ----

router.get('/maintenance-windows/active', requirePermission('maintenance_windows.view'), async (req, res, next) => {
  try {
    // Time-bound regardless of status (migration 400) — see the identical
    // predicate + rationale in alertService.activeMaintenanceWindowId.
    const [rows] = await db.query(
      `SELECT * FROM maintenance_windows WHERE organization_id = ? AND deleted_at IS NULL
       AND status IN ('active', 'scheduled') AND starts_at <= NOW() AND ends_at >= NOW()
       ORDER BY starts_at`,
      [req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.get('/maintenance-windows', requirePermission('maintenance_windows.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const offset = (pageNum - 1) * limitNum;
    const [rows] = await db.query(
      `SELECT * FROM maintenance_windows WHERE organization_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`,
      [req.orgId],
    );
    const [countResult] = await db.query(
      'SELECT COUNT(*) AS total FROM maintenance_windows WHERE organization_id = ? AND deleted_at IS NULL',
      [req.orgId],
    );
    const total = countResult[0].total;
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (err) { next(err); }
});

router.post('/maintenance-windows', requirePermission('maintenance_windows.create'), validate(maintenanceSchemas.createWindow), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'INSERT INTO maintenance_windows (organization_id, name, description, device_id, site_id, starts_at, ends_at, is_recurring, recurrence_cron, recurrence_duration_minutes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.orgId, req.body.name, req.body.description || null, req.body.device_id || null, req.body.site_id || null,
        req.body.starts_at, req.body.ends_at, req.body.is_recurring || false,
        req.body.recurrence_cron || null, req.body.recurrence_duration_minutes || null,
        req.user ? req.user.id : null],
    );
    const [rows] = await db.query('SELECT * FROM maintenance_windows WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.put('/maintenance-windows/:id', requirePermission('maintenance_windows.update'), validate(maintenanceSchemas.updateWindow), async (req, res, next) => {
  try {
    const allowed = ['name', 'description', 'device_id', 'site_id', 'starts_at', 'ends_at', 'is_recurring', 'recurrence_cron', 'recurrence_duration_minutes', 'status'];
    const fields = [];
    const params = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) { fields.push(`\`${key}\` = ?`); params.push(req.body[key]); }
    }
    if (fields.length === 0) return res.status(400).json({ error: { message: 'No fields to update' } });
    params.push(req.params.id, req.orgId);
    await db.query(`UPDATE maintenance_windows SET ${fields.join(', ')} WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`, params);
    const [rows] = await db.query('SELECT * FROM maintenance_windows WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/maintenance-windows/:id', requirePermission('maintenance_windows.delete'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'UPDATE maintenance_windows SET deleted_at = NOW() WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: { message: 'Maintenance window not found' } });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---- Notification Channels ----

router.get('/notification-channels', requirePermission('alert_channels.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const offset = (pageNum - 1) * limitNum;
    const [rows] = await db.query(
      `SELECT id, organization_id, name, channel_type, is_enabled, deleted_at, created_at, updated_at FROM alert_notification_channels WHERE organization_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`,
      [req.orgId],
    );
    const [countResult] = await db.query(
      'SELECT COUNT(*) AS total FROM alert_notification_channels WHERE organization_id = ? AND deleted_at IS NULL',
      [req.orgId],
    );
    const total = countResult[0].total;
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (err) { next(err); }
});

router.post('/notification-channels', requirePermission('alert_channels.create'), validate(channelSchemas.createChannel), async (req, res, next) => {
  try {
    const configStr = req.body.config ? encrypt(JSON.stringify(req.body.config)) : null;
    const [result] = await db.query(
      'INSERT INTO alert_notification_channels (organization_id, name, channel_type, config_encrypted, is_enabled) VALUES (?, ?, ?, ?, ?)',
      [req.orgId, req.body.name, req.body.channel_type, configStr, req.body.is_enabled !== false],
    );
    const [rows] = await db.query(
      'SELECT id, organization_id, name, channel_type, is_enabled, deleted_at, created_at, updated_at FROM alert_notification_channels WHERE id = ?',
      [result.insertId],
    );
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.put('/notification-channels/:id', requirePermission('alert_channels.update'), validate(channelSchemas.updateChannel), async (req, res, next) => {
  try {
    const fields = [];
    const params = [];
    if (req.body.name !== undefined) { fields.push('name = ?'); params.push(req.body.name); }
    if (req.body.channel_type !== undefined) { fields.push('channel_type = ?'); params.push(req.body.channel_type); }
    if (req.body.is_enabled !== undefined) { fields.push('is_enabled = ?'); params.push(req.body.is_enabled); }
    if (req.body.config !== undefined) { fields.push('config_encrypted = ?'); params.push(encrypt(JSON.stringify(req.body.config))); }
    if (fields.length === 0) return res.status(400).json({ error: { message: 'No fields to update' } });
    params.push(req.params.id, req.orgId);
    await db.query(`UPDATE alert_notification_channels SET ${fields.join(', ')} WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`, params);
    const [rows] = await db.query(
      'SELECT id, organization_id, name, channel_type, is_enabled, deleted_at, created_at, updated_at FROM alert_notification_channels WHERE id = ? AND deleted_at IS NULL',
      [req.params.id],
    );
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/notification-channels/:id', requirePermission('alert_channels.delete'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'UPDATE alert_notification_channels SET deleted_at = NOW() WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: { message: 'Notification channel not found' } });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---- Suppression Rules ----

router.get('/suppression-rules', requirePermission('alert_suppression.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const offset = (pageNum - 1) * limitNum;
    const [rows] = await db.query(
      `SELECT * FROM alert_suppression_rules WHERE organization_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`,
      [req.orgId],
    );
    const [countResult] = await db.query(
      'SELECT COUNT(*) AS total FROM alert_suppression_rules WHERE organization_id = ? AND deleted_at IS NULL',
      [req.orgId],
    );
    const total = countResult[0].total;
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (err) { next(err); }
});

router.post('/suppression-rules', requirePermission('alert_suppression.create'), validate(suppressionSchemas.createRule), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'INSERT INTO alert_suppression_rules (organization_id, name, upstream_device_id, downstream_device_id, suppress_duration_minutes, is_enabled) VALUES (?, ?, ?, ?, ?, ?)',
      [req.orgId, req.body.name, req.body.upstream_device_id || null, req.body.downstream_device_id || null,
        req.body.suppress_duration_minutes || 60, req.body.is_enabled !== false],
    );
    const [rows] = await db.query('SELECT * FROM alert_suppression_rules WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.put('/suppression-rules/:id', requirePermission('alert_suppression.update'), validate(suppressionSchemas.updateRule), async (req, res, next) => {
  try {
    const allowed = ['name', 'upstream_device_id', 'downstream_device_id', 'suppress_duration_minutes', 'is_enabled'];
    const fields = [];
    const params = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) { fields.push(`\`${key}\` = ?`); params.push(req.body[key]); }
    }
    if (fields.length === 0) return res.status(400).json({ error: { message: 'No fields to update' } });
    params.push(req.params.id, req.orgId);
    await db.query(`UPDATE alert_suppression_rules SET ${fields.join(', ')} WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`, params);
    const [rows] = await db.query('SELECT * FROM alert_suppression_rules WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/suppression-rules/:id', requirePermission('alert_suppression.delete'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'UPDATE alert_suppression_rules SET deleted_at = NOW() WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: { message: 'Suppression rule not found' } });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---- Evaluate V2 ----

router.post('/evaluate-v2', requirePermission('devices.update'), async (req, res, next) => {
  try {
    const data = await alertService.evaluateAlertsV2(req.orgId);
    res.json({ data });
  } catch (err) { next(err); }
});

module.exports = router;
