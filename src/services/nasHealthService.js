// =============================================================================
// FireISP 5.0 — NAS Health Service
// =============================================================================
// Probes NAS devices via RADIUS Status-Server (RFC 5997, code 12) and records
// health transitions in the nas table. Emits named events on status change.
// =============================================================================

const crypto = require('crypto');
const dgram = require('dgram');
const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'nasHealth' });

// ---------------------------------------------------------------------------
// Status-Server packet construction
// ---------------------------------------------------------------------------

/**
 * Build a RADIUS Status-Server packet (code 12) including the required
 * Message-Authenticator attribute (type 80) as mandated by RFC 5997.
 *
 * Message-Authenticator for Status-Server is computed as:
 *   HMAC-MD5(packet, secret) with the Message-Authenticator field zeroed.
 *
 * Note: MD5 / HMAC-MD5 are mandated by the RADIUS protocol specs (RFC 2869,
 * RFC 5997) — this is not a free algorithmic choice.
 *
 * @param {string} secret - shared RADIUS secret
 * @returns {Buffer} fully authenticated Status-Server packet
 */
function buildStatusServerPacket(secret) {
  const identifier = crypto.randomInt(0, 256);

  // Message-Authenticator attribute: type=80, length=18, value=16 zero bytes (placeholder)
  const msgAuthAttr = Buffer.alloc(18);
  msgAuthAttr[0] = 80;   // Type: Message-Authenticator
  msgAuthAttr[1] = 18;   // Length: 2 + 16
  // value bytes are already zeroed

  // Request Authenticator — all zeros for Status-Server per RFC 5997
  const requestAuthenticator = Buffer.alloc(16, 0);

  const totalLength = 20 + msgAuthAttr.length;
  const packet = Buffer.alloc(totalLength);
  packet[0] = 12;   // Code: Status-Server
  packet[1] = identifier;
  packet.writeUInt16BE(totalLength, 2);
  requestAuthenticator.copy(packet, 4);
  msgAuthAttr.copy(packet, 20);

  // Compute HMAC-MD5 over the packet with Message-Authenticator zeroed (already is)
  const hmac = crypto.createHmac('md5', Buffer.from(secret, 'utf8'));
  hmac.update(packet);
  const mac = hmac.digest();

  // Overwrite the placeholder zeros with the actual HMAC
  mac.copy(packet, 22);  // offset 20 (type+len) + 2 = 22

  return packet;
}

// ---------------------------------------------------------------------------
// Single NAS probe
// ---------------------------------------------------------------------------

/**
 * Probe a single NAS device using RADIUS Status-Server (RFC 5997, code 12).
 *
 * Sends the Status-Server packet to the NAS CoA port (default 3799).
 * A response code of 2 (Access-Accept) indicates the NAS is reachable.
 * Timeout (5 s) or socket error indicates the NAS is unreachable.
 *
 * @param {{ id: number, ip_address: string, coa_port: number|null, secret: string }} nas
 * @returns {Promise<{ up: boolean, responseCode: number|null, responseMs: number }>}
 */
function probeNas(nas) {
  return new Promise((resolve) => {
    if (!nas.secret) {
      logger.warn({ nasId: nas.id, ip: nas.ip_address }, 'NAS RADIUS secret not configured — skipping probe');
      resolve({ up: false, responseCode: null, responseMs: 0 });
      return;
    }

    const port = nas.coa_port || 3799;
    const startMs = Date.now();
    const socket = dgram.createSocket('udp4');

    const finish = (up, responseCode) => {
      const responseMs = Date.now() - startMs;
      resolve({ up, responseCode, responseMs });
    };

    const timer = setTimeout(() => {
      socket.close();
      logger.debug({ nasId: nas.id, ip: nas.ip_address, port }, 'NAS probe timed out');
      finish(false, null);
    }, 5000);

    socket.on('message', (msg) => {
      clearTimeout(timer);
      socket.close();
      const responseCode = msg[0];
      // Access-Accept (2) = NAS alive; other codes (3=Access-Reject) also indicate reachability
      const up = responseCode === 2 || responseCode === 3;
      logger.debug({ nasId: nas.id, ip: nas.ip_address, responseCode }, 'NAS probe response received');
      finish(up, responseCode);
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      socket.close();
      logger.debug({ nasId: nas.id, ip: nas.ip_address, err: err.message }, 'NAS probe socket error');
      finish(false, null);
    });

    let packet;
    try {
      packet = buildStatusServerPacket(nas.secret);
    } catch (err) {
      clearTimeout(timer);
      socket.close();
      logger.error({ nasId: nas.id, err: err.message }, 'Failed to build Status-Server packet');
      finish(false, null);
      return;
    }

    socket.send(packet, port, nas.ip_address);
  });
}

