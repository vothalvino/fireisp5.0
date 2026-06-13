// =============================================================================
// FireISP 5.0 — Remediation Rules Routes (§18.1)
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const db = require('../config/database');
const automationService = require('../services/automationService');

const createRemediationRule = {
  name:                      { type: 'string', required: true, min: 1, max: 255 },
  description:               { type: 'string' },
  condition_metric:          { type: 'string', required: true, min: 1, max: 100 },
  condition_operator:        { type: 'string', required: true, enum: ['gt','lt','gte','lte','eq','neq','is_true'] },
  condition_threshold:       { type: 'number' },
  condition_duration_minutes:{ type: 'number', min: 0 },
  action_type:               { type: 'string', required: true, min: 1, max: 100 },
  action_config:             { type: 'object' },
  cooldown_minutes:          { type: 'number', min: 1 },
  is_enabled:                { type: 'boolean' },
};

const updateRemediationRule = {
  name:                      { type: 'string', min: 1, max: 255 },
  description:               { type: 'string' },
  condition_metric:          { type: 'string', min: 1, max: 100 },
  condition_operator:        { type: 'string', enum: ['gt','lt','gte','lte','eq','neq','is_true'] },
  condition_threshold:       { type: 'number' },
  condition_duration_minutes:{ type: 'number', min: 0 },
  action_type:               { type: 'string', min: 1, max: 100 },
  action_config:             { type: 'object' },
  cooldown_minutes:          { type: 'number', min: 1 },
  is_enabled:                { type: 'boolean' },
};

const router = Router();
router.use(authenticate);
router.use(orgScope);

// GET /remediation-rules
router.get('/', requirePermission('remediation_rules.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50, is_enabled } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10)), 100);
    const offset = (pageNum - 1) * limitNum;

    const conditions = ['organization_id = ? AND deleted_at IS NULL'];
    const params = [req.orgId];
    if (is_enabled !== undefined) { conditions.push('is_enabled = ?'); params.push(is_enabled === 'true' ? 1 : 0); }

    const where = conditions.join(' AND ');
    const [rows] = await db.query(
      `SELECT * FROM remediation_rules WHERE ${where} ORDER BY name ASC LIMIT ? OFFSET ?`,
      [...params, limitNum, offset],
    );
    const [countResult] = await db.query(`SELECT COUNT(*) AS total FROM remediation_rules WHERE ${where}`, params);
    res.json({ data: rows, meta: { total: countResult[0].total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

// GET /remediation-rules/:id
router.get('/:id', requirePermission('remediation_rules.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM remediation_rules WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Remediation rule not found' } });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// POST /remediation-rules
router.post('/', requirePermission('remediation_rules.create'), validate(createRemediationRule), async (req, res, next) => {
  try {
    const { name, description, condition_metric, condition_operator, condition_threshold,
      condition_duration_minutes, action_type, action_config, cooldown_minutes, is_enabled } = req.body;
    const [result] = await db.query(
      `INSERT INTO remediation_rules
         (organization_id, name, description, condition_metric, condition_operator,
          condition_threshold, condition_duration_minutes, action_type, action_config,
          cooldown_minutes, is_enabled, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, name, description || null, condition_metric, condition_operator,
        condition_threshold !== undefined ? condition_threshold : null,
        condition_duration_minutes || null,
        action_type, action_config ? JSON.stringify(action_config) : null,
        cooldown_minutes || 30, is_enabled !== false ? 1 : 0, req.user.id],
    );
    const [rows] = await db.query('SELECT * FROM remediation_rules WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

// PUT /remediation-rules/:id
router.put('/:id', requirePermission('remediation_rules.update'), validate(updateRemediationRule), async (req, res, next) => {
  try {
    const [existing] = await db.query(
      'SELECT id FROM remediation_rules WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!existing.length) return res.status(404).json({ error: { message: 'Remediation rule not found' } });

    const fields = [];
    const params = [];
    const allowed = ['name', 'description', 'condition_metric', 'condition_operator', 'condition_threshold',
      'condition_duration_minutes', 'action_type', 'action_config', 'cooldown_minutes', 'is_enabled'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`\`${key}\` = ?`);
        const v = req.body[key];
        params.push(key === 'action_config' && typeof v === 'object' ? JSON.stringify(v) : v);
      }
    }
    if (!fields.length) return res.status(422).json({ error: { message: 'No updatable fields provided' } });
    params.push(req.params.id, req.orgId);
    await db.query(`UPDATE remediation_rules SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ? AND organization_id = ?`, params);
    const [rows] = await db.query('SELECT * FROM remediation_rules WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /remediation-rules/:id
router.delete('/:id', requirePermission('remediation_rules.delete'), async (req, res, next) => {
  try {
    const [existing] = await db.query(
      'SELECT id FROM remediation_rules WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!existing.length) return res.status(404).json({ error: { message: 'Remediation rule not found' } });
    await db.query('UPDATE remediation_rules SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.status(204).send();
  } catch (err) { next(err); }
});

// GET /remediation-rules/:id/executions
router.get('/:id/executions', requirePermission('remediation_rules.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM remediation_executions
       WHERE remediation_rule_id = ? AND organization_id = ?
       ORDER BY executed_at DESC LIMIT 100`,
      [req.params.id, req.orgId],
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// POST /remediation-rules/evaluate — manually trigger evaluation
router.post('/evaluate', requirePermission('remediation_rules.update'), async (req, res, next) => {
  try {
    const result = await automationService.evaluateRemediationRules(req.orgId);
    res.json({ data: result });
  } catch (err) { next(err); }
});

module.exports = router;
