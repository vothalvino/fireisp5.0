'use strict';

// =============================================================================
// FireISP 5.0 — ONU Management Routes (§7.2)
// =============================================================================
// Mounted at /api/onu-management and /api/v1/onu-management.
//
// Resources:
//   /profiles           — ONU profile templates CRUD
//   /details            — ONU detail records CRUD (extends device rows)
//   /details/:id        — single ONU detail
//   /details/:id/optical-metrics  — optical diagnostic history
//   /details/:id/provision        — trigger provisioning
//   /details/:id/reboot           — schedule remote reboot
//   /whitelist          — ONU MAC/SN allow-block list CRUD
//   /omci-configs       — OMCI/TR-069 config records CRUD
//   /firmware-jobs      — firmware upgrade / reboot job scheduler CRUD
//   /firmware-jobs/:id/cancel — cancel a pending job
// =============================================================================

const { Router } = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createOnuProfile, updateOnuProfile, patchOnuProfile,
} = require('../middleware/schemas/onuProfiles');
const {
  createOnuDetail, updateOnuDetail, patchOnuDetail,
} = require('../middleware/schemas/onuDetails');
const {
  createOnuWhitelistEntry, updateOnuWhitelistEntry,
} = require('../middleware/schemas/onuWhitelist');
const {
  createOnuOmciConfig, updateOnuOmciConfig,
} = require('../middleware/schemas/onuOmciConfigs');
const {
  createOnuFirmwareJob, updateOnuFirmwareJob,
} = require('../middleware/schemas/onuFirmwareJobs');
const ftthService = require('../services/ftthService');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// ===========================================================================
// ONU Profiles
// ===========================================================================

