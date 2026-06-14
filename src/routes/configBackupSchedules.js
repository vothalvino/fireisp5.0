// =============================================================================
// FireISP 5.0 — Config Backup Schedule Routes — §6.6
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createSchedule, updateSchedule } = require('../middleware/schemas/configBackupSchedules');
const { NotFoundError } = require('../utils/errors');

const router = Router();
router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('config_backup_schedules.view'), async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 25);
    const offset = (page - 1) * limit;
    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) AS total FROM config_backup_schedules WHERE organization_id = ? AND deleted_at IS NULL',
      [orgId],
    );
    const [rows] = await db.query(
      'SELECT * FROM config_backup_schedules WHERE organization_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [orgId, limit, offset],
    );
    res.json({ data: rows, meta: { total, page, limit } });
  } catch (err) { next(err); }
});

router.post('/', requirePermission('config_backup_schedules.create'), validate(createSchedule), async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { schedule_name, device_id, cron_expression, is_enabled } = req.body;
    const [result] = await db.query(
      `INSERT INTO config_backup_schedules (organization_id, device_id, schedule_name, cron_expression, is_enabled)
       VALUES (?, ?, ?, ?, ?)`,
      [orgId, device_id || null, schedule_name, cron_expression || '0 2 * * *', is_enabled !== undefined ? (is_enabled ? 1 : 0) : 1],
    );
    const [[row]] = await db.query('SELECT * FROM config_backup_schedules WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('config_backup_schedules.update'), validate(updateSchedule), async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { id } = req.params;
    const [[existing]] = await db.query(
      'SELECT id FROM config_backup_schedules WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [id, orgId],
    );
    if (!existing) throw new NotFoundError('config_backup_schedules');
    const fields = ['schedule_name', 'device_id', 'cron_expression', 'is_enabled'];
    const updates = [];
    const vals = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        vals.push(f === 'is_enabled' ? (req.body[f] ? 1 : 0) : req.body[f]);
      }
    }
    if (updates.length === 0) {
      const [[row]] = await db.query('SELECT * FROM config_backup_schedules WHERE id = ?', [id]);
      return res.json({ data: row });
    }
    vals.push(id);
    await db.query(`UPDATE config_backup_schedules SET ${updates.join(', ')} WHERE id = ?`, vals);
    const [[row]] = await db.query('SELECT * FROM config_backup_schedules WHERE id = ?', [id]);
    res.json({ data: row });
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('config_backup_schedules.delete'), async (req, res, next) => {
  try {
    const orgId = req.orgId;
    const { id } = req.params;
    const [result] = await db.query(
      'UPDATE config_backup_schedules SET deleted_at = NOW() WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
      [id, orgId],
    );
    if (result.affectedRows === 0) throw new NotFoundError('config_backup_schedules');
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
