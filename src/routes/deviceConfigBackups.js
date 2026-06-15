// =============================================================================
// FireISP 5.0 — Device Config Backup Routes
// =============================================================================

const { Router } = require('express');
const DeviceConfigBackup = require('../models/DeviceConfigBackup');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createDeviceConfigBackup, updateDeviceConfigBackup } = require('../middleware/schemas/deviceConfigBackups');
const { tunnelServer } = require('../services/firerelayTunnel');
const configBackupService = require('../services/configBackupService');
const db = require('../config/database');
const { NotFoundError, ValidationError } = require('../utils/errors');

const router = Router();
const ctrl = crudController(DeviceConfigBackup);

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('device_config_backups.view'), ctrl.list);
router.get('/:id', requirePermission('device_config_backups.view'), ctrl.get);
router.post('/', requirePermission('device_config_backups.create'), validate(createDeviceConfigBackup), ctrl.create);
router.put('/:id', requirePermission('device_config_backups.update'), validate(updateDeviceConfigBackup), ctrl.update);
router.delete('/:id', requirePermission('device_config_backups.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('device_config_backups.update'), ctrl.restore);

// ---------------------------------------------------------------------------
// GET /api/device-config-backups/diff/:id — get diff from previous version
// ---------------------------------------------------------------------------
router.get('/diff/:id', requirePermission('device_config_backups.view'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      'SELECT id, device_id, version, diff_from_previous FROM device_config_backups WHERE id = ?',
      [id],
    );
    if (rows.length === 0) throw new NotFoundError('device_config_backups');
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /api/device-config-backups/compliance-run — run compliance audit
// ---------------------------------------------------------------------------
router.post('/compliance-run', requirePermission('config_compliance.run'), async (req, res, next) => {
  try {
    const { backup_id } = req.body;
    if (!backup_id) return res.status(400).json({ error: 'backup_id is required' });
    const orgId = req.organizationId;
    const stats = await configBackupService.runComplianceAudit(Number(backup_id), orgId);
    res.json({ data: stats });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/device-config-backups/compliance-results — list compliance results
// ---------------------------------------------------------------------------
router.get('/compliance-results', requirePermission('config_compliance.view'), async (req, res, next) => {
  try {
    const orgId = req.organizationId;
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

// ---------------------------------------------------------------------------
// POST /api/device-config-backups/pull
// Trigger an on-demand config backup pull for a specific device via its
// assigned FireRelay agent.
//
// Body: { device_id, user?, password?, port?, compact?, notes? }
//   - user/password override env-var defaults for this pull only.
//   - password is required if ROUTEROS_API_PASSWORD is not set.
// ---------------------------------------------------------------------------
router.post(
  '/pull',
  requirePermission('device_config_backups.create'),
  async (req, res, next) => {
    try {
      const { device_id, user, password, port, compact, notes } = req.body;

      if (!device_id) {
        throw new ValidationError('device_id is required');
      }

      const [rows] = await db.query(
        'SELECT id, name, ip_address, firerelay_node_id FROM devices WHERE id = ? AND deleted_at IS NULL',
        [device_id],
      );

      if (rows.length === 0) {
        throw new NotFoundError('devices');
      }

      const device = rows[0];

      if (!device.firerelay_node_id) {
        throw new ValidationError('Device does not have a firerelay_node_id — assign a FireRelay agent first');
      }

      if (!device.ip_address) {
        throw new ValidationError('Device does not have an ip_address');
      }

      if (!tunnelServer.isConnected(device.firerelay_node_id)) {
        throw new ValidationError(`FireRelay agent '${device.firerelay_node_id}' is not currently connected`);
      }

      const resolvedUser = user || process.env.ROUTEROS_API_USER || 'admin';
      const resolvedPassword = password || process.env.ROUTEROS_API_PASSWORD;

      if (!resolvedPassword) {
        throw new ValidationError('RouterOS password is required (provide in request body or set ROUTEROS_API_PASSWORD)');
      }

      const result = await configBackupService.pullBackupForDevice({
        deviceId: device.id,
        nodeId: device.firerelay_node_id,
        host: device.ip_address,
        user: resolvedUser,
        password: resolvedPassword,
        port: port ? Number(port) : undefined,
        compact: !!compact,
        captureMethod: 'manual',
        capturedByUserId: req.user?.id ?? null,
        notes: notes || null,
      });

      res.status(result.skipped ? 200 : 201).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
