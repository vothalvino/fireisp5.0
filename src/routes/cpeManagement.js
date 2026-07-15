// =============================================================================
// FireISP 5.0 — CPE Management Routes (§8.1/§8.3/§8.4)
// =============================================================================
// Mounted at /api/v1/cpe-management
// =============================================================================

'use strict';

const { Router } = require('express');
const db = require('../config/database');
const CpeDevice = require('../models/CpeDevice');
const _CpeParameter = require('../models/CpeParameter');
const CpeTask = require('../models/CpeTask');
const CpeFirmwareVersion = require('../models/CpeFirmwareVersion');
const CpeFirmwareCampaign = require('../models/CpeFirmwareCampaign');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createCpeDevice,
  updateCpeDevice,
} = require('../middleware/schemas/cpeDevices');
const {
  registerSerial: registerSerialSchema,
  installEquipment: installEquipmentSchema,
} = require('../middleware/schemas/inventorySerials');
const { createCpeTask } = require('../middleware/schemas/cpeTasks');
const {
  createCpeFirmwareVersion,
  updateCpeFirmwareVersion,
} = require('../middleware/schemas/cpeFirmwareVersions');
const {
  createCpeFirmwareCampaign,
  updateCpeFirmwareCampaign,
} = require('../middleware/schemas/cpeFirmwareCampaigns');
const bcrypt = require('bcryptjs');
// §8.3
const cpeDiagnosticsService = require('../services/cpeDiagnosticsService');
const cpeSessionLogService = require('../services/cpeSessionLogService');
// §8.4
const cpeInventoryService = require('../services/cpeInventoryService');
// Inventory Phase 3 (migration 391)
const inventorySerialService = require('../services/inventorySerialService');

const router = Router();

router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// CPE Devices
// ---------------------------------------------------------------------------

