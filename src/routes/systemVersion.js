// =============================================================================
// FireISP 5.0 — System Version / Update Availability
// =============================================================================
// GET /api/v1/system/version — what this instance is running, and (only when
// the operator has opted in) whether a newer commit exists upstream.
//
// INSTALL OPERATOR ONLY. Gated on the legacy users.role = 'admin' rather than a
// permission slug, because the audience is a property of the INSTALL, not of a
// tenant. FireISP is multi-tenant: a reseller's org-admin has no shell on the
// box and cannot upgrade it, so showing them "a newer version is available" is
// noise they can never act on — and it tells a tenant how often their provider
// ships. A permission slug would be the wrong tool; every org's admin would end
// up holding it.
//
// POST /api/v1/system/deploy — ask the host to redeploy.
// GET  /api/v1/system/deploy — the newest request, and whether the host agent
//                              is alive to service it.
//
// THE APP HAS NO PRIVILEGE HERE AND MUST NOT ACQUIRE ANY. POST inserts a row.
// That is all it does. A systemd timer running as root OUTSIDE the container
// (deploy-agent.sh) claims that row and runs redeploy.sh with no arguments.
//
// The obvious implementation — mounting the Docker socket into this container —
// is root on the host, so any RCE here would own the machine rather than the
// app. It was refused for the TLS renew button and is refused here.
//
// The request carries NO TARGET on purpose: a commit or image column would give
// a compromised app an arbitrary-image-deploy primitive, which is most of what
// the socket would have given away. Worst case with the app fully compromised
// is "trigger a redeploy of the signed image that was going to be deployed
// anyway".
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const updateCheck = require('../services/updateCheck');
const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'routes/systemVersion' });

// How long after its last poll the host agent is presumed gone. The timer runs
// every 30s, so this tolerates a couple of missed polls without flapping while
// still catching "never installed" immediately.
const AGENT_STALE_SECONDS = 180;

const router = Router();

router.use(authenticate);

/**
 * 404, not 403. A tenant admin has no business learning that this endpoint
 * exists, and 403 would confirm it — the same reasoning as the contract guard
 * in routes/ai.js.
 */
function installOperatorOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  }
  next();
}

router.get('/version', installOperatorOnly, async (req, res, next) => {
  try {
    res.json({ data: await updateCheck.getStatus() });
  } catch (err) { next(err); }
});

/**
 * Newest request plus agent liveness.
 *
 * agent_alive is what stops this being a stub that fakes success: on an install
 * whose operator never set up the systemd units, a queued request would sit at
 * 'pending' forever and be indistinguishable from a slow deploy. The UI refuses
 * to offer the button when this is false.
 */
async function readDeployState() {
  const [[latest]] = await db.query(
    `SELECT id, requested_by, requested_at, status, started_at, finished_at,
            exit_code, output_tail
       FROM deploy_requests
      ORDER BY id DESC
      LIMIT 1`,
  );
  const [[agent]] = await db.query(
    `SELECT last_seen_at, agent_version, hostname,
            (last_seen_at > NOW() - INTERVAL ? SECOND) AS alive
       FROM deploy_agent_status WHERE id = 1`,
    [AGENT_STALE_SECONDS],
  );
  return {
    request: latest || null,
    agent_alive: Boolean(agent && Number(agent.alive)),
    agent_last_seen_at: agent ? agent.last_seen_at : null,
    agent_hostname: agent ? agent.hostname : null,
  };
}

router.get('/deploy', installOperatorOnly, async (req, res, next) => {
  try {
    res.json({ data: await readDeployState() });
  } catch (err) { next(err); }
});

router.post('/deploy', installOperatorOnly, async (req, res, next) => {
  try {
    const state = await readDeployState();

    // Refuse rather than queue when nothing will service it. Accepting here
    // would produce a request that sits 'pending' forever while the UI implies
    // work is happening — the failure mode this whole design exists to avoid.
    if (!state.agent_alive) {
      return res.status(503).json({
        error: {
          code: 'DEPLOY_AGENT_UNAVAILABLE',
          message: 'No deploy agent has checked in. Install the systemd timer on the host, or deploy from the CLI with `sudo redeploy`.',
        },
      });
    }

    // One at a time. Two concurrent redeploys on one host is not a state worth
    // supporting, and the agent claims rows one at a time anyway.
    if (state.request && ['pending', 'running'].includes(state.request.status)) {
      return res.status(409).json({
        error: { code: 'DEPLOY_IN_PROGRESS', message: 'A deploy is already queued or running.' },
      });
    }

    // The entire privileged surface of this feature: one INSERT, no parameters
    // that influence what the host will run.
    const [result] = await db.query(
      'INSERT INTO deploy_requests (requested_by, status) VALUES (?, \'pending\')',
      [req.user.id],
    );
    logger.info({ requestId: result.insertId, userId: req.user.id }, 'Deploy requested from the GUI');

    res.status(202).json({ data: { id: result.insertId, status: 'pending' } });
  } catch (err) { next(err); }
});

module.exports = router;
