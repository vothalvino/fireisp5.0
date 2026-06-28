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
const { createNas, updateNas, seedNas, confirmWgRoutes } = require('../middleware/schemas/nas');
const { httpCache } = require('../middleware/httpCache');
const { encrypt } = require('../utils/encryption');
const { ValidationError } = require('../utils/errors');
const routerProvisioningService = require('../services/routerProvisioningService');
const wgProvisioningService = require('../services/wgProvisioningService');
const config = require('../config');
const db = require('../config/database');

const router = Router();

// Never expose the encrypted API password in any response body.
function redactNas(row) {
  if (!row || typeof row !== 'object') return row;
  const rest = { ...row };
  delete rest.api_password_encrypted;
  return rest;
}

// Never expose the NAS WireGuard private key in any response body.
function redactTunnel(row) {
  if (!row || typeof row !== 'object') return row;
  const rest = { ...row };
  delete rest.nas_private_key_encrypted;
  return rest;
}

// Map a RouterOS provisioning error to an HTTP response. Misconfiguration the
// operator must fix — input validation or rejected credentials — is a 422; an
// unreachable / mid-operation-dropped router is a 502. Shared by the
// test-connection and seed routes so the classification can't drift between them.
function sendRouterError(res, next, e) {
  if (e instanceof ValidationError || e.statusCode === 422) return next(e);
  if (e.routerAuthFailed) {
    return res.status(422).json({ error: { code: 'ROUTER_AUTH_FAILED', message: e.message } });
  }
  return res.status(502).json({ error: { code: 'ROUTER_UNREACHABLE', message: e.message } });
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

const ctrl = crudController(Nas, {
  cacheResource: 'nas',
  serialize: redactNas,
  // Re-adding a NAS on an IP that was soft-deleted restores the archived row
  // (keeps id/history) instead of orphaning it — see Nas.createOrRestore.
  createImpl: (data) => Nas.createOrRestore(data),
  // Auto-provision the WireGuard tunnel record when the hub is enabled.
  // The hook is advisory — failure is caught by crudController and logged,
  // never surfaced to the caller. When WG_SERVER_ENABLED=false this is a no-op.
  afterCreate: (nas) => config.wireguard.serverEnabled && wgProvisioningService.provisionDesiredState(nas),
  // Tear down the NAS's WireGuard tunnel on delete (remove hub peer + routes,
  // soft-delete the tunnel row, drop its subnets from affected users' scope).
  // Advisory — failure is caught + logged, never fails the delete.
  afterDelete: (nas) => wgProvisioningService.teardownNas(nas.id),
  // Inverse of afterDelete: revive the torn-down tunnel (same keypair) when the
  // NAS is restored, so delete→restore brings the site tunnel back. Advisory.
  afterRestore: (nas) => wgProvisioningService.restoreNas(nas.id),
});

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
      // Misconfiguration (no API username) → 422; bad credentials → 422;
      // unreachable router → 502 (see sendRouterError).
      return sendRouterError(res, next, e);
    }
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// RouterOS direct-provisioning — one-click "Seed": configure RADIUS client,
// PPP AAA, CoA incoming, and (optionally) a global queue-tree skeleton +
// suspended-subscriber walled garden. Idempotent and non-destructive.
// =============================================================================

router.post('/:id/seed', requirePermission('devices.update'), validate(seedNas), async (req, res, next) => {
  try {
    const nas = await Nas.findByIdOrFail(req.params.id, req.orgId);
    try {
      const result = await routerProvisioningService.seedDevice(nas, req.body);
      // If EVERY step failed (e.g. the API user can authenticate but lacks the
      // write/policy permission to configure anything), the bootstrap did not
      // happen — surface a 502 so callers keying on HTTP status don't read a
      // green 200, while still returning the per-step report for diagnosis. A
      // partial success (some steps applied) stays 200 (multi-status).
      if (result.steps.length && result.steps.every((s) => s.status === 'error')) {
        return res.status(502).json({
          error: { code: 'ROUTER_SEED_FAILED', message: 'All seed steps failed', steps: result.steps },
        });
      }
      res.json({ data: result });
    } catch (e) {
      // Bad request bodies are already rejected by validate(seedNas) above. Here:
      // missing API username / RADIUS secret → 422; rejected credentials → 422;
      // unreachable router → 502 (see sendRouterError).
      return sendRouterError(res, next, e);
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

// =============================================================================
// WireGuard per-NAS tunnel orchestration
// =============================================================================
// All four routes require an active NAS record (Nas.findByIdOrFail) and share
// the sendRouterError error classifier from the provisioning routes above.
// redactTunnel strips nas_private_key_encrypted from every response.
//
// POST /:id/wg/bootstrap  — push WG config to router (or return snippet)
// POST /:id/wg/discover   — read connected subnets from router (read-only)
// PUT  /:id/wg/routes     — confirm + store routed CIDRs, re-sync peer
// GET  /:id/wg            — fetch tunnel state (redacted)
// =============================================================================

router.get('/:id/wg', requirePermission('devices.view'), async (req, res, next) => {
  try {
    // Ensure the NAS exists and is org-scoped before revealing tunnel data
    await Nas.findByIdOrFail(req.params.id, req.orgId);
    const [rows] = await db.query(
      'SELECT * FROM nas_wg_tunnels WHERE nas_id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id],
    );
    const tunnel = rows[0] || null;
    res.json({ data: tunnel ? redactTunnel(tunnel) : null });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/wg/bootstrap', requirePermission('devices.update'), async (req, res, next) => {
  try {
    const nas = await Nas.findByIdOrFail(req.params.id, req.orgId);
    try {
      const result = await wgProvisioningService.bootstrap(nas);
      // Redact private key from tunnel snapshot before sending
      if (result.tunnel) result.tunnel = redactTunnel(result.tunnel);
      // Bootstrap always returns HTTP 200 — both 'api' and 'snippet' outcomes
      // are successful (snippet means the operator pastes the config manually).
      res.json({ data: result });
    } catch (e) {
      return sendRouterError(res, next, e);
    }
  } catch (err) {
    next(err);
  }
});

router.post('/:id/wg/discover', requirePermission('devices.update'), async (req, res, next) => {
  try {
    const nas = await Nas.findByIdOrFail(req.params.id, req.orgId);
    try {
      const result = await wgProvisioningService.discoverSubnets(nas);
      res.json({ data: result });
    } catch (e) {
      return sendRouterError(res, next, e);
    }
  } catch (err) {
    next(err);
  }
});

router.put('/:id/wg/routes', requirePermission('devices.update'), validate(confirmWgRoutes), async (req, res, next) => {
  try {
    const nas = await Nas.findByIdOrFail(req.params.id, req.orgId);
    try {
      const result = await wgProvisioningService.confirmRoutes(nas, req.body);
      if (result.tunnel) result.tunnel = redactTunnel(result.tunnel);
      res.json({ data: result });
    } catch (e) {
      return sendRouterError(res, next, e);
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
