'use strict';

// =============================================================================
// FireISP 5.0 — Wireless/WISP Management Routes (§9.1)
// =============================================================================
// Mounted at /api/v1/wireless
//
// Resources:
//   /wireless/ap-sectors              — AP sector configurations
//   /wireless/channel-plans           — AP channel plans per site
//   /wireless/clients                 — Wireless client session snapshots
//   /wireless/channel-interference    — Channel interference records
//   /wireless/ap-commands             — AP remote command jobs
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  createApSectorConfig,
  updateApSectorConfig,
  createApChannelPlan,
  updateApChannelPlan,
  createApCommandJob,
  updateApCommandJob,
  createChannelInterference,
  updateChannelInterference,
} = require('../middleware/schemas/wirelessSectors');
const wirelessService = require('../services/wirelessService');
const logger = require('../utils/logger').child({ service: 'routes/wirelessManagement' });

const router = Router();
router.use(authenticate);
router.use(orgScope);

// =============================================================================
// AP Sector Configurations
// =============================================================================

/**
 * GET /wireless/ap-sectors
 * List AP sector configs. Optional ?device_id= filter.
 */
router.get('/ap-sectors', requirePermission('ap_sectors.view'), async (req, res, next) => {
  try {
    const { device_id: deviceId } = req.query;
    const data = await wirelessService.listApSectorConfigs(req.orgId, { deviceId });
    res.json({ data });
  } catch (err) { next(err); }
});

/**
 * GET /wireless/ap-sectors/:id
 */
router.get('/ap-sectors/:id', requirePermission('ap_sectors.view'), async (req, res, next) => {
  try {
    const record = await wirelessService.getApSectorConfig(req.params.id, req.orgId);
    if (!record) return res.status(404).json({ error: 'AP sector config not found' });
    res.json({ data: record });
  } catch (err) { next(err); }
});

/**
 * POST /wireless/ap-sectors
 */
router.post('/ap-sectors', requirePermission('ap_sectors.create'), validate(createApSectorConfig), async (req, res, next) => {
  try {
    const record = await wirelessService.createApSectorConfig(req.orgId, req.body);
    res.status(201).json({ data: record });
  } catch (err) { next(err); }
});

/**
 * PUT /wireless/ap-sectors/:id
 */
router.put('/ap-sectors/:id', requirePermission('ap_sectors.update'), validate(updateApSectorConfig), async (req, res, next) => {
  try {
    const record = await wirelessService.updateApSectorConfig(req.params.id, req.orgId, req.body);
    res.json({ data: record });
  } catch (err) { next(err); }
});

/**
 * DELETE /wireless/ap-sectors/:id
 */
router.delete('/ap-sectors/:id', requirePermission('ap_sectors.delete'), async (req, res, next) => {
  try {
    await wirelessService.deleteApSectorConfig(req.params.id, req.orgId);
    res.status(204).send();
  } catch (err) { next(err); }
});

/**
 * POST /wireless/ap-sectors/:id/restore
 */
router.post('/ap-sectors/:id/restore', requirePermission('ap_sectors.update'), async (req, res, next) => {
  try {
    const record = await wirelessService.restoreApSectorConfig(req.params.id, req.orgId);
    res.json({ data: record });
  } catch (err) { next(err); }
});

// =============================================================================
// AP Channel Plans
// =============================================================================

/**
 * GET /wireless/channel-plans
 * Optional ?site_id= and ?status= filters.
 */
router.get('/channel-plans', requirePermission('ap_channel_plans.view'), async (req, res, next) => {
  try {
    const { site_id: siteId, status } = req.query;
    const data = await wirelessService.listApChannelPlans(req.orgId, { siteId, status });
    res.json({ data });
  } catch (err) { next(err); }
});

/**
 * GET /wireless/channel-plans/:id
 */
router.get('/channel-plans/:id', requirePermission('ap_channel_plans.view'), async (req, res, next) => {
  try {
    const record = await wirelessService.getApChannelPlan(req.params.id, req.orgId);
    if (!record) return res.status(404).json({ error: 'AP channel plan not found' });
    res.json({ data: record });
  } catch (err) { next(err); }
});

/**
 * POST /wireless/channel-plans
 */
router.post('/channel-plans', requirePermission('ap_channel_plans.create'), validate(createApChannelPlan), async (req, res, next) => {
  try {
    const record = await wirelessService.createApChannelPlan(req.orgId, req.body);
    res.status(201).json({ data: record });
  } catch (err) { next(err); }
});

/**
 * PUT /wireless/channel-plans/:id
 */
router.put('/channel-plans/:id', requirePermission('ap_channel_plans.update'), validate(updateApChannelPlan), async (req, res, next) => {
  try {
    const record = await wirelessService.updateApChannelPlan(req.params.id, req.orgId, req.body);
    res.json({ data: record });
  } catch (err) { next(err); }
});

/**
 * DELETE /wireless/channel-plans/:id
 */
router.delete('/channel-plans/:id', requirePermission('ap_channel_plans.delete'), async (req, res, next) => {
  try {
    await wirelessService.deleteApChannelPlan(req.params.id, req.orgId);
    res.status(204).send();
  } catch (err) { next(err); }
});

/**
 * POST /wireless/channel-plans/:id/restore
 */
router.post('/channel-plans/:id/restore', requirePermission('ap_channel_plans.update'), async (req, res, next) => {
  try {
    const record = await wirelessService.restoreApChannelPlan(req.params.id, req.orgId);
    res.json({ data: record });
  } catch (err) { next(err); }
});

/**
 * GET /wireless/channel-plans/conflicts/:siteId
 * Detect frequency overlaps within a site.
 */
