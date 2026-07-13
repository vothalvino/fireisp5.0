// =============================================================================
// FireISP 5.0 — Discovery Scan Routes  §6.1
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { crudController } = require('../controllers/crudController');
const DiscoveryScan = require('../models/DiscoveryScan');
const Device = require('../models/Device');
const { createDiscoveryScan, updateDiscoveryScan } = require('../middleware/schemas/discoveryScans');
const { encrypt } = require('../utils/encryption');
const db = require('../config/database');
const { assertDeviceClientFk } = require('../services/deviceAuthz');
const { redactDevice } = require('../utils/deviceSanitize');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// Never expose encrypted SNMPv3 credentials in any response body. Same
// vulnerability class as src/routes/paymentGateways.js's redact — see
// src/utils/deviceSanitize.js's redactDevice for the analogous devices.js
// columns. discovery_scans has its own copy of the same two columns (an
// operator-entered SNMPv3 key to probe the scanned CIDR range with).
function redactDiscoveryScan(row) {
  if (!row || typeof row !== 'object') return row;
  const rest = { ...row };
  const hasAuthKey = Boolean(rest.snmp_v3_auth_key_encrypted);
  const hasPrivKey = Boolean(rest.snmp_v3_priv_key_encrypted);
  delete rest.snmp_v3_auth_key_encrypted;
  delete rest.snmp_v3_priv_key_encrypted;
  return { ...rest, has_snmp_v3_auth_key: hasAuthKey, has_snmp_v3_priv_key: hasPrivKey };
}

const ctrl = crudController(DiscoveryScan, { serialize: redactDiscoveryScan });

// Middleware to encrypt SNMPv3 keys before create/update
function encryptV3Keys(req, _res, next) {
  if (req.body.snmp_v3_auth_key !== undefined) {
    req.body.snmp_v3_auth_key_encrypted = req.body.snmp_v3_auth_key ? encrypt(req.body.snmp_v3_auth_key) : null;
    delete req.body.snmp_v3_auth_key;
  }
  if (req.body.snmp_v3_priv_key !== undefined) {
    req.body.snmp_v3_priv_key_encrypted = req.body.snmp_v3_priv_key ? encrypt(req.body.snmp_v3_priv_key) : null;
    delete req.body.snmp_v3_priv_key;
  }
  next();
}

router.get('/',    requirePermission('discovery_scans.view'),   ctrl.list);
router.get('/:id', requirePermission('discovery_scans.view'),   ctrl.get);
router.post('/',   requirePermission('discovery_scans.create'), validate(createDiscoveryScan), encryptV3Keys, async (req, res, next) => {
  try {
    req.body.organization_id = req.orgId;
    req.body.created_by = req.user.id;
    req.body.status = 'pending';
    // Ensure cidr_ranges is stored as JSON string if it's an array
    if (Array.isArray(req.body.cidr_ranges)) {
      req.body.cidr_ranges = JSON.stringify(req.body.cidr_ranges);
    }
    const created = await DiscoveryScan.create(req.body);
    res.status(201).json({ data: redactDiscoveryScan(created) });
  } catch (err) { next(err); }
});
router.put('/:id',  requirePermission('discovery_scans.update'), validate(updateDiscoveryScan), encryptV3Keys, ctrl.update);
router.delete('/:id', requirePermission('discovery_scans.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('discovery_scans.update'), ctrl.restore);

// GET /:id/results — list discovery results for a scan
router.get('/:id/results', requirePermission('discovery_scans.view'), async (req, res, next) => {
  try {
    const results = await DiscoveryScan.getResults(req.params.id, req.orgId);
    res.json({ data: results });
  } catch (err) { next(err); }
});

// POST /:id/results/:resultId/onboard — create a Device from a discovery result
router.post('/:id/results/:resultId/onboard', requirePermission('discovery_scans.update'), async (req, res, next) => {
  try {
    const [resultRows] = await db.query(
      'SELECT * FROM discovery_results WHERE id = ? AND scan_id = ? AND organization_id = ?',
      [req.params.resultId, req.params.id, req.orgId],
    );
    if (!resultRows.length) {
      return res.status(404).json({ error: { message: 'Discovery result not found' } });
    }
    const result = resultRows[0];
    if (result.status === 'onboarded') {
      return res.status(409).json({ error: { message: 'Already onboarded' } });
    }

    // Create device from discovery data. req.body is spread BEFORE the
    // server-authoritative organization_id so a caller-supplied
    // organization_id in the request body can never win (the old field
    // order — organization_id first, ...req.body last — let a spread
    // organization_id silently override the caller's own org: a
    // pre-existing cross-tenant hole, fixed here). client_id is now a
    // settable Device field (see src/models/Device.js), so it needs the
    // same cross-tenant FK guard /devices itself uses — otherwise this
    // onboard endpoint would bypass it entirely via Device.create.
    const deviceData = {
      name: result.hostname || result.ip_address,
      ip_address: result.ip_address,
      manufacturer: result.manufacturer,
      model: result.model,
      type: result.device_type || 'other',
      category: 'pop',
      snmp_enabled: true,
      snmp_version: result.snmp_version === 1 ? 'v1' : result.snmp_version === 3 ? 'v3' : 'v2c',
      snmp_profile_id: result.suggested_profile_id || null,
      status: 'offline',
      ...req.body, // allow caller to override suggested defaults
      organization_id: req.orgId, // server-authoritative — must win over any spread value
    };
    await assertDeviceClientFk(deviceData, req.orgId);
    const device = await Device.create(deviceData);

    // Mark result as onboarded
    await db.query(
      'UPDATE discovery_results SET status = ?, device_id = ? WHERE id = ?',
      ['onboarded', device.id, result.id],
    );

    res.status(201).json({ data: redactDevice(device) });
  } catch (err) { next(err); }
});

// POST /:id/results/:resultId/ignore — mark result as ignored
router.post('/:id/results/:resultId/ignore', requirePermission('discovery_scans.update'), async (req, res, next) => {
  try {
    const [result] = await db.query(
      'UPDATE discovery_results SET status = ? WHERE id = ? AND scan_id = ? AND organization_id = ?',
      ['ignored', req.params.resultId, req.params.id, req.orgId],
    );
    if (!result.affectedRows) {
      return res.status(404).json({ error: { message: 'Discovery result not found' } });
    }
    res.json({ data: { ignored: true } });
  } catch (err) { next(err); }
});

module.exports = router;
