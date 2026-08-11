// =============================================================================
// FireISP 5.0 — RADIUS Routes
// =============================================================================

const { Router } = require('express');
const Radius = require('../models/Radius');
const Nas = require('../models/Nas');
const routerProvisioningService = require('../services/routerProvisioningService');
const { ValidationError } = require('../utils/errors');
const { crudController } = require('../controllers/crudController');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { createRadius, updateRadius, disconnectRadius } = require('../middleware/schemas/radius');
const {
  disconnectSession,
  syncFreeradiusTables,
  kickDuplicateSessions,
} = require('../services/radiusService');
const { createRoute, updateWalledGarden } = require('../middleware/schemas/radius');
const db = require('../config/database');
const { exportCdr, listMacMoveEvents } = require('../services/radiusAccountingService');
const { sendRadiusPacket } = require('../services/suspensionService');
const radiusServerService = require('../services/radiusServerService');
const auditLog = require('../services/auditLog');

const router = Router();
// Strip the cleartext PPPoE `password` column from list/get responses.
// Full-credential access is gated separately by `radius.credentials.view`
// (see the /contract/:contractId/credentials and /:id/credentials routes
// below) so a role like `support` can get credentials without also gaining
// `devices.view`'s broader device-management surface.
const ctrl = crudController(Radius, { serialize: Radius.sanitize });

router.use(authenticate);
router.use(orgScope);

// -----------------------------------------------------------------------------
// Embedded RADIUS server status (auth/accounting counters, ports, running state).
// Literal path — registered before the generic `/:id` CRUD route.
// -----------------------------------------------------------------------------
router.get('/server-status', requirePermission('devices.view'), (_req, res) => {
  res.json({ data: radiusServerService.getStatus() });
});

// -----------------------------------------------------------------------------
// MAC Move Events (item 21)
// -----------------------------------------------------------------------------
// NOTE: this literal-path route MUST be registered before the generic `/:id`
// CRUD route below, otherwise Express matches `/mac-move-events` as `/:id`
// (id = "mac-move-events"), findByIdOrFail fails, and the request 404s.
router.get('/mac-move-events', requirePermission('radius.mac_move_events.view'), async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));

    const result = await listMacMoveEvents(req.orgId, { page, limit });
    res.json({
      data: result.rows,
      meta: { total: result.total, page: result.page, limit: result.limit },
    });
  } catch (err) {
    next(err);
  }
});

// Get RADIUS accounts for a specific contract. Password-free — see the
// /credentials sibling below for the full row. Accepts EITHER devices.view
// OR radius.credentials.view (requirePermission ORs multiple slugs — "any
// one match = OK") so a role that only holds radius.credentials.view (e.g.
// `support`, which has never held devices.view — see migration 383) can
// still reach the base account view; the frontend's split-fetch UX depends
// on this base fetch succeeding before it ever attempts the credentials
// fetch, otherwise a support/super_admin/noc_operator user's PPPoE tab dies
// on the base fetch and never gets a chance to show the password. This
// route's response stays password-free either way — Radius.findByContract
// never selects the `password` column, regardless of which permission
// unlocked the request.
router.get('/contract/:contractId', requirePermission('devices.view', 'radius.credentials.view'), async (req, res, next) => {
  try {
    const accounts = await Radius.findByContract(req.params.contractId, req.orgId);
    res.json({ data: accounts });
  } catch (err) {
    next(err);
  }
});

// Get RADIUS accounts (incl. cleartext password) for a specific contract.
// Gated by radius.credentials.view — see migration 383 for the grant matrix.
// Registered directly after its base-route sibling and BEFORE the generic
// `/:id` CRUD block (radius.js:436-441 documents why literal paths must
// precede `/:id`).
router.get('/contract/:contractId/credentials', requirePermission('radius.credentials.view'), async (req, res, next) => {
  try {
    const accounts = await Radius.findByContractCredentials(req.params.contractId, req.orgId);
    res.json({ data: accounts });
  } catch (err) {
    next(err);
  }
});

