// =============================================================================
// FireISP 5.0 — SNMP Trap Receiver Service
// =============================================================================
// Listens on a UDP port for unsolicited SNMP trap messages (v1 and v2c)
// from network devices, stores them in the snmp_traps table, and fires
// event-bus notifications so alert/notification hooks can react.
//
// Configuration (env vars):
//   SNMP_TRAP_PORT  UDP port to listen on (default: 1620)
//                   Use 162 only when running as root; otherwise 1620 or any
//                   port ≥ 1024.  Forward with: iptables -t nat -A PREROUTING
//                   -p udp --dport 162 -j REDIRECT --to-port 1620
//
// Standard trap-type OIDs (IETF RFC 3418 / SNMPv2-MIB):
//   coldStart            1.3.6.1.6.3.1.1.5.1
//   warmStart            1.3.6.1.6.3.1.1.5.2
//   linkDown             1.3.6.1.6.3.1.1.5.3
//   linkUp               1.3.6.1.6.3.1.1.5.4
//   authenticationFailure 1.3.6.1.6.3.1.1.5.5
//   egpNeighborLoss      1.3.6.1.6.3.1.1.5.6
// =============================================================================

const snmp = require('net-snmp');
const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'snmpTrapReceiver' });
const eventBus = require('./eventBus');

// UDP port for the trap listener (default: 1620 — non-privileged alternative to 162)
const TRAP_PORT = parseInt(process.env.SNMP_TRAP_PORT || '1620', 10);

// OID present in every SNMPv2c/v3 TrapV2-PDU — carries the actual trap OID value
const SNMP_TRAP_OID_VARBIND = '1.3.6.1.6.3.1.1.4.1.0';

// Well-known trap-type labels keyed by their SNMPv2 OID
const SNMP_TRAP_OID_MAP = {
  '1.3.6.1.6.3.1.1.5.1': 'coldStart',
  '1.3.6.1.6.3.1.1.5.2': 'warmStart',
  '1.3.6.1.6.3.1.1.5.3': 'linkDown',
  '1.3.6.1.6.3.1.1.5.4': 'linkUp',
  '1.3.6.1.6.3.1.1.5.5': 'authenticationFailure',
  '1.3.6.1.6.3.1.1.5.6': 'egpNeighborLoss',
};

// SNMPv1 generic-trap integer → label mapping (RFC 1157 §4.1.6)
const V1_GENERIC_TRAP_MAP = [
  'coldStart',           // 0
  'warmStart',           // 1
  'linkDown',            // 2
  'linkUp',              // 3
  'authenticationFailure', // 4
  'egpNeighborLoss',     // 5
  // 6 = enterpriseSpecific (handled separately)
];

let receiver = null;

// ---------------------------------------------------------------------------
// Device lookup
// ---------------------------------------------------------------------------

/**
 * Look up a device by its management IP address.
 * Returns { id, organization_id, name } or null if not found.
 */
