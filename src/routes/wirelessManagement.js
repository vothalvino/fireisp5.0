'use strict';

// =============================================================================
// FireISP 5.0 — Wireless/WISP Management Routes (§9.1 + §9.2 + §9.3)
// =============================================================================
// Mounted at /api/v1/wireless
//
// Resources:
//   /wireless/ap-sectors              — AP sector configurations           (§9.1)
//   /wireless/channel-plans           — AP channel plans per site          (§9.1)
//   /wireless/clients                 — Wireless client session snapshots  (§9.1)
//   /wireless/channel-interference    — Channel interference records       (§9.1)
//   /wireless/ap-commands             — AP remote command jobs             (§9.1)
//   /wireless/link-planning           — Link budget calculator runs        (§9.2)
//   /wireless/network-links/:id/ptp-metrics — PTP link metrics            (§9.2)
//   /wireless/clients/signal-distribution   — Signal histogram            (§9.3)
//   /wireless/spectrum-scans          — Spectrum scan results              (§9.3)
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
const { buildUpdate } = require('../utils/sqlBuild');
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
    const { assignments, values } = buildUpdate(fields);
    const setClause = assignments ? `${assignments}, updated_at = NOW()` : 'updated_at = NOW()';
    await db.query(
      `UPDATE ap_command_jobs SET ${setClause} WHERE id = ? AND (organization_id = ? OR organization_id IS NULL)`,
      [...values, req.params.id, req.orgId],
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

// =============================================================================
// §9.2 Link Planning Calculator
// =============================================================================

/**
 * POST /wireless/link-planning/calculate
 * Pure calculator — no DB save. Returns computed distance, FSPL, Fresnel, link budget.
 */
router.post('/link-planning/calculate', requirePermission('link_planning.view'), async (req, res, next) => {
  try {
    const { lat_a, lon_a, lat_b, lon_b, frequency_mhz, tx_power_dbm, antenna_gain_a_dbi, antenna_gain_b_dbi, cable_loss_db } = req.body;
    if (lat_a === null || lat_a === undefined || lon_a === null || lon_a === undefined || lat_b === null || lat_b === undefined || lon_b === null || lon_b === undefined || !frequency_mhz) {
      return res.status(400).json({ error: 'lat_a, lon_a, lat_b, lon_b, and frequency_mhz are required' });
    }
    const result = wirelessService.calculateLinkBudget({
      lat_a, lon_a, lat_b, lon_b, frequency_mhz, tx_power_dbm, antenna_gain_a_dbi, antenna_gain_b_dbi, cable_loss_db,
    });
    res.json({ data: result });
  } catch (err) { next(err); }
});

/**
 * GET /wireless/link-planning
 * List saved link planning calculator runs.
 */
router.get('/link-planning', requirePermission('link_planning.view'), async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await wirelessService.listCalcs(
      req.orgId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * POST /wireless/link-planning
 * Save a new link planning calculator run (computes results automatically).
 */
router.post('/link-planning', requirePermission('link_planning.create'), async (req, res, next) => {
  try {
    const record = await wirelessService.saveCalc(req.body, req.orgId);
    res.status(201).json({ data: record });
  } catch (err) { next(err); }
});

/**
 * GET /wireless/link-planning/:id
 */
router.get('/link-planning/:id', requirePermission('link_planning.view'), async (req, res, next) => {
  try {
    const record = await wirelessService.getCalc(req.params.id, req.orgId);
    if (!record) return res.status(404).json({ error: 'Link planning calc not found' });
    res.json({ data: record });
  } catch (err) { next(err); }
});

/**
 * PUT /wireless/link-planning/:id
 */
router.put('/link-planning/:id', requirePermission('link_planning.update'), async (req, res, next) => {
  try {
    const record = await wirelessService.updateCalc(req.params.id, req.orgId, req.body);
    res.json({ data: record });
  } catch (err) { next(err); }
});

/**
 * DELETE /wireless/link-planning/:id
 */
router.delete('/link-planning/:id', requirePermission('link_planning.delete'), async (req, res, next) => {
  try {
    await wirelessService.deleteCalc(req.params.id, req.orgId);
    res.status(204).send();
  } catch (err) { next(err); }
});

// =============================================================================
// §9.2 PTP Link Metrics
// =============================================================================

/**
 * GET /wireless/network-links/:id/ptp-metrics
 * Returns PTP link signal/modulation/throughput data + client session history.
 * Optional ?hours= query parameter (default 24).
 */
router.get('/network-links/:id/ptp-metrics', requirePermission('ptp_links.view'), async (req, res, next) => {
  try {
    const hours = req.query.hours ? parseInt(req.query.hours, 10) : 24;
    const result = await wirelessService.getPtpLinkMetrics(req.params.id, req.orgId, hours);
    if (!result) return res.status(404).json({ error: 'Network link not found' });
    res.json({ data: result });
  } catch (err) { next(err); }
});

// =============================================================================
// §9.3 RF Metrics — Signal Distribution
// =============================================================================

/**
 * GET /wireless/clients/signal-distribution
 * Returns signal strength histogram bucketed in 10 dBm ranges.
 * Optional ?device_id= and ?hours= query parameters.
 */
router.get('/clients/signal-distribution', requirePermission('rf_metrics.view'), async (req, res, next) => {
  try {
    const { device_id: deviceId, hours } = req.query;
    const result = await wirelessService.getSignalDistribution(
      deviceId || null,
      req.orgId,
      hours ? parseInt(hours, 10) : 24,
    );
    res.json({ data: result });
  } catch (err) { next(err); }
});

// =============================================================================
// §9.3 Spectrum Scans
// =============================================================================

/**
 * GET /wireless/spectrum-scans
 * List spectrum scan results. Optional ?device_id=, ?status=, ?page=, ?limit=.
 */
router.get('/spectrum-scans', requirePermission('spectrum_scans.view'), async (req, res, next) => {
  try {
    const { device_id: deviceId, status, page, limit } = req.query;
    const result = await wirelessService.listSpectrumScans(req.orgId, {
      deviceId,
      status,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * POST /wireless/spectrum-scans
 * Create a new spectrum scan record (hardware scan is stubbed).
 */
router.post('/spectrum-scans', requirePermission('spectrum_scans.create'), async (req, res, next) => {
  try {
    if (!req.body.device_id) {
      return res.status(400).json({ error: 'device_id is required' });
    }
    if (!req.body.frequency_start_mhz || !req.body.frequency_end_mhz) {
      return res.status(400).json({ error: 'frequency_start_mhz and frequency_end_mhz are required' });
    }
    const record = await wirelessService.createSpectrumScan(req.body, req.orgId);
    res.status(201).json({ data: record });
  } catch (err) { next(err); }
});

/**
 * GET /wireless/spectrum-scans/:id
 */
router.get('/spectrum-scans/:id', requirePermission('spectrum_scans.view'), async (req, res, next) => {
  try {
    const record = await wirelessService.getSpectrumScan(req.params.id, req.orgId);
    if (!record) return res.status(404).json({ error: 'Spectrum scan not found' });
    res.json({ data: record });
  } catch (err) { next(err); }
});

module.exports = router;
