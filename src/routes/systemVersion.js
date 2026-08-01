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
// This deliberately does NOT deploy anything. It is read-only and needs no
// privilege on the host — which is why it can ship independently of any
// "update now" button, whose only safe implementations require authority the
// application container must not have.
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const updateCheck = require('../services/updateCheck');

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

module.exports = router;
