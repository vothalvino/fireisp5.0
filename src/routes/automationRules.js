// =============================================================================
// FireISP 5.0 — Automation Rules Routes (§18.1)
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const db = require('../config/database');
const automationService = require('../services/automationService');

const createAutomationRule = {
  name:               { type: 'string', required: true, min: 1, max: 255 },
  description:        { type: 'string' },
  trigger_event:      { type: 'string', required: true, min: 1, max: 100 },
  trigger_conditions: { type: 'object' },
  action_type:        { type: 'string', required: true, min: 1, max: 100 },
  action_config:      { type: 'object' },
  is_enabled:         { type: 'boolean' },
  priority:           { type: 'number', min: 0, max: 100 },
};

const updateAutomationRule = {
  name:               { type: 'string', min: 1, max: 255 },
  description:        { type: 'string' },
  trigger_event:      { type: 'string', min: 1, max: 100 },
  trigger_conditions: { type: 'object' },
  action_type:        { type: 'string', min: 1, max: 100 },
  action_config:      { type: 'object' },
  is_enabled:         { type: 'boolean' },
  priority:           { type: 'number', min: 0, max: 100 },
};

const router = Router();
router.use(authenticate);
router.use(orgScope);

// GET /automation-rules
router.get('/', requirePermission('automation_rules.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50, trigger_event, is_enabled } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const offset = (pageNum - 1) * limitNum;

    const conditions = ['organization_id = ? AND deleted_at IS NULL'];
    const params = [req.orgId];
    if (trigger_event) { conditions.push('trigger_event = ?'); params.push(trigger_event); }
    if (is_enabled !== undefined) { conditions.push('is_enabled = ?'); params.push(is_enabled === 'true' ? 1 : 0); }

    const where = conditions.join(' AND ');
    const [rows] = await db.query(
      `SELECT * FROM automation_rules WHERE ${where} ORDER BY priority DESC, name ASC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset],
    );
    const [countResult] = await db.query(`SELECT COUNT(*) AS total FROM automation_rules WHERE ${where}`, params);
    res.json({ data: rows, meta: { total: countResult[0].total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

// GET /automation-rules/:id
router.get('/:id', requirePermission('automation_rules.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM automation_rules WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Automation rule not found' } });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// POST /automation-rules
router.post('/', requirePermission('automation_rules.create'), validate(createAutomationRule), async (req, res, next) => {
  try {
    const { name, description, trigger_event, trigger_conditions, action_type, action_config, is_enabled, priority } = req.body;
    const [result] = await db.query(
      `INSERT INTO automation_rules
         (organization_id, name, description, trigger_event, trigger_conditions,
          action_type, action_config, is_enabled, priority, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, name, description || null,
        trigger_event,
        trigger_conditions ? JSON.stringify(trigger_conditions) : null,
        action_type,
        action_config ? JSON.stringify(action_config) : null,
        is_enabled !== false ? 1 : 0,
        priority || 50, req.user.id],
    );
    const [rows] = await db.query('SELECT * FROM automation_rules WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

// PUT /automation-rules/:id
router.put('/:id', requirePermission('automation_rules.update'), validate(updateAutomationRule), async (req, res, next) => {
  try {
    const [existing] = await db.query(
      'SELECT id FROM automation_rules WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!existing.length) return res.status(404).json({ error: { message: 'Automation rule not found' } });

    const fields = [];
    const params = [];
    const allowed = ['name', 'description', 'trigger_event', 'trigger_conditions', 'action_type', 'action_config', 'is_enabled', 'priority'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`\`${key}\` = ?`);
        const v = req.body[key];
        params.push((key === 'trigger_conditions' || key === 'action_config') && typeof v === 'object' ? JSON.stringify(v) : v);
      }
    }
    if (!fields.length) return res.status(422).json({ error: { message: 'No updatable fields provided' } });
    params.push(req.params.id, req.orgId);
    await db.query(`UPDATE automation_rules SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ? AND organization_id = ?`, params);
    const [rows] = await db.query('SELECT * FROM automation_rules WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /automation-rules/:id
router.delete('/:id', requirePermission('automation_rules.delete'), async (req, res, next) => {
  try {
    const [existing] = await db.query(
      'SELECT id FROM automation_rules WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!existing.length) return res.status(404).json({ error: { message: 'Automation rule not found' } });
    await db.query('UPDATE automation_rules SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.status(204).send();
  } catch (err) { next(err); }
});

// POST /automation-rules/:id/execute — manually trigger a rule
router.post('/:id/execute', requirePermission('automation_rules.execute'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM automation_rules WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Automation rule not found' } });
    const rule = rows[0];
    const payload = req.body.payload || {};
    const result = await automationService.evaluateAutomationRules(req.orgId, rule.trigger_event, payload);
    res.json({ data: { rule_id: rule.id, result } });
  } catch (err) { next(err); }
});

// GET /automation-rules/:id/executions
router.get('/:id/executions', requirePermission('automation_rules.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM automation_rule_executions
       WHERE automation_rule_id = ? AND organization_id = ?
       ORDER BY executed_at DESC LIMIT 100`,
      [req.params.id, req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

module.exports = router;
