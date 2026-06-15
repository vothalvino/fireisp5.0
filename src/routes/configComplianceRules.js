// =============================================================================
// FireISP 5.0 — Config Compliance Rule Routes — §6.6
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createRule, updateRule } = require('../middleware/schemas/configComplianceRules');
const { runComplianceAudit } = require('../services/configBackupService');
const { NotFoundError } = require('../utils/errors');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// GET /results — list compliance results (before /:id to avoid route collision)
router.get('/results', requirePermission('config_compliance.view'), async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 25);
    const offset = (page - 1) * limit;
    const conditions = ['ccr.organization_id = ?'];
    const params = [orgId];
    if (req.query.device_id) { conditions.push('cr.device_id = ?'); params.push(req.query.device_id); }
    if (req.query.rule_id) { conditions.push('cr.rule_id = ?'); params.push(req.query.rule_id); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM config_compliance_results cr JOIN config_compliance_rules ccr ON ccr.id = cr.rule_id ${where}`,
      params,
    );
    const [rows] = await db.query(
      `SELECT cr.* FROM config_compliance_results cr JOIN config_compliance_rules ccr ON ccr.id = cr.rule_id ${where} ORDER BY cr.evaluated_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json({ data: rows, meta: { total, page, limit } });
  } catch (err) { next(err); }
});

// POST /run — run compliance audit
router.post('/run', requirePermission('config_compliance.run'), async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { backup_id } = req.body;
    if (!backup_id) return res.status(400).json({ error: 'backup_id is required' });
    const stats = await runComplianceAudit(Number(backup_id), orgId);
    res.json({ data: stats });
  } catch (err) { next(err); }
});

// GET / — list rules
router.get('/', requirePermission('config_compliance.view'), async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 25);
    const offset = (page - 1) * limit;
    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) AS total FROM config_compliance_rules WHERE organization_id = ? AND deleted_at IS NULL',
      [orgId],
    );
    const [rows] = await db.query(
      `SELECT * FROM config_compliance_rules WHERE organization_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      [orgId],
    );
    res.json({ data: rows, meta: { total, page, limit } });
  } catch (err) { next(err); }
});

// POST / — create rule
router.post('/', requirePermission('config_compliance.create'), validate(createRule), async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { name, description, rule_type, pattern, severity, applies_to_device_type, is_enabled } = req.body;
    const [result] = await db.query(
      `INSERT INTO config_compliance_rules (organization_id, name, description, rule_type, pattern, severity, applies_to_device_type, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [orgId, name, description || null, rule_type, pattern, severity || 'warning', applies_to_device_type || null,
        is_enabled !== undefined ? (is_enabled ? 1 : 0) : 1],
    );
    const [[row]] = await db.query('SELECT * FROM config_compliance_rules WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

// PUT /:id — update
router.put('/:id', requirePermission('config_compliance.update'), validate(updateRule), async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { id } = req.params;
    const [[existing]] = await db.query(
      'SELECT id FROM config_compliance_rules WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [id, orgId],
    );
    if (!existing) throw new NotFoundError('config_compliance_rules');
    const fields = ['name', 'description', 'rule_type', 'pattern', 'severity', 'applies_to_device_type', 'is_enabled'];
    const updates = [];
    const vals = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        vals.push(f === 'is_enabled' ? (req.body[f] ? 1 : 0) : req.body[f]);
      }
    }
    if (updates.length === 0) {
      const [[row]] = await db.query('SELECT * FROM config_compliance_rules WHERE id = ?', [id]);
      return res.json({ data: row });
    }
    vals.push(id);
    await db.query(`UPDATE config_compliance_rules SET ${updates.join(', ')} WHERE id = ?`, vals);
    const [[row]] = await db.query('SELECT * FROM config_compliance_rules WHERE id = ?', [id]);
    res.json({ data: row });
  } catch (err) { next(err); }
});

// DELETE /:id — soft delete
router.delete('/:id', requirePermission('config_compliance.delete'), async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { id } = req.params;
    const [result] = await db.query(
      'UPDATE config_compliance_rules SET deleted_at = NOW() WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [id, orgId],
    );
    if (result.affectedRows === 0) throw new NotFoundError('config_compliance_rules');
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