async function lookupDevice(sourceIp) {
  const [rows] = await db.query(
    `SELECT id, organization_id, name
     FROM devices
     WHERE ip_address = ? AND deleted_at IS NULL
     LIMIT 1`,
    [sourceIp],
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Database storage
// ---------------------------------------------------------------------------

/**
 * Insert one trap row into snmp_traps and return its new ID.
 */
async function storeTrap({ organizationId, deviceId, sourceIp, trapType, trapOid, varbinds, community, snmpVersion }) {
  const [result] = await db.query(
    `INSERT INTO snmp_traps
       (organization_id, device_id, source_ip, trap_type, trap_oid,
        varbinds, community, snmp_version, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      organizationId || null,
      deviceId        || null,
      sourceIp,
      trapType,
      trapOid         || null,
      JSON.stringify(varbinds || []),
      community       || null,
      snmpVersion     || 2,
    ],
  );
  return result.insertId;
}

// ---------------------------------------------------------------------------
// Trap parsing helpers
// ---------------------------------------------------------------------------

/**
 * Serialise a single varbind to a plain-object safe for JSON storage.
 * Buffers are hex-encoded; everything else is coerced to string.
 */
function serializeVarbind(vb) {
  let value = vb.value;
  if (Buffer.isBuffer(value)) {
    value = value.toString('hex');
  } else if (value !== null && value !== undefined) {
    value = String(value);
  }
  return { oid: vb.oid, type: vb.type, value };
}

/**
 * Extract trap metadata from a net-snmp notification object.
 * Handles both SNMPv1 Trap PDUs and SNMPv2c/v3 TrapV2 PDUs.
 *
 * Returns: { trapOid, trapType, varbinds, snmpVersion, community }
 */
function extractTrapInfo(notification) {
  const pdu = notification.pdu;

  let trapOid     = null;
  let trapType    = 'unknown';
  let varbinds    = [];
  let snmpVersion = 2;
  let community   = null;

  if (!pdu) return { trapOid, trapType, varbinds, snmpVersion, community };

  community = pdu.community || null;
  const rawVarbinds = Array.isArray(pdu.varbinds) ? pdu.varbinds : [];

  // SNMPv1 Trap PDU has a `generic` (or `genericTrap`) integer field
  if (pdu.generic !== undefined || pdu.genericTrap !== undefined) {
    snmpVersion = 1;
    const genericTrap = pdu.generic !== undefined ? pdu.generic : pdu.genericTrap;

    if (genericTrap === 6) {
      // Enterprise-specific trap
      trapType = 'enterpriseSpecific';
      const enterprise  = pdu.enterprise   || '';
      const specificNum = pdu.specific     !== undefined ? pdu.specific
        : (pdu.specificTrap !== undefined ? pdu.specificTrap : 0);
      trapOid = enterprise ? `${enterprise}.0.${specificNum}` : null;
    } else if (genericTrap >= 0 && genericTrap < V1_GENERIC_TRAP_MAP.length) {
      trapType = V1_GENERIC_TRAP_MAP[genericTrap];
      trapOid  = `1.3.6.1.6.3.1.1.5.${genericTrap + 1}`;
    }
  } else {
    // SNMPv2c / v3 TrapV2 PDU — snmpTrapOID is varbind[1]
    snmpVersion = 2;
    const oidVb = rawVarbinds.find(vb => vb.oid === SNMP_TRAP_OID_VARBIND);
    if (oidVb) {
      trapOid  = typeof oidVb.value === 'string' ? oidVb.value : String(oidVb.value);
      trapType = SNMP_TRAP_OID_MAP[trapOid] || 'enterpriseSpecific';
    }
  }

  varbinds = rawVarbinds.map(serializeVarbind);

  return { trapOid, trapType, varbinds, snmpVersion, community };
}

// ---------------------------------------------------------------------------
// Core trap handler
// ---------------------------------------------------------------------------

/**
 * Process one inbound trap notification.
 * Called by net-snmp's createReceiver callback.
 */
async function handleTrap(error, notification) {
  if (error) {
    logger.error({ err: error }, 'SNMP trap receiver error');
    return;
  }

  // Acknowledge the notification (required by net-snmp receiver to free memory)
  if (typeof notification.accept === 'function') {
    notification.accept();
  }

  const sourceIp = notification.sender ? notification.sender.address : 'unknown';

  try {
    const { trapOid, trapType, varbinds, snmpVersion, community } = extractTrapInfo(notification);

    // Remove IPv4-mapped IPv6 prefix (::ffff:) so DB lookup works
    const normalizedIp = sourceIp.replace(/^::ffff:/, '');

    const device = await lookupDevice(normalizedIp);
    const orgId  = device ? device.organization_id : null;

    const trapId = await storeTrap({
      organizationId: orgId,
      deviceId:       device ? device.id : null,
      sourceIp:       normalizedIp,
      trapType,
      trapOid,
      varbinds,
      community,
      snmpVersion,
    });

    logger.info(
      { trapId, trapType, trapOid, sourceIp: normalizedIp, deviceId: device ? device.id : null },
      'SNMP trap received',
    );

    // Emit event-bus notification so notificationHooks can react
    if (device && orgId) {
      eventBus.emit('device.trap', {
        organizationId: orgId,
        device,
        trapId,
        trapType,
        trapOid,
        varbinds,
      });
    }
  } catch (err) {
    logger.error({ err, sourceIp }, 'Failed to process SNMP trap');
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the UDP trap listener.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
function start() {
  if (receiver) return receiver;

  try {
    receiver = snmp.createReceiver(
      { port: TRAP_PORT, disableAuthorization: true },
      handleTrap,
    );
    logger.info({ port: TRAP_PORT }, 'SNMP trap receiver started');
  } catch (err) {
    logger.error({ err }, 'Failed to start SNMP trap receiver');
    receiver = null;
  }

  return receiver;
}

/**
 * Stop the UDP trap listener and release the socket.
 */
function stop() {
  if (receiver) {
    try {
      receiver.close();
    } catch (_) {
      // ignore close errors
    }
    receiver = null;
    logger.info('SNMP trap receiver stopped');
  }
}

module.exports = {
  start,
  stop,
  handleTrap,
  lookupDevice,
  storeTrap,
  extractTrapInfo,
  serializeVarbind,
  SNMP_TRAP_OID_MAP,
  V1_GENERIC_TRAP_MAP,
};