// ---------------------------------------------------------------------------
// Event emission (lazy — eventBus may not exist in all deployments)
// ---------------------------------------------------------------------------

/**
 * Emit a named event via eventBus if available; otherwise just log.
 * @param {string} event - e.g. 'nas.down' | 'nas.up'
 * @param {object} payload
 */
function emitEvent(event, payload) {
  try {
    const { emit } = require('./eventBus');
    emit(event, payload);
  } catch {
    // eventBus is optional — log the transition instead
    logger.info({ event, ...payload }, `NAS health event: ${event}`);
  }
}

// ---------------------------------------------------------------------------
// Batch health check run
// ---------------------------------------------------------------------------

/**
 * Run health checks for all active NAS devices (or a single organisation's NAS).
 *
 * For each NAS:
 *  1. Probes via RADIUS Status-Server
 *  2. Determines new health_status ('up' | 'down')
 *  3. Detects status transitions and emits 'nas.up' / 'nas.down' events
 *  4. Updates health_status and last_health_check_at in the nas table
 *
 * @param {number|null} [organizationId=null] - scope to a single org, or null for all
 * @returns {Promise<{checked: number, up: number, down: number, transitions: Array<{id:number,from:string,to:string}>}>}
 */
async function runHealthChecks(organizationId = null) {
  const conditions = ['is_enabled = TRUE'];
  const params = [];

  if (organizationId !== null) {
    conditions.push('organization_id = ?');
    params.push(organizationId);
  }

  const [nasDevices] = await db.query(
    `SELECT id, ip_address, coa_port, secret, health_status, organization_id
     FROM nas
     WHERE ${conditions.join(' AND ')}`,
    params,
  );

  logger.info({ count: nasDevices.length, organizationId }, 'Starting NAS health checks');

  let upCount = 0;
  let downCount = 0;
  const transitions = [];

  for (const nas of nasDevices) {
    let probeResult;
    try {
      probeResult = await probeNas(nas);
    } catch (err) {
      logger.error({ nasId: nas.id, err: err.message }, 'Unexpected error probing NAS');
      probeResult = { up: false, responseCode: null, responseMs: 0 };
    }

    const newStatus = probeResult.up ? 'up' : 'down';
    const previousStatus = nas.health_status || null;

    if (newStatus === 'up') {
      upCount++;
    } else {
      downCount++;
    }

    // Detect and record transitions
    if (previousStatus !== null && previousStatus !== newStatus) {
      transitions.push({ id: nas.id, from: previousStatus, to: newStatus });

      if (newStatus === 'down') {
        logger.warn(
          { nasId: nas.id, ip: nas.ip_address, responseMs: probeResult.responseMs },
          'NAS transitioned to DOWN',
        );
        emitEvent('nas.down', {
          nas_id: nas.id,
          ip_address: nas.ip_address,
          organization_id: nas.organization_id,
        });
      } else {
        logger.info(
          { nasId: nas.id, ip: nas.ip_address, responseMs: probeResult.responseMs },
          'NAS transitioned to UP',
        );
        emitEvent('nas.up', {
          nas_id: nas.id,
          ip_address: nas.ip_address,
          organization_id: nas.organization_id,
          responseMs: probeResult.responseMs,
        });
      }
    }

    // Persist result
    try {
      await db.query(
        'UPDATE nas SET health_status = ?, last_health_check_at = NOW() WHERE id = ?',
        [newStatus, nas.id],
      );
    } catch (err) {
      logger.error({ nasId: nas.id, err: err.message }, 'Failed to update NAS health_status');
    }
  }

  const summary = {
    checked: nasDevices.length,
    up: upCount,
    down: downCount,
    transitions,
  };

  logger.info(summary, 'NAS health checks completed');
  return summary;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { probeNas, runHealthChecks };
