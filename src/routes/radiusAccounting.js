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
const crypto = require('crypto');
const db = require('../config/database');
const { ingestAccounting } = require('../services/radiusAccountingService');
const { ValidationError } = require('../utils/errors');
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
function unwrapRadiusValue(value) {
  // FreeRADIUS 3 rlm_rest's native `body = 'json'` encoding is:
  //   "User-Name": { "type": "string", "value": ["alice"] }
  // Keep accepting the flat form used by hand-written shippers and older
  // FireISP examples, but consume the real module wire shape directly.
  if (value && typeof value === 'object' && !Array.isArray(value)
      && Array.isArray(value.value)) {
    return value.value[0];
  }
  if (Array.isArray(value)) return value[0];
  return value;
}

function pick(body, hyphenated, camelCase) {
  const raw = body[hyphenated] !== undefined ? body[hyphenated] : body[camelCase];
  return unwrapRadiusValue(raw);
}

function secretMatches(expected, provided) {
  if (typeof provided !== 'string') return false;
  const expectedBuffer = Buffer.from(String(expected));
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
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
 * Tenant ownership is resolved from the live NAS row. A caller can never name
 * or override organizationId in the JSON body.
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

    if (!secretMatches(secret, provided)) {
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
    // Validate the status first, then no-op infrastructure events. Real
    // Accounting-On/Off packets commonly omit subscriber/session attributes.
    // ------------------------------------------------------------------
    if (!acctStatusType) {
      return res.status(400).json({ error: 'Missing required attribute: Acct-Status-Type' });
    }
    const normalised = String(acctStatusType).trim();
    if (normalised === 'Accounting-On' || normalised === 'Accounting-Off') {
      logger.info({ acctStatusType: normalised, nasIpAddress }, 'Accounting-On/Off received — no-op');
      return res.status(200).json({ ok: true, action: 'noop', reason: acctStatusType });
    }

    // ------------------------------------------------------------------
    // Subscriber accounting records require an attributable NAS/session.
    // ------------------------------------------------------------------
    if (!userName || !acctSessionId || !nasIpAddress) {
      return res.status(400).json({
        error: 'Missing required attributes: User-Name, Acct-Session-Id, NAS-IP-Address',
      });
    }

    // ------------------------------------------------------------------
    // Validate recognised status types
    // ------------------------------------------------------------------
    const VALID_STATUS_TYPES = new Set(['Start', 'Stop', 'Interim-Update']);
    if (!VALID_STATUS_TYPES.has(normalised)) {
      logger.warn({ acctStatusType: normalised }, 'Unrecognised Acct-Status-Type — ignoring');
      return res.status(200).json({ ok: true, action: 'noop', reason: `Unrecognised status type: ${normalised}` });
    }

    // Resolve tenant ownership before any subscriber/session lookup. NAS-IP is
    // not globally trustworthy when private addresses are reused, so an
    // unknown or ambiguous address is rejected instead of being attributed to
    // whichever tenant happens to have a matching username.
    const [nasRows] = await db.query(
      `SELECT n.id, n.organization_id
         FROM nas n
        WHERE n.ip_address = ?
          AND n.status = 'active'
          AND n.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
              FROM organization_database_configs odc
             WHERE odc.organization_id = n.organization_id
               AND odc.isolation_mode = 'isolated'
          )
        LIMIT 2`,
      [nasIpAddress],
    );
    if (nasRows.length !== 1 || nasRows[0].organization_id === null) {
      throw new ValidationError('Unable to attribute accounting record to a NAS tenant', [
        {
          field: 'NAS-IP-Address',
          message: nasRows.length > 1
            ? 'NAS-IP-Address is ambiguous across active NAS records'
            : 'NAS-IP-Address does not identify one active tenant-owned NAS',
        },
      ]);
    }
    const nas = nasRows[0];

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
      organizationId: nas.organization_id,
      nasId: nas.id,
    });

    res.status(200).json({ ok: true, action: result.action, id: result.id, macMove: result.macMove });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
