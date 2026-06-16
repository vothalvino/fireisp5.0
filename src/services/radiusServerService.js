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

const { CODE, ATTR, ACCT_STATUS } = codec;

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
    'SELECT id, organization_id, secret FROM nas WHERE ip_address = ? AND deleted_at IS NULL LIMIT 1',
    [ip],
  );
  return rows[0] || null;
}

/** Resolve an active subscriber + its plan by RADIUS username. */
async function findSubscriber(username) {
  const [rows] = await db.query(
    `SELECT r.id, r.client_id, r.contract_id, r.username, r.password, r.ip_address,
            c.plan_id
       FROM radius r
       LEFT JOIN contracts c ON c.id = r.contract_id
      WHERE r.username = ? AND r.deleted_at IS NULL AND r.status = 'active'
      LIMIT 1`,
    [username],
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
  let accept = false;
  let subscriber = null;
  if (username) {
    subscriber = await findSubscriber(username);
    // Require a non-empty stored password — never authenticate a blank credential.
    if (subscriber && subscriber.password) {
      const userPw = codec.getAttr(pkt.attributes, ATTR.USER_PASSWORD);
      const chapPw = codec.getAttr(pkt.attributes, ATTR.CHAP_PASSWORD);
      if (userPw) {
        const plain = codec.decodePapPassword(userPw, secret, pkt.authenticator);
        accept = plain !== null && timingSafeStrEqual(plain, subscriber.password);
      } else if (chapPw) {
        const challenge = codec.getAttr(pkt.attributes, ATTR.CHAP_CHALLENGE) || pkt.authenticator;
        accept = codec.verifyChap(chapPw, challenge, subscriber.password);
      }
    }
  }

  let attrsBuf;
  let code;
  if (accept) {
    code = CODE.ACCESS_ACCEPT;
    counters.accepts++;
    const plan = await findPlan(subscriber.plan_id);
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