router.get('/devices', requirePermission('cpe_devices.view'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;

    const conditions = ['d.deleted_at IS NULL'];
    const params = [];

    if (req.orgId) {
      conditions.push('d.organization_id = ?');
      params.push(req.orgId);
    }
    if (req.query.status) {
      conditions.push('d.status = ?');
      params.push(req.query.status);
    }
    if (req.query.manufacturer) {
      conditions.push('d.manufacturer = ?');
      params.push(req.query.manufacturer);
    }
    if (req.query.model_name) {
      conditions.push('d.model_name = ?');
      params.push(req.query.model_name);
    }
    // Inventory Phase 3 (migration 391) filters — used by the install-time
    // serial picker (lifecycle_state=in_stock&inventory_item_id=N), the
    // client profile "assigned equipment" section (subscriber_id=N), and the
    // service-order Equipment panel's "currently assigned" list (contract_id=N).
    if (req.query.lifecycle_state) {
      conditions.push('d.lifecycle_state = ?');
      params.push(req.query.lifecycle_state);
    }
    if (req.query.inventory_item_id) {
      conditions.push('d.inventory_item_id = ?');
      params.push(req.query.inventory_item_id);
    }
    if (req.query.subscriber_id) {
      conditions.push('d.subscriber_id = ?');
      params.push(req.query.subscriber_id);
    }
    if (req.query.contract_id) {
      conditions.push('d.contract_id = ?');
      params.push(req.query.contract_id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await db.query(
      `SELECT d.*, i.name AS item_name, i.sku AS item_sku, c.name AS subscriber_name
       FROM cpe_devices d
       LEFT JOIN inventory_items i ON i.id = d.inventory_item_id
       LEFT JOIN clients c ON c.id = d.subscriber_id
       ${where} ORDER BY d.id DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM cpe_devices d ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total, page, limit } });
  } catch (err) { next(err); }
});

router.get('/devices/:id', requirePermission('cpe_devices.view'), async (req, res, next) => {
  try {
    const device = await CpeDevice.findByIdOrFail(req.params.id, req.orgId);
    const [params] = await db.query(
      'SELECT * FROM cpe_parameters WHERE cpe_device_id = ? ORDER BY parameter_path ASC LIMIT 100',
      [device.id],
    );
    res.json({ data: { ...device, parameters: params } });
  } catch (err) { next(err); }
});

router.post('/devices', requirePermission('cpe_devices.create'), validate(createCpeDevice), async (req, res, next) => {
  try {
    const data = { ...req.body, organization_id: req.orgId };
    if (data.acs_password) {
      data.acs_password_hash = await bcrypt.hash(data.acs_password, 10);
      delete data.acs_password;
    }
    const record = await CpeDevice.create(data);
    res.status(201).json({ data: record });
  } catch (err) { next(err); }
});

router.put('/devices/:id', requirePermission('cpe_devices.update'), validate(updateCpeDevice), async (req, res, next) => {
  try {
    const data = { ...req.body };
    if (data.acs_password) {
      data.acs_password_hash = await bcrypt.hash(data.acs_password, 10);
      delete data.acs_password;
    }
    const record = await CpeDevice.update(req.params.id, data, req.orgId);
    res.json({ data: record });
  } catch (err) { next(err); }
});

router.delete('/devices/:id', requirePermission('cpe_devices.delete'), async (req, res, next) => {
  try {
    await CpeDevice.delete(req.params.id, req.orgId);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// CPE Parameters
// ---------------------------------------------------------------------------

router.get('/devices/:id/parameters', requirePermission('cpe_parameters.view'), async (req, res, next) => {
  try {
    await CpeDevice.findByIdOrFail(req.params.id, req.orgId);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const offset = (page - 1) * limit;

    const conditions = ['cpe_device_id = ?'];
    const params = [req.params.id];

    if (req.query.prefix) {
      conditions.push('parameter_path LIKE ?');
      params.push(`${req.query.prefix}%`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const [rows] = await db.query(
      `SELECT * FROM cpe_parameters ${where} ORDER BY parameter_path ASC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM cpe_parameters ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total, page, limit } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// CPE Tasks
// ---------------------------------------------------------------------------

router.get('/devices/:id/tasks', requirePermission('cpe_tasks.view'), async (req, res, next) => {
  try {
    await CpeDevice.findByIdOrFail(req.params.id, req.orgId);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const [rows] = await db.query(
      `SELECT * FROM cpe_tasks WHERE cpe_device_id = ? ORDER BY queued_at DESC LIMIT ${limit} OFFSET ${offset}`,
      [req.params.id],
    );
    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) AS total FROM cpe_tasks WHERE cpe_device_id = ?',
      [req.params.id],
    );

    res.json({ data: rows, meta: { total, page, limit } });
  } catch (err) { next(err); }
});

router.post('/devices/:id/tasks', requirePermission('cpe_tasks.create'), validate(createCpeTask), async (req, res, next) => {
  try {
    await CpeDevice.findByIdOrFail(req.params.id, req.orgId);

    const record = await CpeTask.create({
      organization_id: req.orgId,
      cpe_device_id: parseInt(req.params.id, 10),
      task_type: req.body.task_type,
      parameters: req.body.parameters ? JSON.stringify(req.body.parameters) : null,
      priority: req.body.priority || 5,
      status: 'queued',
      created_by: req.user?.id || null,
    });

    res.status(201).json({ data: record });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Batch parameter push
// ---------------------------------------------------------------------------

router.post('/devices/batch-parameter-push', requirePermission('cpe_tasks.create'), async (req, res, next) => {
  try {
    const { cpe_ids, parameters } = req.body;
    if (!Array.isArray(cpe_ids) || cpe_ids.length === 0) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'cpe_ids array required' } });
    }
    if (!Array.isArray(parameters) || parameters.length === 0) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'parameters array required' } });
    }

    const created = [];
    for (const cpeId of cpe_ids) {
      const device = await CpeDevice.findById(cpeId, req.orgId);
      if (!device) continue;

      const task = await CpeTask.create({
        organization_id: req.orgId,
        cpe_device_id: cpeId,
        task_type: 'set_parameter_values',
        parameters: JSON.stringify(parameters),
        priority: 5,
        status: 'queued',
        created_by: req.user?.id || null,
      });
      created.push(task);
    }

    res.json({ data: created, meta: { queued: created.length } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Firmware Versions
// ---------------------------------------------------------------------------

router.get('/firmware-versions', requirePermission('cpe_firmware_versions.view'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;

    const conditions = ['deleted_at IS NULL'];
    const params = [];
    if (req.orgId) {
      conditions.push('(organization_id = ? OR organization_id IS NULL)');
      params.push(req.orgId);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const [rows] = await db.query(
      `SELECT * FROM cpe_firmware_versions ${where} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM cpe_firmware_versions ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total, page, limit } });
  } catch (err) { next(err); }
});

router.post('/firmware-versions', requirePermission('cpe_firmware_versions.create'), validate(createCpeFirmwareVersion), async (req, res, next) => {
  try {
    const record = await CpeFirmwareVersion.create({ ...req.body, organization_id: req.orgId });
    res.status(201).json({ data: record });
  } catch (err) { next(err); }
});

router.put('/firmware-versions/:id', requirePermission('cpe_firmware_versions.update'), validate(updateCpeFirmwareVersion), async (req, res, next) => {
  try {
    const record = await CpeFirmwareVersion.update(req.params.id, req.body, req.orgId);
    res.json({ data: record });
  } catch (err) { next(err); }
});

router.delete('/firmware-versions/:id', requirePermission('cpe_firmware_versions.delete'), async (req, res, next) => {
  try {
    await CpeFirmwareVersion.delete(req.params.id, req.orgId);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Firmware Campaigns
// ---------------------------------------------------------------------------

router.get('/firmware-campaigns', requirePermission('cpe_firmware_campaigns.view'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;

    const conditions = ['c.deleted_at IS NULL'];
    const params = [];
    if (req.orgId) {
      conditions.push('c.organization_id = ?');
      params.push(req.orgId);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const [rows] = await db.query(
      `SELECT c.*, fv.version AS firmware_version_label
       FROM cpe_firmware_campaigns c
       LEFT JOIN cpe_firmware_versions fv ON fv.id = c.firmware_version_id
       ${where} ORDER BY c.id DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM cpe_firmware_campaigns c ${where}`,
      params,
    );

    res.json({ data: rows, meta: { total, page, limit } });
  } catch (err) { next(err); }
});

router.post('/firmware-campaigns', requirePermission('cpe_firmware_campaigns.create'), validate(createCpeFirmwareCampaign), async (req, res, next) => {
  try {
    const record = await CpeFirmwareCampaign.create({
      ...req.body,
      organization_id: req.orgId,
      created_by: req.user?.id || null,
    });
    res.status(201).json({ data: record });
  } catch (err) { next(err); }
});

router.put('/firmware-campaigns/:id', requirePermission('cpe_firmware_campaigns.update'), validate(updateCpeFirmwareCampaign), async (req, res, next) => {
  try {
    const record = await CpeFirmwareCampaign.update(req.params.id, req.body, req.orgId);
    res.json({ data: record });
  } catch (err) { next(err); }
});

router.delete('/firmware-campaigns/:id', requirePermission('cpe_firmware_campaigns.delete'), async (req, res, next) => {
  try {
    await CpeFirmwareCampaign.delete(req.params.id, req.orgId);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ===========================================================================
// §8.3 — Diagnostics
// ===========================================================================

// List diagnostic results for a device
router.get('/devices/:id/diagnostics', requirePermission('cpe_diagnostics.view'), async (req, res, next) => {
  try {
    await CpeDevice.findByIdOrFail(req.params.id, req.orgId);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const result = await cpeDiagnosticsService.getDiagnosticList({
      cpeDeviceId: parseInt(req.params.id, 10),
      orgId: req.orgId,
      page,
      limit,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// Queue a new diagnostic
router.post('/devices/:id/diagnostics', requirePermission('cpe_diagnostics.create'), async (req, res, next) => {
  try {
    await CpeDevice.findByIdOrFail(req.params.id, req.orgId);
    const { diag_type, target_host } = req.body;
    const allowed = ['ping', 'traceroute', 'wifi_snapshot', 'ethernet_status', 'wan_diagnostics'];
    if (!diag_type || !allowed.includes(diag_type)) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: `diag_type must be one of: ${allowed.join(', ')}` } });
    }
    const result = await cpeDiagnosticsService.queueDiagnosticTask({
      cpeDeviceId: parseInt(req.params.id, 10),
      orgId: req.orgId,
      diagType: diag_type,
      targetHost: target_host || null,
      createdBy: req.user?.id || null,
    });
    res.status(201).json({ data: result });
  } catch (err) { next(err); }
});

// Delete (soft-delete) a diagnostic record
router.delete('/devices/:id/diagnostics/:diagId', requirePermission('cpe_diagnostics.delete'), async (req, res, next) => {
  try {
    await CpeDevice.findByIdOrFail(req.params.id, req.orgId);
    await cpeDiagnosticsService.deleteDiagnostic(req.params.diagId, req.orgId);
    res.status(204).send();
  } catch (err) { next(err); }
});

// Session logs — device-scoped
router.get('/devices/:id/session-logs', requirePermission('cpe_session_logs.view'), async (req, res, next) => {
  try {
    await CpeDevice.findByIdOrFail(req.params.id, req.orgId);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const result = await cpeSessionLogService.getSessionLogs({
      cpeDeviceId: parseInt(req.params.id, 10),
      orgId: req.orgId,
      eventType: req.query.event_type || null,
      page,
      limit,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// Delete session logs for a device
router.delete('/devices/:id/session-logs', requirePermission('cpe_session_logs.delete'), async (req, res, next) => {
  try {
    await CpeDevice.findByIdOrFail(req.params.id, req.orgId);
    const deleted = await cpeSessionLogService.deleteLogs({
      cpeDeviceId: parseInt(req.params.id, 10),
      orgId: req.orgId,
    });
    res.json({ data: { deleted } });
  } catch (err) { next(err); }
});

// Organization-wide session logs
router.get('/session-logs', requirePermission('cpe_session_logs.view'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const result = await cpeSessionLogService.getSessionLogs({
      orgId: req.orgId,
      eventType: req.query.event_type || null,
      page,
      limit,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ===========================================================================
// §8.4 — Inventory / Lifecycle
// ===========================================================================

// Get lifecycle history for a device
router.get('/devices/:id/lifecycle', requirePermission('cpe_lifecycle_history.view'), async (req, res, next) => {
  try {
    await CpeDevice.findByIdOrFail(req.params.id, req.orgId);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const result = await cpeInventoryService.getLifecycleHistory({
      cpeDeviceId: parseInt(req.params.id, 10),
      orgId: req.orgId,
      page,
      limit,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// Transition lifecycle state
router.post('/devices/:id/lifecycle/transition', requirePermission('cpe_inventory.manage'), async (req, res, next) => {
  try {
    await CpeDevice.findByIdOrFail(req.params.id, req.orgId);
    const { to_state, reason } = req.body;
    if (!to_state) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'to_state is required' } });
    }
    const device = await cpeInventoryService.transitionLifecycleState(
      parseInt(req.params.id, 10),
      to_state,
      { orgId: req.orgId, performedBy: req.user?.id || null, reason: reason || null },
    );
    res.json({ data: device });
  } catch (err) { next(err); }
});

// Link / unlink subscriber
router.post('/devices/:id/subscriber-link', requirePermission('cpe_inventory.link'), async (req, res, next) => {
  try {
    await CpeDevice.findByIdOrFail(req.params.id, req.orgId);
    const { subscriber_id } = req.body;
    const device = await cpeInventoryService.linkSubscriber(
      parseInt(req.params.id, 10),
      subscriber_id || null,
      { orgId: req.orgId, performedBy: req.user?.id || null },
    );
    res.json({ data: device });
  } catch (err) { next(err); }
});

// Swap workflow
router.post('/devices/swap', requirePermission('cpe_inventory.swap'), async (req, res, next) => {
  try {
    const { old_device_id, new_device_id, reason } = req.body;
    if (!old_device_id || !new_device_id) {
      return res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: 'old_device_id and new_device_id are required' } });
    }
    const result = await cpeInventoryService.swapDevice({
      oldDeviceId: parseInt(old_device_id, 10),
      newDeviceId: parseInt(new_device_id, 10),
      orgId: req.orgId,
      performedBy: req.user?.id || null,
      reason: reason || 'CPE swap',
    });
    res.json({ data: result });
  } catch (err) { next(err); }
});

// Get depreciation for a device
router.get('/devices/:id/depreciation', requirePermission('cpe_inventory.view'), async (req, res, next) => {
  try {
    const device = await CpeDevice.findByIdOrFail(req.params.id, req.orgId);
    const depreciation = cpeInventoryService.computeDepreciation(device);
    res.json({ data: { ...depreciation, device_id: device.id } });
  } catch (err) { next(err); }
});

// ===========================================================================
// Inventory Phase 3 (migration 391) — serialized equipment
// ===========================================================================

// Manual serial registration — CPE Inventory page's "Register" tab: legacy
// devices or catch-up for stock that predates an item's serial_required
// toggle. Default (no increment_stock) never touches inventory_stock.
router.post('/devices/register', requirePermission('cpe_inventory.manage'), validate(registerSerialSchema), async (req, res, next) => {
  try {
    const device = await inventorySerialService.registerSerial({
      orgId: req.orgId,
      itemId: req.body.inventory_item_id,
      serialNumber: req.body.serial_number,
      warehouseId: req.body.warehouse_id || null,
      manufacturer: req.body.manufacturer || null,
      modelName: req.body.model_name || null,
      notes: req.body.notes || null,
      incrementStock: !!req.body.increment_stock,
      performedBy: req.user?.id || null,
    });
    res.status(201).json({ data: device });
  } catch (err) { next(err); }
});

// Install — the drawdown moment. Picks an existing in-stock serial OR
// registers a brand-new one on the fly ("type-a-new-serial"), transitions it
// to 'assigned' on the given contract, and decrements stock exactly once
// (rent: assign_to_job ledger, no invoice; sold: a real invoice line via
// billingService.createOneOffInvoice, which itself calls drawdownForSale).
router.post('/devices/install', requirePermission('cpe_inventory.manage'), validate(installEquipmentSchema), async (req, res, next) => {
  try {
    const result = await inventorySerialService.installEquipment({
      orgId: req.orgId,
      contractId: req.body.contract_id,
      serviceOrderId: req.body.service_order_id || null,
      cpeDeviceId: req.body.cpe_device_id || null,
      newSerial: req.body.new_serial || null,
      inventoryItemId: req.body.inventory_item_id || null,
      ownership: req.body.ownership,
      performedBy: req.user?.id || null,
    });
    res.status(201).json({ data: result });
  } catch (err) { next(err); }
});

module.exports = router;
