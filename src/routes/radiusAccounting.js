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
const { ingestAccounting, recordInfrastructureAccounting } = require('../services/radiusAccountingService');
const { ValidationError } = require('../utils/errors');
const { resolveNasByIp } = require('../services/tenantNasResolverService');
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
  if ((typeof raw !== 'number' && typeof raw !== 'string')
      || !/^\d+$/.test(String(raw)) || !Number.isSafeInteger(Number(raw))) {
    throw new ValidationError(`Invalid ${hyphenated}`, [{
      field: hyphenated,
      message: `${hyphenated} must be a non-negative safe integer`,
    }]);
  }
  return Number(raw);
}

function normalizeAccountingBody(body = {}) {
  return {
    acctStatusType: pick(body, 'Acct-Status-Type', 'acctStatusType'),
    userName: pick(body, 'User-Name', 'userName'),
    acctSessionId: pick(body, 'Acct-Session-Id', 'acctSessionId'),
    nasIpAddress: pick(body, 'NAS-IP-Address', 'nasIpAddress'),
    nasPort: pickInt(body, 'NAS-Port', 'nasPort'),
    nasPortId: pick(body, 'NAS-Port-Id', 'nasPortId') || null,
    calledStationId: pick(body, 'Called-Station-Id', 'calledStationId') || null,
    callingStationId: pick(body, 'Calling-Station-Id', 'callingStationId') || null,
    framedIpAddress: pick(body, 'Framed-IP-Address', 'framedIpAddress') || null,
    framedIpv6Prefix: pick(body, 'Framed-IPv6-Prefix', 'framedIpv6Prefix') || null,
    acctInputOctetsV6: pickInt(body, 'Acct-Input-Octets-IPv6', 'acctInputOctetsV6'),
    acctOutputOctetsV6: pickInt(body, 'Acct-Output-Octets-IPv6', 'acctOutputOctetsV6'),
    acctInputOctets: pickInt(body, 'Acct-Input-Octets', 'acctInputOctets'),
    acctOutputOctets: pickInt(body, 'Acct-Output-Octets', 'acctOutputOctets'),
    acctInputPackets: pickInt(body, 'Acct-Input-Packets', 'acctInputPackets'),
    acctOutputPackets: pickInt(body, 'Acct-Output-Packets', 'acctOutputPackets'),
    // Preserve absence. A missing counter pair is not a zero counter and must
    // not reset the monotonic usage baseline.
    acctInputGigawords: pickInt(body, 'Acct-Input-Gigawords', 'acctInputGigawords'),
    acctOutputGigawords: pickInt(body, 'Acct-Output-Gigawords', 'acctOutputGigawords'),
    acctSessionTime: pickInt(body, 'Acct-Session-Time', 'acctSessionTime'),
    acctTerminateCause: pick(body, 'Acct-Terminate-Cause', 'acctTerminateCause') || null,
    eventTimestamp: pick(body, 'Event-Timestamp', 'eventTimestamp') || null,
    acctDelayTime: pickInt(body, 'Acct-Delay-Time', 'acctDelayTime'),
  };
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
    const attrs = normalizeAccountingBody(body);
    attrs.provenance = {
      source: 'radius_shared_secret',
      requestId: req.id,
      sourceIp: req.ip,
      userAgent: req.get('user-agent'),
    };
    const { acctStatusType, userName, acctSessionId, nasIpAddress } = attrs;

    // ------------------------------------------------------------------
    // Validate the status first. Accounting-On/Off omit subscriber/session
    // attributes but must still resolve one NAS and persist provenance before
    // acknowledgement.
    // ------------------------------------------------------------------
    if (!acctStatusType) {
      return res.status(400).json({ error: 'Missing required attribute: Acct-Status-Type' });
    }
    const normalised = String(acctStatusType).trim();
    const infrastructureStatus = normalised === 'Accounting-On' || normalised === 'Accounting-Off';
    if (!infrastructureStatus && !['Start', 'Stop', 'Interim-Update'].includes(normalised)) {
      throw new ValidationError('Unsupported Acct-Status-Type');
    }

    // ------------------------------------------------------------------
    // Subscriber accounting records require an attributable NAS/session.
    // ------------------------------------------------------------------
    if (!nasIpAddress || (!infrastructureStatus && (!userName || !acctSessionId))) {
      return res.status(400).json({
        error: 'Missing required attributes: User-Name, Acct-Session-Id, NAS-IP-Address',
      });
    }

    // Resolve tenant ownership before any subscriber/session lookup. NAS-IP is
    // not globally trustworthy when private addresses are reused, so an
    // unknown or ambiguous address is rejected instead of being attributed to
    // whichever tenant happens to have a matching username.
    const resolution = await resolveNasByIp(nasIpAddress);
    if (!resolution.nas) {
      throw new ValidationError('Unable to attribute accounting record to a NAS tenant', [
        {
          field: 'NAS-IP-Address',
          message: resolution.ambiguous
            ? 'NAS-IP-Address is ambiguous across active NAS records'
            : 'NAS-IP-Address does not identify one active tenant-owned NAS',
        },
      ]);
    }
    const nas = resolution.nas;

    if (infrastructureStatus) {
      await db.withTenantContext(nas.organization_id, () => recordInfrastructureAccounting({
        organizationId: nas.organization_id,
        nasId: nas.id,
        acctStatusType: normalised,
        provenance: attrs.provenance,
      }));
      logger.info({ organizationId: nas.organization_id, acctStatusType: normalised }, 'Accounting-On/Off receipt persisted');
      return res.status(200).json({ ok: true, action: 'noop', reason: normalised });
    }

    const result = await db.withTenantContext(nas.organization_id, () => ingestAccounting({
      ...attrs,
      acctStatusType: normalised,
      organizationId: nas.organization_id,
      nasId: nas.id,
    }));

    res.status(200).json({ ok: true, action: result.action, id: result.id,
      macMove: result.macMove, session_instance_id: result.sessionInstanceId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.normalizeAccountingBody = normalizeAccountingBody;
