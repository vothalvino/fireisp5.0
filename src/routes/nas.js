// =============================================================================
// FireISP 5.0 — NAS Routes
// =============================================================================

const { Router } = require('express');
const Nas = require('../models/Nas');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createNas, updateNas } = require('../middleware/schemas/nas');
const { httpCache } = require('../middleware/httpCache');
const { encrypt } = require('../utils/encryption');
const { ValidationError } = require('../utils/errors');
const routerProvisioningService = require('../services/routerProvisioningService');
const db = require('../config/database');

const router = Router();

// Never expose the encrypted API password in any response body.
function redactNas(row) {
  if (!row || typeof row !== 'object') return row;
  const rest = { ...row };
  delete rest.api_password_encrypted;
  return rest;
}

// After validation, fold a plaintext `api_password` into the encrypted column
// and drop the plaintext so it is never persisted/returned verbatim.
function encryptApiPassword(req, _res, next) {
  // api_password_encrypted may ONLY be written via encrypt() below — never accepted
  // directly from the client (which would let a raw plaintext bypass encryption).
  if (req.body) delete req.body.api_password_encrypted;
  if (typeof req.body?.api_password === 'string' && req.body.api_password.length) {
    req.body.api_password_encrypted = encrypt(req.body.api_password);
  }
  delete req.body?.api_password;
  next();
}

const ctrl = crudController(Nas, { cacheResource: 'nas', serialize: redactNas });

router.use(authenticate);
router.use(orgScope);

router.get('/', requirePermission('devices.view'), httpCache('nas', 300), ctrl.list);
router.get('/:id', requirePermission('devices.view'), ctrl.get);
router.post('/', requirePermission('devices.create'), validate(createNas), encryptApiPassword, ctrl.create);
router.put('/:id', requirePermission('devices.update'), validate(updateNas), encryptApiPassword, ctrl.update);
router.delete('/:id', requirePermission('devices.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('devices.update'), ctrl.restore);

// =============================================================================
// RouterOS direct-provisioning — test API connectivity to a NAS
// =============================================================================

router.post('/:id/test-connection', requirePermission('devices.update'), async (req, res, next) => {
  try {
    const nas = await Nas.findByIdOrFail(req.params.id, req.orgId);
    try {
      res.json({ data: await routerProvisioningService.testConnection(nas) });
    } catch (e) {
      // Misconfiguration (e.g. no API username) is a 422, not "router unreachable".
      if (e instanceof ValidationError || e.statusCode === 422) return next(e);
      res.status(502).json({ error: { code: 'ROUTER_UNREACHABLE', message: e.message } });
    }
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// NAS Health (item: health check results and manual trigger)
// =============================================================================

router.get('/:id/health', requirePermission('nas.health'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, ip_address, health_status, last_health_check_at FROM nas WHERE id = ? AND organization_id = ?',
      [req.params.id, req.orgId],
    );
    if (!rows.length) return res.status(404).json({ error: 'NAS not found' });
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/health-check', requirePermission('nas.health'), async (req, res, next) => {
  try {
    const { runHealthChecks } = require('../services/nasHealthService');
    const result = await runHealthChecks(req.orgId);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
