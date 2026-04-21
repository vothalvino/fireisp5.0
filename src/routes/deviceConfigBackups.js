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