router.get('/profiles', requirePermission('onu_profiles.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 25, technology } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
    const offset = (pageNum - 1) * limitNum;

    let sql = 'SELECT * FROM onu_profiles WHERE (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL';
    const params = [req.orgId];
    if (technology) { sql += ' AND technology = ?'; params.push(technology); }

    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) AS total');
    const [countRows] = await db.query(countSql, params);
    const total = countRows[0].total;

    sql += ` ORDER BY name ASC LIMIT ${limitNum} OFFSET ${offset}`;
    const [rows] = await db.query(sql, params);
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

router.get('/profiles/:id', requirePermission('onu_profiles.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM onu_profiles WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.post('/profiles', requirePermission('onu_profiles.create'), validate(createOnuProfile), async (req, res, next) => {
  try {
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...fields } = req.body;
    const [result] = await db.query(
      'INSERT INTO onu_profiles SET ?',
      [{ organization_id: req.orgId, ...fields }],
    );
    const [rows] = await db.query('SELECT * FROM onu_profiles WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.put('/profiles/:id', requirePermission('onu_profiles.update'), validate(updateOnuProfile), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM onu_profiles WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...updateData } = req.body;
    await db.query('UPDATE onu_profiles SET ?, updated_at = NOW() WHERE id = ?', [updateData, req.params.id]);
    const [rows] = await db.query('SELECT * FROM onu_profiles WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/profiles/:id', requirePermission('onu_profiles.update'), validate(patchOnuProfile), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM onu_profiles WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...updateData } = req.body;
    if (!Object.keys(updateData).length) return res.status(400).json({ error: 'No fields to update' });
    await db.query('UPDATE onu_profiles SET ?, updated_at = NOW() WHERE id = ?', [updateData, req.params.id]);
    const [rows] = await db.query('SELECT * FROM onu_profiles WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/profiles/:id', requirePermission('onu_profiles.delete'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM onu_profiles WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    await db.query('UPDATE onu_profiles SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ===========================================================================
// ONU Details (provisioning/status records, one per ONU device)
// ===========================================================================

router.get('/details', requirePermission('onu_management.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 25, olt_device_id, olt_port_id, onu_state } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
    const offset = (pageNum - 1) * limitNum;

    let sql = `
      SELECT od.*, d.name AS device_name, d.mac_address, d.ip_address,
             p.port_name, np.name AS profile_name
      FROM onu_details od
      JOIN devices d ON d.id = od.device_id AND d.deleted_at IS NULL
      LEFT JOIN olt_ports p ON p.id = od.olt_port_id
      LEFT JOIN onu_profiles np ON np.id = od.onu_profile_id AND np.deleted_at IS NULL
      WHERE (od.organization_id = ? OR od.organization_id IS NULL) AND od.deleted_at IS NULL
    `;
    const params = [req.orgId];

    if (olt_device_id) { sql += ' AND od.olt_device_id = ?'; params.push(olt_device_id); }
    if (olt_port_id) { sql += ' AND od.olt_port_id = ?'; params.push(olt_port_id); }
    if (onu_state) { sql += ' AND od.onu_state = ?'; params.push(onu_state); }

    const countSql = sql.replace(/SELECT od\.\*.*?FROM/s, 'SELECT COUNT(*) AS total FROM');
    const [countRows] = await db.query(countSql, params);
    const total = countRows[0].total;

    sql += ` ORDER BY od.olt_device_id ASC, od.onu_id ASC LIMIT ${limitNum} OFFSET ${offset}`;
    const [rows] = await db.query(sql, params);
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

router.get('/details/:id', requirePermission('onu_management.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT od.*, d.name AS device_name, d.mac_address, d.ip_address,
              p.port_name, np.name AS profile_name
       FROM onu_details od
       JOIN devices d ON d.id = od.device_id AND d.deleted_at IS NULL
       LEFT JOIN olt_ports p ON p.id = od.olt_port_id
       LEFT JOIN onu_profiles np ON np.id = od.onu_profile_id AND np.deleted_at IS NULL
       WHERE od.id = ? AND (od.organization_id = ? OR od.organization_id IS NULL) AND od.deleted_at IS NULL`,
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.post('/details', requirePermission('onu_management.create'), validate(createOnuDetail), async (req, res, next) => {
  try {
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...fields } = req.body;
    const [result] = await db.query(
      'INSERT INTO onu_details SET ?',
      [{ organization_id: req.orgId, ...fields }],
    );
    const [rows] = await db.query('SELECT * FROM onu_details WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.put('/details/:id', requirePermission('onu_management.update'), validate(updateOnuDetail), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM onu_details WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, device_id: _____, ...updateData } = req.body;
    await db.query('UPDATE onu_details SET ?, updated_at = NOW() WHERE id = ?', [updateData, req.params.id]);
    const [rows] = await db.query('SELECT * FROM onu_details WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/details/:id', requirePermission('onu_management.update'), validate(patchOnuDetail), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM onu_details WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, device_id: _____, ...updateData } = req.body;
    if (!Object.keys(updateData).length) return res.status(400).json({ error: 'No fields to update' });
    await db.query('UPDATE onu_details SET ?, updated_at = NOW() WHERE id = ?', [updateData, req.params.id]);
    const [rows] = await db.query('SELECT * FROM onu_details WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/details/:id', requirePermission('onu_management.delete'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM onu_details WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    await db.query('UPDATE onu_details SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ONU optical diagnostics history
router.get('/details/:id/optical-metrics', requirePermission('onu_management.view'), async (req, res, next) => {
  try {
    const [detail] = await db.query(
      'SELECT device_id FROM onu_details WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!detail.length) return res.status(404).json({ error: 'ONU detail not found' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const rows = await ftthService.getOnuOpticalHistory(detail[0].device_id, req.orgId, limit);
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ONU provision action (creates/updates onu_details + provision job)
router.post('/details/:id/provision', requirePermission('onu_management.create'), async (req, res, next) => {
  try {
    const [detail] = await db.query(
      'SELECT * FROM onu_details WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!detail.length) return res.status(404).json({ error: 'ONU detail not found' });
    const result = await ftthService.provisionOnu({
      deviceId: detail[0].device_id,
      oltDeviceId: req.body.olt_device_id || detail[0].olt_device_id,
      oltPortId: req.body.olt_port_id || detail[0].olt_port_id,
      onuProfileId: req.body.onu_profile_id || detail[0].onu_profile_id,
      serialNumber: req.body.serial_number || detail[0].serial_number,
      loid: req.body.loid || detail[0].loid,
      loidPasswordEncrypted: req.body.loid_password_encrypted || detail[0].loid_password_encrypted,
      orgId: req.orgId,
      createdBy: req.user?.id,
    });
    res.status(202).json({ data: result, message: 'Provision job queued — delivery dispatched by background processor' });
  } catch (err) { next(err); }
});

// ONU reboot action
router.post('/details/:id/reboot', requirePermission('onu_management.update'), async (req, res, next) => {
  try {
    const [detail] = await db.query(
      'SELECT device_id, olt_device_id FROM onu_details WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!detail.length) return res.status(404).json({ error: 'ONU detail not found' });
    const job = await ftthService.scheduleOnuReboot(
      detail[0].device_id,
      detail[0].olt_device_id,
      req.orgId,
      req.user?.id,
    );
    res.status(202).json({ data: job, message: 'Reboot job queued — dispatched by background processor' });
  } catch (err) { next(err); }
});

// ===========================================================================
// ONU Whitelist
// ===========================================================================

router.get('/whitelist', requirePermission('onu_whitelist.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 25, olt_device_id, list_type, entry_type } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
    const offset = (pageNum - 1) * limitNum;

    let sql = 'SELECT * FROM onu_whitelist WHERE (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL';
    const params = [req.orgId];
    if (olt_device_id) { sql += ' AND olt_device_id = ?'; params.push(olt_device_id); }
    if (list_type) { sql += ' AND list_type = ?'; params.push(list_type); }
    if (entry_type) { sql += ' AND entry_type = ?'; params.push(entry_type); }

    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) AS total');
    const [countRows] = await db.query(countSql, params);
    const total = countRows[0].total;

    sql += ` ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;
    const [rows] = await db.query(sql, params);
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

router.get('/whitelist/:id', requirePermission('onu_whitelist.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM onu_whitelist WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.post('/whitelist', requirePermission('onu_whitelist.create'), validate(createOnuWhitelistEntry), async (req, res, next) => {
  try {
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...fields } = req.body;
    const [result] = await db.query(
      'INSERT INTO onu_whitelist SET ?',
      [{ organization_id: req.orgId, ...fields }],
    );
    const [rows] = await db.query('SELECT * FROM onu_whitelist WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.put('/whitelist/:id', requirePermission('onu_whitelist.update'), validate(updateOnuWhitelistEntry), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM onu_whitelist WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, olt_device_id: _____, entry_type: ______, entry_value: _______, ...updateData } = req.body;
    await db.query('UPDATE onu_whitelist SET ?, updated_at = NOW() WHERE id = ?', [updateData, req.params.id]);
    const [rows] = await db.query('SELECT * FROM onu_whitelist WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/whitelist/:id', requirePermission('onu_whitelist.delete'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM onu_whitelist WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    await db.query('UPDATE onu_whitelist SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ===========================================================================
// OMCI / TR-069 Configs
// ===========================================================================

router.get('/omci-configs', requirePermission('onu_omci_configs.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 25, device_id, config_type, apply_status } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
    const offset = (pageNum - 1) * limitNum;

    let sql = 'SELECT * FROM onu_omci_configs WHERE (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL';
    const params = [req.orgId];
    if (device_id) { sql += ' AND device_id = ?'; params.push(device_id); }
    if (config_type) { sql += ' AND config_type = ?'; params.push(config_type); }
    if (apply_status) { sql += ' AND apply_status = ?'; params.push(apply_status); }

    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) AS total');
    const [countRows] = await db.query(countSql, params);
    const total = countRows[0].total;

    sql += ` ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;
    const [rows] = await db.query(sql, params);
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

router.get('/omci-configs/:id', requirePermission('onu_omci_configs.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM onu_omci_configs WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.post('/omci-configs', requirePermission('onu_omci_configs.create'), validate(createOnuOmciConfig), async (req, res, next) => {
  try {
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, applied_at: _____, apply_error: ______, ...fields } = req.body;
    const [result] = await db.query(
      'INSERT INTO onu_omci_configs SET ?',
      [{ organization_id: req.orgId, apply_status: 'pending', ...fields }],
    );
    const [rows] = await db.query('SELECT * FROM onu_omci_configs WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.put('/omci-configs/:id', requirePermission('onu_omci_configs.update'), validate(updateOnuOmciConfig), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM onu_omci_configs WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, device_id: _____, ...updateData } = req.body;
    await db.query('UPDATE onu_omci_configs SET ?, updated_at = NOW() WHERE id = ?', [updateData, req.params.id]);
    const [rows] = await db.query('SELECT * FROM onu_omci_configs WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/omci-configs/:id', requirePermission('onu_omci_configs.delete'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM onu_omci_configs WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    await db.query('UPDATE onu_omci_configs SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.status(204).send();
  } catch (err) { next(err); }
});

// ===========================================================================
// Firmware / Reboot Jobs
// ===========================================================================

router.get('/firmware-jobs', requirePermission('onu_firmware_jobs.view'), async (req, res, next) => {
  try {
    const { page = 1, limit = 25, status, job_type, olt_device_id } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 25), 100);
    const offset = (pageNum - 1) * limitNum;

    let sql = 'SELECT * FROM onu_firmware_jobs WHERE (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL';
    const params = [req.orgId];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (job_type) { sql += ' AND job_type = ?'; params.push(job_type); }
    if (olt_device_id) { sql += ' AND olt_device_id = ?'; params.push(olt_device_id); }

    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) AS total');
    const [countRows] = await db.query(countSql, params);
    const total = countRows[0].total;

    sql += ` ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;
    const [rows] = await db.query(sql, params);
    res.json({ data: rows, meta: { total, page: pageNum, limit: limitNum } });
  } catch (err) { next(err); }
});

router.get('/firmware-jobs/:id', requirePermission('onu_firmware_jobs.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM onu_firmware_jobs WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.post('/firmware-jobs', requirePermission('onu_firmware_jobs.create'), validate(createOnuFirmwareJob), async (req, res, next) => {
  try {
    const job = await ftthService.scheduleFirmwareUpgrade({
      scope: req.body.scope,
      onuDeviceId: req.body.onu_device_id,
      oltDeviceId: req.body.olt_device_id,
      oltPortId: req.body.olt_port_id,
      firmwareVersion: req.body.firmware_version,
      firmwareUrl: req.body.firmware_url,
      scheduledAt: req.body.scheduled_at,
      orgId: req.orgId,
      createdBy: req.user?.id,
    });
    res.status(201).json({ data: job });
  } catch (err) { next(err); }
});

router.put('/firmware-jobs/:id', requirePermission('onu_firmware_jobs.update'), validate(updateOnuFirmwareJob), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id, status FROM onu_firmware_jobs WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    const { organization_id: _, id: __, created_at: ___, deleted_at: ____, ...updateData } = req.body;
    await db.query('UPDATE onu_firmware_jobs SET ?, updated_at = NOW() WHERE id = ?', [updateData, req.params.id]);
    const [rows] = await db.query('SELECT * FROM onu_firmware_jobs WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.post('/firmware-jobs/:id/cancel', requirePermission('onu_firmware_jobs.update'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id, status FROM onu_firmware_jobs WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    if (!['pending', 'queued'].includes(check[0].status)) {
      return res.status(409).json({ error: `Cannot cancel a job in status '${check[0].status}'` });
    }
    await db.query(
      "UPDATE onu_firmware_jobs SET status = 'cancelled', updated_at = NOW() WHERE id = ?",
      [req.params.id],
    );
    const [rows] = await db.query('SELECT * FROM onu_firmware_jobs WHERE id = ?', [req.params.id]);
    res.json({ data: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/firmware-jobs/:id', requirePermission('onu_firmware_jobs.delete'), async (req, res, next) => {
  try {
    const [check] = await db.query(
      'SELECT id FROM onu_firmware_jobs WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    await db.query('UPDATE onu_firmware_jobs SET deleted_at = NOW() WHERE id = ?', [req.params.id]);
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
