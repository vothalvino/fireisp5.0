// =============================================================================
// FireISP 5.0 — Embedded RADIUS Server
// =============================================================================
// A native RADIUS auth (UDP 1812) + accounting (UDP 1813) server so FireISP can
// authenticate PPPoE/RADIUS subscribers itself — no external FreeRADIUS daemon
// required. A MikroTik (or any NAS) points its `/radius` at the FireISP host and
// FireISP answers Access-Requests from its own `radius` table and routes
// accounting through the existing radiusAccountingService.ingestAccounting.
//
// Opt-in via RADIUS_SERVER_ENABLED=true (default off — it binds privileged-ish
// UDP ports and is only useful when FireISP is the RADIUS server).
//
// Reuses: radiusServerCodec (decode + PAP/CHAP + signing), radiusCoaEncoder
// (attribute/packet encoding) and radiusAttributeService (plan policy attrs).
// =============================================================================

const dgram = require('dgram');
const crypto = require('crypto');
const db = require('../config/database');
const config = require('../config');
const logger = require('../utils/logger').child({ service: 'radiusServer' });
const codec = require('./radiusServerCodec');
const coa = require('./radiusCoaEncoder');
const { generateAttributes } = require('./radiusAttributeService');
const speedWindowService = require('./speedWindowService');

const { CODE, ATTR, ACCT_STATUS } = codec;

const AUTH_REASON = Object.freeze({
  ACCEPTED: 'accepted',
  MISSING_USERNAME: 'missing_username',
  UNKNOWN_OR_INACTIVE_USER: 'unknown_or_inactive_user',
  PASSWORD_NOT_CONFIGURED: 'password_not_configured',
  UNSUPPORTED_AUTH_METHOD: 'unsupported_auth_method',
  BAD_PASSWORD: 'bad_password',
});

let authSocket = null;
let acctSocket = null;

const counters = {
  authRequests: 0, accepts: 0, rejects: 0, authDropped: 0,
  acctRequests: 0, acctIngested: 0, acctDropped: 0,
};

// ---------------------------------------------------------------------------
// Data lookups
// ---------------------------------------------------------------------------

/** Resolve the NAS (and its RADIUS shared secret) by source IP. */
async function findNasByIp(ip) {
  const [rows] = await db.query(
    `SELECT n.id, n.organization_id, n.secret
       FROM nas n
      WHERE n.ip_address = ?
        AND n.status = 'active'
        AND n.organization_id IS NOT NULL
        AND n.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
            FROM organization_database_configs odc
           WHERE odc.organization_id = n.organization_id
             AND odc.isolation_mode = 'isolated'
        )
      LIMIT 1`,
    [ip],
  );
  return rows[0] || null;
}

/**
 * Resolve a subscriber in the source NAS's organization whose contract may
 * authenticate now. A pending line is accepted only inside its bounded
 * installation test window; checking the timestamp here makes expiry fail
 * closed immediately even if the five-minute cleanup sweep has not yet changed
 * radius.status back to inactive.
 */
async function findSubscriber(username, organizationId) {
  const [rows] = await db.query(
    `SELECT r.id, r.client_id, r.contract_id, r.username, r.password, r.ip_address,
            c.plan_id, c.status AS contract_status,
            CASE WHEN c.status = 'pending'
                 THEN GREATEST(TIMESTAMPDIFF(SECOND, NOW(), c.test_window_expires_at), 1)
                 ELSE NULL END AS test_window_seconds_remaining
       FROM radius r
       LEFT JOIN contracts c ON c.id = r.contract_id
      WHERE r.username = ? AND r.organization_id <=> ?
        AND r.deleted_at IS NULL AND r.status = 'active'
        AND (
          c.id IS NULL
          OR c.status = 'active'
          OR (c.status = 'pending'
              AND c.test_window_cleanup_pending = 0
              AND c.test_window_expires_at > NOW())
        )
      LIMIT 1`,
    [username, organizationId],
  );
  return rows[0] || null;
}

async function findPlan(planId) {
  if (!planId) return null;
  const [rows] = await db.query('SELECT * FROM plans WHERE id = ? LIMIT 1', [planId]);
  return rows[0] || null;
}

/**
 * Pick the shared secret for a *known* NAS (matched by source IP). The global
 * RADIUS_SERVER_SECRET is only a fallback for a matched NAS row that has no
 * per-NAS secret — it never makes an unknown source IP a valid client (that
 * would defeat the unknown-NAS drop and create an enumeration/reflection oracle).
 */
function secretFor(nas) {
  if (!nas) return null;
  return nas.secret || config.radiusServer.secret || null;
}

