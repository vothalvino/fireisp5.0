// =============================================================================
// FireISP 5.0 — RADIUS Accounting Ingest Route (machine-to-machine)
// =============================================================================
// FreeRADIUS rest module POST endpoint. No JWT authentication — uses a shared
// secret in the Authorization: Bearer <secret> or X-Radius-Secret header.
//
// Mount in app.js BEFORE the authenticated router:
//   app.use('/radius', require('./routes/radiusAccounting'));
// =============================================================================

const { Router } = require('express');
const { ingestAccounting } = require('../services/radiusAccountingService');
const logger = require('../utils/logger').child({ service: 'radiusAccountingRoute' });

const router = Router();

// ---------------------------------------------------------------------------
// Attribute normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Read a value from req.body by checking both the hyphenated RADIUS attribute
 * name and the camelCase variant that the FreeRADIUS rest module may send.
 *
 * @param {object} body
 * @param {string} hyphenated  - e.g. 'Acct-Status-Type'
 * @param {string} camelCase   - e.g. 'acctStatusType'
 * @returns {string|undefined}
 */
function pick(body, hyphenated, camelCase) {
  return body[hyphenated] !== undefined ? body[hyphenated] : body[camelCase];
}

/**
 * Parse a body value as integer, returning null if absent or not a number.
 * @param {object} body
 * @param {string} hyphenated
 * @param {string} camelCase
 * @param {number} [defaultValue=null]
 * @returns {number|null}
 */
function pickInt(body, hyphenated, camelCase, defaultValue = null) {
  const raw = pick(body, hyphenated, camelCase);
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const n = parseInt(raw, 10);
  return isNaN(n) ? defaultValue : n;
}

// ---------------------------------------------------------------------------
// POST /accounting
// ---------------------------------------------------------------------------

/**
 * Ingest a single FreeRADIUS accounting record.
 *
 * Authentication: shared secret passed as:
 *   Authorization: Bearer <RADIUS_ACCOUNTING_SECRET>
 *   — OR —
 *   X-Radius-Secret: <RADIUS_ACCOUNTING_SECRET>
 *
 * The organizationId is resolved from the NAS IP address inside
 * ingestAccounting; for now we pass 0 and let the service resolve it.
 * If your deployment has a single-org FreeRADIUS, set a fixed org via the
 * RADIUS_ACCOUNTING_ORG_ID env var.
 */
router.post('/accounting', async (req, res, next) => {
  try {
    const secret = process.env.RADIUS_ACCOUNTING_SECRET;
    if (!secret) {
      logger.error('RADIUS_ACCOUNTING_SECRET is not set — accounting ingest is disabled');
      return res.status(503).json({ error: 'Accounting ingest not configured (RADIUS_ACCOUNTING_SECRET not set)' });
    }

    const provided = req.headers['x-radius-secret']
      || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');

    if (provided !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = req.body || {};

    // ------------------------------------------------------------------
    // Normalise FreeRADIUS attribute names (both hyphenated and camelCase)
    // ------------------------------------------------------------------
    const acctStatusType = pick(body, 'Acct-Status-Type', 'acctStatusType');
    const userName        = pick(body, 'User-Name', 'userName');
    const acctSessionId   = pick(body, 'Acct-Session-Id', 'acctSessionId');
    const nasIpAddress    = pick(body, 'NAS-IP-Address', 'nasIpAddress');
    const nasPort         = pickInt(body, 'NAS-Port', 'nasPort');
    const nasPortId       = pick(body, 'NAS-Port-Id', 'nasPortId') || null;
    const calledStationId  = pick(body, 'Called-Station-Id', 'calledStationId') || null;
    const callingStationId = pick(body, 'Calling-Station-Id', 'callingStationId') || null;
    const framedIpAddress  = pick(body, 'Framed-IP-Address', 'framedIpAddress') || null;
    const framedIpv6Prefix = pick(body, 'Framed-IPv6-Prefix', 'framedIpv6Prefix') || null;
    const acctInputOctetsV6   = pickInt(body, 'Acct-Input-Octets-IPv6', 'acctInputOctetsV6');
    const acctOutputOctetsV6  = pickInt(body, 'Acct-Output-Octets-IPv6', 'acctOutputOctetsV6');
    const acctInputOctets   = pickInt(body, 'Acct-Input-Octets', 'acctInputOctets');
    const acctOutputOctets  = pickInt(body, 'Acct-Output-Octets', 'acctOutputOctets');
    const acctInputGigawords  = pickInt(body, 'Acct-Input-Gigawords', 'acctInputGigawords', 0);
    const acctOutputGigawords = pickInt(body, 'Acct-Output-Gigawords', 'acctOutputGigawords', 0);
    const acctSessionTime   = pickInt(body, 'Acct-Session-Time', 'acctSessionTime');
    const acctTerminateCause = pick(body, 'Acct-Terminate-Cause', 'acctTerminateCause') || null;

    // ------------------------------------------------------------------
    // Validate required fields
    // ------------------------------------------------------------------
    if (!acctStatusType || !userName || !acctSessionId || !nasIpAddress) {
      return res.status(400).json({
        error: 'Missing required attributes: Acct-Status-Type, User-Name, Acct-Session-Id, NAS-IP-Address',
      });
    }

    // ------------------------------------------------------------------
    // No-op for infrastructure events
    // ------------------------------------------------------------------
    const normalised = String(acctStatusType).trim();
    if (normalised === 'Accounting-On' || normalised === 'Accounting-Off') {
      logger.info({ acctStatusType: normalised, nasIpAddress }, 'Accounting-On/Off received — no-op');
      return res.status(200).json({ ok: true, action: 'noop', reason: acctStatusType });
    }

    // ------------------------------------------------------------------
    // Validate recognised status types
    // ------------------------------------------------------------------
    const VALID_STATUS_TYPES = new Set(['Start', 'Stop', 'Interim-Update']);
    if (!VALID_STATUS_TYPES.has(normalised)) {
      logger.warn({ acctStatusType: normalised }, 'Unrecognised Acct-Status-Type — ignoring');
      return res.status(200).json({ ok: true, action: 'noop', reason: `Unrecognised status type: ${normalised}` });
    }

    // ------------------------------------------------------------------
    // Resolve organizationId from env (single-org) or via NAS lookup
    // ------------------------------------------------------------------
    const organizationId = parseInt(process.env.RADIUS_ACCOUNTING_ORG_ID || '0', 10);

    const result = await ingestAccounting({
      acctStatusType: normalised,
      userName,
      acctSessionId,
      nasIpAddress,
      nasPort,
      nasPortId,
      calledStationId,
      callingStationId,
      framedIpAddress,
      framedIpv6Prefix,
      acctInputOctets,
      acctOutputOctets,
      acctInputGigawords,
      acctOutputGigawords,
      acctSessionTime,
      acctTerminateCause,
      acctInputOctetsV6,
      acctOutputOctetsV6,
      organizationId,
    });

    res.status(200).json({ ok: true, action: result.action, id: result.id, macMove: result.macMove });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