// Get a single RADIUS account by id, including cleartext password. Gated by
// radius.credentials.view — see migration 383 for the grant matrix.
router.get('/:id/credentials', requirePermission('radius.credentials.view'), async (req, res, next) => {
  try {
    const account = await Radius.findCredentialsById(req.params.id, req.orgId);
    if (!account) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'RADIUS account not found' } });
    }
    res.json({ data: account });
  } catch (err) {
    next(err);
  }
});

// Manually trigger FreeRADIUS SQL table sync for this org
router.post('/sync-freeradius', requirePermission('radius.sync'), async (req, res, next) => {
  try {
    const result = await syncFreeradiusTables(req.orgId);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// Disconnect a subscriber's active PPPoE session via RADIUS Disconnect-Request.
// With an optional body { acct_session_id, nas_ip_address } the kill is
// narrowed to that ONE session; an empty body disconnects EVERY session of
// the account on every NAS (the historical contract, kept for scripts).
router.post('/:id/disconnect', requirePermission('devices.update'), validate(disconnectRadius), async (req, res, next) => {
  try {
    // SAME TENANCY ANCHOR AS THE BATCH ROUTE BELOW. This lookup had no
    // organisation filter and never touched req.orgId, so any id resolved —
    // and radius ids are sequential and enumerable. `devices.update` is granted
    // to admin AND technician (migration 119), so a technician at one reseller
    // could drop another reseller's subscriber with a single POST.
    //
    // Also adds the deleted_at filter: a soft-deleted account should not be a
    // live disconnect target.
    const [rows] = await db.query(
      `SELECT r.contract_id
         FROM radius r
         JOIN contracts c ON c.id = r.contract_id
        WHERE r.id = ? AND r.deleted_at IS NULL
          AND (? IS NULL OR c.organization_id = ?)`,
      [req.params.id, req.orgId ?? null, req.orgId ?? null],
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'RADIUS account not found' });
    }
    const contractId = rows[0].contract_id;

    // Per-session targeting: resolve the DB-canonical session anchored on
    // THIS contract, never trusting the request strings — the caller-supplied
    // pair is only a lookup key. This (a) keeps the Acct-Session-Id sent to
    // the NAS canonical (the PAD SPACE collation matches 'abc   ' to the
    // stored 'abc', and sending the padded value would NAK), and (b) refuses
    // to fall back to a contract-wide kill when the targeted session no
    // longer exists — killing every session because one already stopped is
    // exactly the surprise this option exists to prevent.
    const { acct_session_id: acctSessionId, nas_ip_address: nasIpAddress } = req.body || {};
    // A lone nas_ip_address would silently widen to a contract-wide kill on
    // EVERY NAS (the opposite of what the caller asked for) — refuse it.
    if (nasIpAddress && !acctSessionId) {
      return res.status(400).json({ error: 'nas_ip_address requires acct_session_id' });
    }
    let opts;
    if (acctSessionId) {
      // Same shape as the batch route: all DISTINCT NAS rows for this
      // session, so a same-contract cross-NAS id collision is DETECTED
      // (refused) rather than resolved by row order, and a session recorded
      // both with and without a NAS IP coalesces to the non-null one.
      const [sessionRows] = await db.query(
        `SELECT DISTINCT cl.session_id, cl.nas_ip_address
           FROM connection_logs cl
          WHERE cl.contract_id = ? AND cl.session_id = ?
            AND (? IS NULL OR cl.nas_ip_address = ?)
            AND cl.event_type IN ('start', 'interim-update')
            AND NOT EXISTS (
              SELECT 1 FROM connection_logs cl2
              WHERE cl2.session_id = cl.session_id
                AND cl2.contract_id = cl.contract_id
                AND cl2.event_type = 'stop'
            )
          LIMIT 25`,
        [contractId, acctSessionId, nasIpAddress ?? null, nasIpAddress ?? null],
      );
      if (!sessionRows.length) {
        return res.status(404).json({ error: 'Session not found or already stopped' });
      }
      const nasIps = new Set(sessionRows.map((r) => r.nas_ip_address).filter((ip) => ip !== null));
      if (nasIps.size > 1) {
        return res.status(409).json({ error: 'Ambiguous session id — active on multiple NASes; retry with nas_ip_address' });
      }
      opts = {
        acctSessionId: sessionRows[0].session_id,
        nasIpAddress: nasIps.size > 0 ? [...nasIps][0] : null,
      };
    }

    const result = opts ? await disconnectSession(contractId, opts) : await disconnectSession(contractId);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Direct RouterOS provisioning — push a subscriber (PPPoE secret) to its NAS
// =============================================================================
// Placed with the other `/:id/...` item routes (above the generic `/:id` CRUD
// block) so it stays tidy alongside `/:id/disconnect` and `/:id/routes`.
router.post('/:id/push', requirePermission('radius.sync'), async (req, res, next) => {
  try {
    const radius = await Radius.findByIdOrFail(req.params.id, req.orgId);

    if (!radius.nas_id) {
      return res.status(422).json({ error: { code: 'NO_NAS', message: 'Subscriber has no NAS assigned' } });
    }

    let contract = null;
    if (radius.contract_id !== null && radius.contract_id !== undefined) {
      const [contractRows] = await db.query(
        `SELECT c.status, c.connection_type, c.test_window_cleanup_pending,
                (c.test_window_expires_at IS NOT NULL
                 AND c.test_window_expires_at > NOW()) AS test_window_open
           FROM contracts c
          WHERE c.id = ? AND c.deleted_at IS NULL
            AND (? IS NULL OR c.organization_id = ? OR c.organization_id IS NULL)`,
        [radius.contract_id, req.orgId ?? null, req.orgId ?? null],
      );
      contract = contractRows[0];
      if (!contract) {
        return res.status(422).json({
          error: { code: 'CONTRACT_NOT_PROVISIONABLE', message: 'Subscriber contract is unavailable' },
        });
      }
    }

    const nas = await Nas.findByIdOrFail(radius.nas_id, req.orgId);

    if (contract?.status === 'pending') {
      const validWindow = Number(contract.test_window_open) === 1
        && Number(contract.test_window_cleanup_pending) === 0
        && radius.status === 'active'
        && ['pppoe', 'pppoe_dual'].includes(contract.connection_type);
      if (!validWindow) {
        return res.status(422).json({
          error: {
            code: 'TEST_WINDOW_NOT_OPEN',
            message: 'Pending subscribers may only authenticate during an open bounded test window',
          },
        });
      }

      // /ppp secret has no safe per-secret expiry. Pending commissioning uses
      // standard RADIUS Expiration + Session-Timeout, and this endpoint ensures
      // an old local secret cannot bypass those bounds.
      try {
        const removed = await routerProvisioningService.removeSubscriber(nas, {
          username: radius.username,
        });
        return res.json({
          data: {
            mode: 'bounded_radius',
            local_secret_disabled: true,
            created: false,
            updated: false,
            ...removed,
          },
        });
      } catch (e) {
        if (e instanceof ValidationError || e.statusCode === 422) return next(e);
        return res.status(502).json({ error: { code: 'ROUTER_UNREACHABLE', message: e.message } });
      }
    }

    if ((contract && contract.status !== 'active') || radius.status !== 'active') {
      return res.status(422).json({
        error: {
          code: 'CONTRACT_NOT_ACTIVE',
          message: 'A local RouterOS subscriber secret may only be created for active service',
        },
      });
    }

    const sub = {
      username: radius.username,
      password: radius.password,
      profile: radius.profile,
      comment: 'FireISP radius#' + radius.id + ' client#' + radius.client_id + ' contract#' + radius.contract_id,
    };

    try {
      res.json({ data: await routerProvisioningService.pushSubscriber(nas, sub) });
    } catch (e) {
      // Misconfiguration (e.g. NAS missing API username) is a 422, not "unreachable".
      if (e instanceof ValidationError || e.statusCode === 422) return next(e);
      res.status(502).json({ error: { code: 'ROUTER_UNREACHABLE', message: e.message } });
    }
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Per-account route injection CRUD (item 15 — Framed-Route)
// =============================================================================

/**
 * Every handler below took the account id straight from the URL and queried
 * radius_account_routes without an org predicate, on all four verbs:
 *
 *   GET    WHERE radius_account_id = ?                  -> cross-tenant read
 *   POST   INSERT stamped req.orgId but never checked the PARENT account
 *   PUT    WHERE id = ? AND radius_account_id = ?        -> cross-tenant write
 *   DELETE same shape                                    -> cross-tenant delete
 *
 * The write side is the serious half. radiusService consumes these rows at
 * AUTHENTICATION time to emit Framed-Route, so a route injected onto another
 * tenant's account changes where that subscriber's traffic goes — a network
 * effect, not a data one. The POST stamping req.orgId made it worse rather than
 * better: the row looked correctly owned while hanging off someone else's
 * account.
 *
 * Fixed the same way as the CPE parameter mappings: prove the parent belongs to
 * the caller, then scope every query again.
 */
async function requireOwnedRadiusAccount(req, res, next) {
  try {
    // findByIdOrFail with orgId emits the org predicate and 404s otherwise —
    // which is the right answer here, since which account ids exist is exactly
    // what must not be confirmed.
    await Radius.findByIdOrFail(req.params.id, req.orgId);
    next();
  } catch (err) { next(err); }
}

// Admits NULL-org rows so a single-tenant install (where req.orgId is null and
// rows carry no org) still works — the same rule used elsewhere in this repo.
const ROUTE_VISIBLE = '(organization_id = ? OR (? IS NULL AND organization_id IS NULL))';

router.get('/:id/routes', requirePermission('radius_account_routes.view'), requireOwnedRadiusAccount, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM radius_account_routes
        WHERE radius_account_id = ? AND deleted_at IS NULL AND ${ROUTE_VISIBLE}
        ORDER BY id ASC`,
      [req.params.id, req.orgId, req.orgId],
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/routes', requirePermission('radius_account_routes.create'), requireOwnedRadiusAccount, validate(createRoute), async (req, res, next) => {
  try {
    const { destination, gateway, metric } = req.body;
    const [result] = await db.query(
      `INSERT INTO radius_account_routes (radius_account_id, organization_id, destination, gateway, metric)
       VALUES (?, ?, ?, ?, ?)`,
      [req.params.id, req.orgId, destination, gateway ?? null, metric ?? null],
    );
    const [rows] = await db.query('SELECT * FROM radius_account_routes WHERE id = ?', [result.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/routes/:routeId', requirePermission('radius_account_routes.update'), requireOwnedRadiusAccount, validate(createRoute), async (req, res, next) => {
  try {
    const { destination, gateway, metric } = req.body;
    const [result] = await db.query(
      `UPDATE radius_account_routes SET destination=?, gateway=?, metric=?
       WHERE id = ? AND radius_account_id = ? AND deleted_at IS NULL AND ${ROUTE_VISIBLE}`,
      [destination, gateway ?? null, metric ?? null, req.params.routeId, req.params.id, req.orgId, req.orgId],
    );
    // 404 on a miss rather than re-reading by id alone: the old version fetched
    // the row with `WHERE id = ?` afterwards, so a rejected UPDATE still
    // returned another tenant's route as though it had been edited.
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Route not found' });
    const [rows] = await db.query(
      `SELECT * FROM radius_account_routes WHERE id = ? AND ${ROUTE_VISIBLE}`,
      [req.params.routeId, req.orgId, req.orgId],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Route not found' });
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/routes/:routeId', requirePermission('radius_account_routes.delete'), requireOwnedRadiusAccount, async (req, res, next) => {
  try {
    const [result] = await db.query(
      `UPDATE radius_account_routes SET deleted_at = NOW()
        WHERE id = ? AND radius_account_id = ? AND deleted_at IS NULL AND ${ROUTE_VISIBLE}`,
      [req.params.routeId, req.params.id, req.orgId, req.orgId],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Route not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
// =============================================================================
// Walled Garden Settings (item 14)
// =============================================================================

router.get('/walled-garden', requirePermission('walled_garden.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM organization_walled_garden_settings WHERE organization_id = ?',
      [req.orgId],
    );
    res.json({ data: rows[0] || null });
  } catch (err) {
    next(err);
  }
});

router.put('/walled-garden', requirePermission('walled_garden.update'), validate(updateWalledGarden), async (req, res, next) => {
  try {
    const { enabled, redirect_url, address_list_name, allowed_destinations } = req.body;
    await db.query(
      `INSERT INTO organization_walled_garden_settings
           (organization_id, enabled, redirect_url, address_list_name, allowed_destinations)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         enabled = VALUES(enabled),
         redirect_url = VALUES(redirect_url),
         address_list_name = VALUES(address_list_name),
         allowed_destinations = VALUES(allowed_destinations)`,
      [req.orgId, enabled ? 1 : 0, redirect_url ?? null,
        address_list_name ?? 'walled_garden', allowed_destinations ?? null],
    );
    const [rows] = await db.query(
      'SELECT * FROM organization_walled_garden_settings WHERE organization_id = ?',
      [req.orgId],
    );
    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Manual duplicate-session kick (item 11)
// =============================================================================

router.post('/kick-sessions', requirePermission('radius.kick_sessions'), async (req, res, next) => {
  try {
    const result = await kickDuplicateSessions(req.orgId);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// CDR Export (item 20)
// =============================================================================

router.get('/cdr', requirePermission('radius.cdr_export'), async (req, res, next) => {
  try {
    const { from, to, username, format = 'json' } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'Query params "from" and "to" are required (ISO date strings)' });
    }

    const result = await exportCdr({
      from,
      to,
      username: username || null,
      format,
      organizationId: req.orgId,
    });

    await auditLog.log({
      userId: req.user?.id,
      organizationId: req.orgId,
      action: 'export',
      tableName: 'connection_logs',
      recordId: 0,
      newValues: { from, to, username: username || null, format },
    });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=cdr_export.csv');
      return res.send(result.csv);
    }

    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Dynamic CoA (items 24, 25, 26)
// =============================================================================

router.post('/coa', requirePermission('radius.coa'), async (req, res, next) => {
  try {
    const { username, attributes = [] } = req.body;

    if (!username) {
      return res.status(400).json({ error: '"username" is required' });
    }

    const [rows] = await db.query(
      // Scope by the NAS's organization — the radius table has no
      // organization_id column (Radius.hasOrgScope === false).
      `SELECT r.username, r.nas_id, n.ip_address AS nas_ip, n.coa_port, n.secret, n.secondary_nas_id
       FROM radius r
       JOIN nas n ON n.id = r.nas_id
       WHERE r.username = ? AND r.deleted_at IS NULL AND n.organization_id = ?
       LIMIT 1`,
      [username, req.orgId],
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'RADIUS account not found' });
    }

    const nas = rows[0];

    if (!nas.secret) {
      return res.status(422).json({ error: 'NAS RADIUS secret is not configured' });
    }

    // sendRadiusPacket handles User-Name + encoder + authenticator internally
    let result = await sendRadiusPacket(nas.nas_ip, nas.coa_port || 3799, nas.secret, 43, nas.username, attributes);

    // Same failover rule as suspensionService.sendWithFailover: a NAK is an
    // authoritative answer from a live NAS, not a delivery failure.
    if (!result.sent && result.outcome !== 'nak' && nas.secondary_nas_id) {
      const [secRows] = await db.query(
        'SELECT ip_address, coa_port, secret FROM nas WHERE id = ? LIMIT 1',
        [nas.secondary_nas_id],
      );
      if (secRows.length > 0) {
        const sec = secRows[0];
        result = await sendRadiusPacket(sec.ip_address, sec.coa_port || 3799, sec.secret, 43, nas.username, attributes);
      }
    }

    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// Batch force-disconnect (PPPoE Management Phase A)
// =============================================================================

router.post('/sessions/disconnect-batch', requirePermission('radius.batch_disconnect'), async (req, res, next) => {
  try {
    const { acct_session_ids, usernames, sessions } = req.body;

    if (!acct_session_ids && !usernames && !sessions) {
      return res.status(400).json({ error: 'Provide acct_session_ids, sessions or usernames' });
    }
    // Elements must be non-empty strings: session_id is a VARCHAR, and a
    // number here makes MySQL coerce the COLUMN to numeric — discarding the
    // index (a full scan of the largest table per element) and matching
    // unrelated rows ('anything' = 0 is true under numeric coercion).
    if ((acct_session_ids && (!Array.isArray(acct_session_ids)
          || acct_session_ids.some((s) => typeof s !== 'string' || !s)))
        || (usernames && (!Array.isArray(usernames)
          || usernames.some((u) => typeof u !== 'string' || !u)))) {
      return res.status(400).json({ error: 'acct_session_ids and usernames must be arrays of non-empty strings' });
    }

    // `sessions` entries carry the NAS the session lives on. Acct-Session-Id
    // is only unique PER NAS (MikroTik reuses short hex ids, so they collide
    // across routers) — keying on (session_id, nas_ip_address) is the only
    // way to name one session unambiguously. Bare `acct_session_ids` are
    // still accepted, but a colliding id gets an explicit error below rather
    // than the old LIMIT-1-without-ORDER-BY lottery, which could disconnect
    // a DIFFERENT subscriber holding the same id on another NAS.
    const sessionList = sessions || [];
    if (!Array.isArray(sessionList)
        || sessionList.some((s) => !s || typeof s.acct_session_id !== 'string' || !s.acct_session_id
          || (s.nas_ip_address !== undefined && s.nas_ip_address !== null && typeof s.nas_ip_address !== 'string'))) {
      return res.status(400).json({ error: 'Each sessions entry must be { acct_session_id, nas_ip_address? }' });
    }
    const sessionTargets = [
      ...(acct_session_ids || []).map((sessionId) => ({ session_id: sessionId, nas_ip_address: null })),
      ...sessionList.map((s) => ({ session_id: s.acct_session_id, nas_ip_address: s.nas_ip_address ?? null })),
    ];
    const names = usernames || [];
    const totalCount = sessionTargets.length + names.length;

    if (totalCount > 100) {
      return res.status(400).json({ error: 'Maximum 100 sessions per batch' });
    }
    if (totalCount === 0) {
      return res.status(400).json({ error: 'At least one session identifier required' });
    }

    const results = [];

    // Disconnect by session (session_id values in connection_logs, optionally
    // pinned to a NAS). 'interim-update' counts as open too — the embedded
    // accounting path updates the session row in place, so a live session
    // reads 'interim-update' after its first update.
    for (const target of sessionTargets) {
      // JOINED TO contracts SO THE SESSION MUST BELONG TO THE CALLER'S ORG.
      // connection_logs has no organization_id of its own, so the contract is
      // the only tenancy anchor — the same join kickDuplicateSessions uses.
      // Without it, a session_id from another tenant resolved fine and was
      // disconnected, with req.orgId reaching only the audit row.
      //
      // No LIMIT 1: every DISTINCT (contract, NAS) match comes back so a
      // cross-NAS session-id collision is DETECTED instead of resolved by
      // whichever row MySQL happened to return first. (LIMIT 25 is only a
      // defensive cap — the branches below only distinguish 0 / 1 / more
      // than 1 distinct combos, so capping a pathological result set
      // changes nothing.)
      const [rows] = await db.query(
        `SELECT DISTINCT cl.contract_id, cl.nas_ip_address, cl.session_id
           FROM connection_logs cl
           JOIN contracts c ON c.id = cl.contract_id
          WHERE cl.session_id = ? AND cl.event_type IN ('start', 'interim-update')
            AND (? IS NULL OR cl.nas_ip_address = ?)
            AND (? IS NULL OR c.organization_id = ?)
            AND NOT EXISTS (
              SELECT 1 FROM connection_logs cl2
              WHERE cl2.session_id = cl.session_id
                AND cl2.contract_id = cl.contract_id
                AND cl2.event_type = 'stop'
            )
          LIMIT 25`,
        [target.session_id, target.nas_ip_address, target.nas_ip_address, req.orgId ?? null, req.orgId ?? null],
      );
      // Use the DB-canonical session_id, not the raw request string: the PAD
      // SPACE collation matches 'abc   ' to the stored 'abc', and sending the
      // padded request value in the Acct-Session-Id attribute would NAK.
      if (!rows.length || !rows[0].session_id) {
        results.push({ session_id: target.session_id, success: false, error: 'Session not found or already stopped' });
        continue;
      }
      // One real session can surface as two DISTINCT rows when accounting
      // writers disagree about nas_ip_address (one row NULL, one set) — that
      // is not a collision. Distinct CONTRACTS, or two different non-null
      // NAS IPs, are: refuse to guess which session the operator meant.
      const contractIds = new Set(rows.map((r) => r.contract_id));
      const nasIps = new Set(rows.map((r) => r.nas_ip_address).filter((ip) => ip !== null));
      if (contractIds.size > 1 || nasIps.size > 1) {
        results.push({
          session_id: target.session_id,
          success: false,
          error: 'Ambiguous session id — active on multiple NASes; retry with nas_ip_address',
        });
        continue;
      }
      const chosen = {
        contract_id: rows[0].contract_id,
        session_id: rows[0].session_id,
        nas_ip_address: nasIps.size > 0 ? [...nasIps][0] : null,
      };
      try {
        // Target the NAS this session actually lives on and narrow the kill
        // to this one session via Acct-Session-Id.
        const r = await disconnectSession(chosen.contract_id, {
          acctSessionId: chosen.session_id,
          nasIpAddress: chosen.nas_ip_address,
        });
        await auditLog.log({
          userId: req.user.id,
          organizationId: req.orgId,
          action: 'disconnect',
          tableName: 'connection_logs',
          recordId: chosen.contract_id,
          newValues: {
            session_id: chosen.session_id,
            nas_ip_address: chosen.nas_ip_address,
            initiated_by: 'batch_disconnect',
            sent: r.sent,
          },
        });
        if (r.sent) {
          results.push({ session_id: target.session_id, success: true });
        } else {
          results.push({ session_id: target.session_id, success: false, error: r.response });
        }
      } catch (err) {
        results.push({ session_id: target.session_id, success: false, error: err.message });
      }
    }

    // Disconnect by usernames
    for (const username of names) {
      // SAME TENANCY ANCHOR. `radius` does carry organization_id, but it is
      // NULLable (single-tenant installs), so the contract's org is the
      // reliable one and matches how the rest of this service scopes.
      //
      // This branch was the sharper edge of the two: uq_radius_username makes a
      // username unique across the WHOLE INSTALL, so one from another tenant
      // resolved unambiguously to that tenant's contract — and PPPoE usernames
      // are routinely derived from a client number, so they are guessable.
      const [rows] = await db.query(
        `SELECT r.contract_id
           FROM radius r
           JOIN contracts c ON c.id = r.contract_id
          WHERE r.username = ? AND r.deleted_at IS NULL
            AND (? IS NULL OR c.organization_id = ?)
          LIMIT 1`,
        [username, req.orgId ?? null, req.orgId ?? null],
      );
      if (!rows.length) {
        results.push({ username, success: false, error: 'RADIUS account not found' });
        continue;
      }
      try {
        const r = await disconnectSession(rows[0].contract_id);
        await auditLog.log({
          userId: req.user.id,
          organizationId: req.orgId,
          action: 'disconnect',
          tableName: 'radius',
          recordId: rows[0].contract_id,
          newValues: { username, initiated_by: 'batch_disconnect', sent: r.sent },
        });
        if (r.sent) {
          results.push({ username, success: true });
        } else {
          results.push({ username, success: false, error: r.response });
        }
      } catch (err) {
        results.push({ username, success: false, error: err.message });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    res.json({
      data: results,
      meta: { total: results.length, succeeded, failed: results.length - succeeded },
    });
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// Generic CRUD — registered LAST so every literal-path route above
// (/mac-move-events, /walled-garden, /cdr, /contract/:id, /:id/routes, …) is
// matched before the bare `/:id` param route. Otherwise Express would treat
// e.g. GET /walled-garden as `/:id` (id = "walled-garden"), findByIdOrFail
// would fail, and the request would 404.
// -----------------------------------------------------------------------------
// Both accept EITHER devices.view OR radius.credentials.view — same reasoning
// as the /contract/:contractId route above. Responses stay password-free
// regardless (crudController(Radius, { serialize: Radius.sanitize }) above
// strips it unconditionally).
router.get('/', requirePermission('devices.view', 'radius.credentials.view'), ctrl.list);
router.get('/:id', requirePermission('devices.view', 'radius.credentials.view'), ctrl.get);
router.post('/', requirePermission('devices.create'), validate(createRadius), ctrl.create);
router.put('/:id', requirePermission('devices.update'), validate(updateRadius), ctrl.update);
router.delete('/:id', requirePermission('devices.delete'), ctrl.destroy);
router.post('/:id/restore', requirePermission('devices.update'), ctrl.restore);

module.exports = router;