/** Constant-time string compare (avoids leaking the stored password via timing). */
function timingSafeStrEqual(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** True only for a clean dotted-quad IPv4 (so we never emit a garbage Framed-IP). */
function isIpv4(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/**
 * Persist an authentication outcome without putting the authentication reply
 * on the database write path.  The UDP response is sent before this function is
 * called; synchronous driver errors and asynchronous query failures are both
 * contained here.  In particular, no supplied or stored password is accepted
 * by this function or named in its INSERT.
 */
function persistAuthOutcome({
  nas, username, nasIpAddress, callingStationId, reply, reasonCode,
}) {
  const values = [
    nas.organization_id ?? null,
    nas.id,
    typeof username === 'string' ? username.slice(0, 64) : '',
    reply,
    typeof nasIpAddress === 'string' ? nasIpAddress.slice(0, 45) : null,
    typeof callingStationId === 'string' ? callingStationId.slice(0, 100) : null,
    reasonCode,
  ];

  try {
    const pending = db.query(
      `INSERT INTO radpostauth
         (organization_id, nas_id, username, reply, nas_ip_address,
          calling_station_id, reason_code)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      values,
    );
    Promise.resolve(pending).catch((err) => {
      logger.warn(
        { err: err.message, nasId: nas.id, reasonCode },
        'RADIUS: post-auth outcome logging failed',
      );
    });
  } catch (err) {
    logger.warn(
      { err: err.message, nasId: nas.id, reasonCode },
      'RADIUS: post-auth outcome logging failed',
    );
  }
}

// ---------------------------------------------------------------------------
// Reply attribute assembly
// ---------------------------------------------------------------------------

function buildAcceptAttributes(subscriber, plan, withMessageAuth) {
  const parts = [
    codec.encodeIntAttr(ATTR.SERVICE_TYPE, 2),     // Framed-User
    codec.encodeIntAttr(ATTR.FRAMED_PROTOCOL, 1),  // PPP
  ];
  if (isIpv4(subscriber.ip_address)) {
    parts.push(coa.encodeFramedIPAddress(subscriber.ip_address)); // static Framed-IP (IPv4 only)
  }
  if (subscriber.contract_status === 'pending') {
    const remaining = Math.floor(Number(subscriber.test_window_seconds_remaining));
    if (Number.isSafeInteger(remaining) && remaining > 0) {
      parts.push(codec.encodeIntAttr(ATTR.SESSION_TIMEOUT, remaining));
    }
  }
  if (plan) {
    const attrMap = generateAttributes(plan);
    const named = [];
    for (const [name, val] of Object.entries(attrMap)) {
      if (Array.isArray(val)) val.forEach((v) => named.push({ name, value: String(v) }));
      else named.push({ name, value: String(val) });
    }
    if (named.length) {
      const policy = coa.encodeNamedAttributes(named);
      if (policy.length === 0) {
        // generateAttributes produced names the encoder can't emit (e.g. Juniper)
        // — surface it loudly rather than silently granting an unshaped session.
        logger.error({ vendor: plan.radius_vendor, plan_id: plan.id },
          'RADIUS: no policy attributes could be encoded for plan — subscriber would be uncapped');
      } else {
        parts.push(policy);
      }
    }
  }
  // Message-Authenticator placeholder (filled by signResponse) when the client used one.
  if (withMessageAuth) parts.push(codec.messageAuthenticatorPlaceholder());
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// Access-Request handling (UDP 1812)
// ---------------------------------------------------------------------------

async function handleAuth(msg, rinfo, respond) {
  counters.authRequests++;
  let pkt;
  try {
    pkt = codec.decodePacket(msg);
  } catch (err) {
    counters.authDropped++;
    logger.warn({ from: rinfo.address, err: err.message }, 'RADIUS: undecodable auth packet — dropped');
    return;
  }
  if (pkt.code !== CODE.ACCESS_REQUEST) { counters.authDropped++; return; }

  const nas = await findNasByIp(rinfo.address);
  const secret = secretFor(nas);
  if (!secret) {
    // Unknown client — RFC 2865 says silently discard.
    counters.authDropped++;
    logger.warn({ from: rinfo.address }, 'RADIUS: Access-Request from unknown NAS (no shared secret) — dropped');
    return;
  }

  // Defend against forged/Blast-RADIUS packets when the client used Message-Authenticator.
  if (!codec.verifyMessageAuthenticator(pkt.raw, pkt.attributes, secret)) {
    counters.authDropped++;
    logger.warn({ from: rinfo.address }, 'RADIUS: invalid Message-Authenticator — dropped');
    return;
  }
  const withMessageAuth = !!codec.getAttr(pkt.attributes, ATTR.MESSAGE_AUTHENTICATOR);

  const username = codec.getString(pkt.attributes, ATTR.USER_NAME);
  const nasIpAddress = codec.getIp(pkt.attributes, ATTR.NAS_IP_ADDRESS) || rinfo.address;
  const callingStationId = codec.getString(pkt.attributes, ATTR.CALLING_STATION_ID);
  let accept = false;
  let subscriber = null;
  let reasonCode;
  if (!username) {
    reasonCode = AUTH_REASON.MISSING_USERNAME;
  } else {
    subscriber = await findSubscriber(username, nas.organization_id);
    if (!subscriber) {
      reasonCode = AUTH_REASON.UNKNOWN_OR_INACTIVE_USER;
    } else if (!subscriber.password) {
      // Require a non-empty stored password — never authenticate a blank credential.
      reasonCode = AUTH_REASON.PASSWORD_NOT_CONFIGURED;
    } else {
      const userPw = codec.getAttr(pkt.attributes, ATTR.USER_PASSWORD);
      const chapPw = codec.getAttr(pkt.attributes, ATTR.CHAP_PASSWORD);
      if (userPw) {
        const plain = codec.decodePapPassword(userPw, secret, pkt.authenticator);
        accept = plain !== null && timingSafeStrEqual(plain, subscriber.password);
      } else if (chapPw) {
        const challenge = codec.getAttr(pkt.attributes, ATTR.CHAP_CHALLENGE) || pkt.authenticator;
        accept = codec.verifyChap(chapPw, challenge, subscriber.password);
      } else {
        reasonCode = AUTH_REASON.UNSUPPORTED_AUTH_METHOD;
      }

      if (!reasonCode) {
        reasonCode = accept ? AUTH_REASON.ACCEPTED : AUTH_REASON.BAD_PASSWORD;
      }
    }
  }

  let attrsBuf;
  let code;
  if (accept) {
    code = CODE.ACCESS_ACCEPT;
    counters.accepts++;
    let plan = await findPlan(subscriber.plan_id);
    // §10.2: overlay an active time-based speed window so sessions coming up
    // DURING a window start at window speeds (CoA transitions handle sessions
    // already online). Fail open to plan speeds — a window lookup error must
    // never block authentication. Cost: one extra indexed lookup
    // (idx_plan_speed_windows_plan_id) per Access-Accept, incl. windowless
    // plans — accepted; add a windowed-plan cache only if auth-storm profiling
    // ever shows it matters.
    if (plan) {
      try {
        const win = await speedWindowService.getActiveWindow(plan.id);
        if (win) plan = speedWindowService.windowEffectivePlan(plan, win);
      } catch (err) {
        logger.warn({ err, planId: plan.id }, 'RADIUS: speed-window lookup failed — using plan speeds');
      }
    }
    attrsBuf = buildAcceptAttributes(subscriber, plan, withMessageAuth);
    logger.info({ from: rinfo.address, username }, 'RADIUS: Access-Accept');
  } else {
    code = CODE.ACCESS_REJECT;
    counters.rejects++;
    const parts = [coa.encodeAttributes([{ type: ATTR.REPLY_MESSAGE, value: 'Access denied' }])];
    if (withMessageAuth) parts.push(codec.messageAuthenticatorPlaceholder());
    attrsBuf = Buffer.concat(parts);
    logger.info({ from: rinfo.address, username }, 'RADIUS: Access-Reject');
  }

  const packet = coa.buildRadiusPacket(code, pkt.identifier, Buffer.alloc(16), attrsBuf);
  codec.signResponse(packet, pkt.authenticator, secret, withMessageAuth);
  respond(packet);
  // Best effort only, deliberately after the response is handed to the socket.
  persistAuthOutcome({
    nas,
    username,
    nasIpAddress,
    callingStationId,
    reply: accept ? 'Access-Accept' : 'Access-Reject',
    reasonCode,
  });
}

// ---------------------------------------------------------------------------
// Accounting-Request handling (UDP 1813)
// ---------------------------------------------------------------------------

async function handleAcct(msg, rinfo, respond) {
  counters.acctRequests++;
  let pkt;
  try {
    pkt = codec.decodePacket(msg);
  } catch (err) {
    counters.acctDropped++;
    logger.warn({ from: rinfo.address, err: err.message }, 'RADIUS: undecodable accounting packet — dropped');
    return;
  }
  if (pkt.code !== CODE.ACCOUNTING_REQUEST) { counters.acctDropped++; return; }

  const nas = await findNasByIp(rinfo.address);
  const secret = secretFor(nas);
  if (!secret) { counters.acctDropped++; return; }

  // Validate the Accounting-Request authenticator: MD5(packet-with-auth-zeroed + secret).
  const expected = coa.computeRequestAuthenticator(pkt.raw, secret);
  if (!expected.equals(pkt.authenticator)) {
    counters.acctDropped++;
    logger.warn({ from: rinfo.address }, 'RADIUS: bad Accounting-Request authenticator — dropped');
    return;
  }

  const statusInt = codec.getInt(pkt.attributes, ATTR.ACCT_STATUS_TYPE);
  const acctStatusType = ACCT_STATUS[statusInt] || null;
  if (acctStatusType) {
    try {
      await require('./radiusAccountingService').ingestAccounting({
        acctStatusType,
        userName: codec.getString(pkt.attributes, ATTR.USER_NAME),
        acctSessionId: codec.getString(pkt.attributes, ATTR.ACCT_SESSION_ID),
        nasIpAddress: codec.getIp(pkt.attributes, ATTR.NAS_IP_ADDRESS) || rinfo.address,
        nasPortId: codec.getString(pkt.attributes, ATTR.NAS_PORT_ID),
        calledStationId: codec.getString(pkt.attributes, ATTR.CALLED_STATION_ID),
        callingStationId: codec.getString(pkt.attributes, ATTR.CALLING_STATION_ID),
        framedIpAddress: codec.getIp(pkt.attributes, ATTR.FRAMED_IP_ADDRESS),
        framedIpv6Prefix: null,
        acctInputOctets: codec.getInt(pkt.attributes, ATTR.ACCT_INPUT_OCTETS),
        acctOutputOctets: codec.getInt(pkt.attributes, ATTR.ACCT_OUTPUT_OCTETS),
        acctInputGigawords: codec.getInt(pkt.attributes, ATTR.ACCT_INPUT_GIGAWORDS),
        acctOutputGigawords: codec.getInt(pkt.attributes, ATTR.ACCT_OUTPUT_GIGAWORDS),
        acctSessionTime: codec.getInt(pkt.attributes, ATTR.ACCT_SESSION_TIME),
        acctTerminateCause: codec.getString(pkt.attributes, ATTR.ACCT_TERMINATE_CAUSE),
        organizationId: nas ? nas.organization_id : null,
        nasId: nas ? nas.id : null,
      });
      counters.acctIngested++;
    } catch (err) {
      logger.error({ from: rinfo.address, err: err.message }, 'RADIUS: accounting ingest failed');
    }
  }

  // Always acknowledge so the NAS does not retransmit indefinitely.
  const packet = coa.buildRadiusPacket(CODE.ACCOUNTING_RESPONSE, pkt.identifier, Buffer.alloc(16), Buffer.alloc(0));
  codec.signResponse(packet, pkt.authenticator, secret, false);
  respond(packet);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function bind(socket, port, onMessage, label) {
  socket.on('message', (msg, rinfo) => {
    const respond = (buf) => socket.send(buf, rinfo.port, rinfo.address);
    Promise.resolve(onMessage(msg, rinfo, respond)).catch((err) =>
      logger.error({ err: err.message }, `RADIUS ${label} handler error`));
  });
  socket.on('error', (err) => logger.error({ err: err.message, port }, `RADIUS ${label} socket error`));
  socket.bind(port, () => logger.info({ port }, `RADIUS ${label} server listening`));
}

/** Start the embedded RADIUS server (no-op unless RADIUS_SERVER_ENABLED=true). */
function start() {
  if (!config.radiusServer.enabled) return;
  if (authSocket || acctSocket) return; // already started
  authSocket = dgram.createSocket('udp4');
  acctSocket = dgram.createSocket('udp4');
  bind(authSocket, config.radiusServer.authPort, handleAuth, 'auth');
  bind(acctSocket, config.radiusServer.acctPort, handleAcct, 'accounting');
}

/** Stop the embedded RADIUS server. */
function stop() {
  if (authSocket) { try { authSocket.close(); } catch { /* ignore */ } authSocket = null; }
  if (acctSocket) { try { acctSocket.close(); } catch { /* ignore */ } acctSocket = null; }
}

/** Operational status for the /radius/server-status endpoint. */
function getStatus() {
  return {
    enabled: config.radiusServer.enabled,
    running: !!(authSocket || acctSocket),
    authPort: config.radiusServer.authPort,
    acctPort: config.radiusServer.acctPort,
    counters: { ...counters },
  };
}

module.exports = {
  start,
  stop,
  getStatus,
  // exported for tests
  handleAuth,
  handleAcct,
  _counters: counters,
};