router.get('/channel-plans/conflicts/:siteId', requirePermission('wireless_channels.view'), async (req, res, next) => {
  try {
    const conflicts = await wirelessService.detectChannelConflicts(req.params.siteId, req.orgId);
    res.json({ data: conflicts });
  } catch (err) { next(err); }
});

// =============================================================================
// Wireless Client Sessions
// =============================================================================

/**
 * GET /wireless/clients
 * Optional ?device_id=, ?since= (ISO datetime), ?limit=, ?offset= filters.
 */
router.get('/clients', requirePermission('wireless_clients.view'), async (req, res, next) => {
  try {
    const { device_id: deviceId, since, limit, offset } = req.query;
    const data = await wirelessService.listWirelessClientSessions(req.orgId, {
      deviceId,
      since,
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

/**
 * POST /wireless/clients/batch
 * Ingest a batch of client session snapshots from a poller.
 * Expects { sessions: [...] } body.
 */
router.post('/clients/batch', requirePermission('wireless_clients.view'), async (req, res, next) => {
  try {
    const { sessions } = req.body;
    if (!Array.isArray(sessions)) {
      return res.status(400).json({ error: 'sessions must be an array' });
    }
    const count = await wirelessService.recordClientSessions(req.orgId, sessions);
    res.status(201).json({ data: { recorded: count } });
  } catch (err) { next(err); }
});

// =============================================================================
// Channel Interference
// =============================================================================

/**
 * GET /wireless/channel-interference
 * Optional ?site_id=, ?level=, ?since=, ?limit=, ?offset= filters.
 */
router.get('/channel-interference', requirePermission('wireless_channels.view'), async (req, res, next) => {
  try {
    const { site_id: siteId, level, since, limit, offset } = req.query;
    const data = await wirelessService.listChannelInterference(req.orgId, {
      siteId,
      level,
      since,
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

/**
 * POST /wireless/channel-interference
 */
router.post('/channel-interference', requirePermission('wireless_channels.manage'), validate(createChannelInterference), async (req, res, next) => {
  try {
    const record = await wirelessService.createChannelInterference(req.orgId, req.body);
    res.status(201).json({ data: record });
  } catch (err) { next(err); }
});

/**
 * PUT /wireless/channel-interference/:id
 */
router.put('/channel-interference/:id', requirePermission('wireless_channels.manage'), validate(updateChannelInterference), async (req, res, next) => {
  try {
    const record = await wirelessService.updateChannelInterference(req.params.id, req.orgId, req.body);
    res.json({ data: record });
  } catch (err) { next(err); }
});

/**
 * DELETE /wireless/channel-interference/:id
 */
router.delete('/channel-interference/:id', requirePermission('wireless_channels.manage'), async (req, res, next) => {
  try {
    await wirelessService.deleteChannelInterference(req.params.id, req.orgId);
    res.status(204).send();
  } catch (err) { next(err); }
});

// =============================================================================
// AP Command Jobs
// =============================================================================

/**
 * GET /wireless/ap-commands
 * Optional ?device_id=, ?status=, ?limit=, ?offset= filters.
 */
router.get('/ap-commands', requirePermission('ap_commands.view'), async (req, res, next) => {
  try {
    const { device_id: deviceId, status, limit, offset } = req.query;
    const data = await wirelessService.listApCommandJobs(req.orgId, {
      deviceId,
      status,
      limit: limit ? parseInt(limit, 10) : 100,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json({ data });
  } catch (err) { next(err); }
});

/**
 * GET /wireless/ap-commands/:id
 */
router.get('/ap-commands/:id', requirePermission('ap_commands.view'), async (req, res, next) => {
  try {
    const record = await wirelessService.getApCommandJob(req.params.id, req.orgId);
    if (!record) return res.status(404).json({ error: 'AP command job not found' });
    res.json({ data: record });
  } catch (err) { next(err); }
});

/**
 * POST /wireless/ap-commands
 */
router.post('/ap-commands', requirePermission('ap_commands.create'), validate(createApCommandJob), async (req, res, next) => {
  try {
    const record = await wirelessService.createApCommandJob(req.orgId, req.user && req.user.id, req.body);
    res.status(201).json({ data: record });
  } catch (err) { next(err); }
});

/**
 * PUT /wireless/ap-commands/:id
 */
router.put('/ap-commands/:id', requirePermission('ap_commands.create'), validate(updateApCommandJob), async (req, res, next) => {
  try {
    logger.warn({ jobId: req.params.id }, 'direct command job update — prefer cancel + recreate');
    const [existing] = await (require('../config/database')).query(
      'SELECT id FROM ap_command_jobs WHERE id = ? AND (organization_id = ? OR organization_id IS NULL) AND deleted_at IS NULL',
      [req.params.id, req.orgId],
    );
    if (!existing.length) return res.status(404).json({ error: 'AP command job not found' });
    const db = require('../config/database');
    const { organization_id: _o, id: _i, created_at: _c, deleted_at: _d, ...fields } = req.body;
    await db.query(
      'UPDATE ap_command_jobs SET ? WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)',
      [{ ...fields, updated_at: new Date() }, req.params.id, req.orgId],
    );
    const record = await wirelessService.getApCommandJob(req.params.id, req.orgId);
    res.json({ data: record });
  } catch (err) { next(err); }
});

/**
 * POST /wireless/ap-commands/:id/cancel
 */
router.post('/ap-commands/:id/cancel', requirePermission('ap_commands.create'), async (req, res, next) => {
  try {
    const record = await wirelessService.cancelApCommandJob(req.params.id, req.orgId);
    res.json({ data: record });
  } catch (err) { next(err); }
});

module.exports = router;
