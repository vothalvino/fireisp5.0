// =============================================================================
// FireISP 5.0 — RADIUS CoA Attribute Encoder
// =============================================================================
// RFC 2865-compliant RADIUS attribute encoding for CoA and Disconnect packets.
// Replaces the minimal single-attribute encoder in suspensionService.js.
// =============================================================================

const crypto = require('crypto');
const logger = require('../utils/logger').child({ service: 'radiusCoaEncoder' });

// ---------------------------------------------------------------------------
// Basic attribute encoders
// ---------------------------------------------------------------------------

/**
 * Encode a User-Name attribute (RFC 2865 §5.1).
 * @param {string} username
 * @returns {Buffer} type=1, length=2+len, value=utf8 string
 */
function encodeUserName(username) {
  const valueBytes = Buffer.from(username, 'utf8');
  const buf = Buffer.alloc(2 + valueBytes.length);
  buf[0] = 1;
  buf[1] = 2 + valueBytes.length;
  valueBytes.copy(buf, 2);
  return buf;
}

/**
 * Encode a Framed-IP-Address attribute (RFC 2865 §5.8).
 * @param {string} ipStr - dotted-decimal IPv4 string
 * @returns {Buffer} type=8, length=6, value=4 bytes
 */
function encodeFramedIPAddress(ipStr) {
  const parts = ipStr.split('.').map((p) => parseInt(p, 10));
  const buf = Buffer.alloc(6);
  buf[0] = 8;
  buf[1] = 6;
  buf[2] = parts[0];
  buf[3] = parts[1];
  buf[4] = parts[2];
  buf[5] = parts[3];
  return buf;
}

// ---------------------------------------------------------------------------
// VSA encoder
// ---------------------------------------------------------------------------

/**
 * Encode a Vendor-Specific Attribute (RFC 2865 §5.26).
 *
 * Outer TLV layout:
 *   Byte 0    : Type = 26
 *   Byte 1    : Length = 2 + 4 + 1 + 1 + len(value)  = 8 + len(value)
 *               (the length field counts itself + type byte)
 *   Bytes 2-5 : Vendor-Id (32-bit big-endian)
 *   Vendor sub-attribute:
 *     Byte 6  : Vendor-Type
 *     Byte 7  : Vendor-Length = 2 + len(value)
 *     Bytes 8+: Value bytes
 *
 * So the outer length field = 6 + len(value) + 2 (vendor-type + vendor-length)
 *                           = 6 + 1 + 1 + len(value)
 *                           = 8 + len(value)  — but the RFC length counts type+length too,
 *                             making it 6 + 1 + 1 + len(value) = 8+len(value)
 *   Wait: RFC says Length = "the length of the Vendor-Id plus the Vendor-Specific attributes",
 *   i.e. Length = 2 (type+length bytes) + 4 (vendor-id) + sub-attr-length, and the whole
 *   field value excludes the outer type+length bytes… so:
 *   Length byte = 4 (vendor-id) + 1 (v-type) + 1 (v-len) + len(value) + 2 (outer type+len)
 *               = 8 + len(value)
 *
 * @param {number} vendorId - 32-bit vendor PEN (e.g. 14988 = Mikrotik, 9 = Cisco)
 * @param {number} vendorType - 8-bit vendor attribute type
 * @param {Buffer} vendorValue - raw value bytes
 * @returns {Buffer}
 */
function encodeVSA(vendorId, vendorType, vendorValue) {
  const valueLen = vendorValue.length;
  // The single-byte outer Length (8 + valueLen) and Vendor-Length (2 + valueLen)
  // must each fit in a byte — reject overflow rather than silently wrapping mod 256.
  if (valueLen > 247) {
    throw new Error(`VSA value too long: ${valueLen} bytes (max 247)`);
  }
  // outer length field = 4 (vendor-id) + 1 (v-type) + 1 (v-len) + valueLen
  const outerLength = 6 + valueLen;
  const buf = Buffer.alloc(2 + outerLength);

  buf[0] = 26;              // Type: Vendor-Specific
  buf[1] = outerLength;     // Length (excludes type+length bytes per RFC 2865 §3)

  // Wait — RFC 2865 §3 says length = length of ENTIRE attribute including type+length.
  // So outer length field = 2 (type+len) + 4 (vendor-id) + 1 (v-type) + 1 (v-len) + valueLen
  //                       = 8 + valueLen
  // We already set buf length to 2 + outerLength = 2 + 6 + valueLen = 8 + valueLen. Correct.
  // But the length byte should be the total including type+length = 8 + valueLen.
  buf[1] = 8 + valueLen;

  buf.writeUInt32BE(vendorId, 2);   // Vendor-Id (4 bytes BE)
  buf[6] = vendorType;              // Vendor-Type
  buf[7] = 2 + valueLen;           // Vendor-Length = 2 + len(value)
  vendorValue.copy(buf, 8);

  return buf;
}

// ---------------------------------------------------------------------------
// Vendor-specific convenience encoders
// ---------------------------------------------------------------------------

/**
 * Encode Mikrotik-Rate-Limit (vendor 14988, attr 8).
 * Value is a string like "10M/5M" (download/upload).
 * @param {string} rateLimit
 * @returns {Buffer}
 */
function encodeMikrotikRateLimit(rateLimit) {
  return encodeVSA(14988, 8, Buffer.from(rateLimit, 'utf8'));
}

/**
 * Encode Mikrotik-Address-List (vendor 14988, attr 19).
 * Used to assign a subscriber to a named address list for firewall marking.
 * @param {string} listName
 * @returns {Buffer}
 */
function encodeMikrotikAddressList(listName) {
  return encodeVSA(14988, 19, Buffer.from(listName, 'utf8'));
}

/**
 * Encode Cisco-AVPair (vendor 9, attr 1).
 * @param {string} avPairStr - e.g. "ip:sub-qos-policy-in=POLICY_NAME"
 * @returns {Buffer}
 */
function encodeCiscoAvPair(avPairStr) {
  return encodeVSA(9, 1, Buffer.from(avPairStr, 'utf8'));
}

/**
 * Encode a WISPr bandwidth attribute (vendor 14122). 32-bit integer, bits/sec.
 * Down = attr 7, Up = attr 8.
 */
function encodeWisprBandwidth(vendorType, bps) {
  const v = Buffer.alloc(4);
  v.writeUInt32BE(Number(bps) >>> 0, 0);
  return encodeVSA(14122, vendorType, v);
}
function encodeWisprBandwidthMaxDown(bps) { return encodeWisprBandwidth(7, bps); }
function encodeWisprBandwidthMaxUp(bps) { return encodeWisprBandwidth(8, bps); }

// ---------------------------------------------------------------------------
// Aggregate encoders
// ---------------------------------------------------------------------------

/**
 * Concatenate an array of attribute Buffers (or pre-built Buffers) into one.
 * @param {Array<Buffer|{type: number, value: Buffer}>} attrList
 * @returns {Buffer}
 */
function encodeAttributes(attrList) {
  const buffers = attrList.map((item) => {
    if (Buffer.isBuffer(item)) {
      return item;
    }
    // Raw {type, value} pair — encode as a simple TLV
    const valueBytes = Buffer.isBuffer(item.value)
      ? item.value
      : Buffer.from(String(item.value), 'utf8');
    if (valueBytes.length > 253) {
      throw new Error(`RADIUS attribute value too long: ${valueBytes.length} bytes (max 253)`);
    }
    const buf = Buffer.alloc(2 + valueBytes.length);
    buf[0] = item.type;
    buf[1] = 2 + valueBytes.length;
    valueBytes.copy(buf, 2);
    return buf;
  });
  return Buffer.concat(buffers);
}

/**
 * Name-to-encoder mapping for encodeNamedAttributes.
 * @type {Object<string, (value: string) => Buffer>}
 */
const NAMED_ENCODERS = {
  'User-Name': encodeUserName,
  'Framed-IP-Address': encodeFramedIPAddress,
  'Mikrotik-Rate-Limit': encodeMikrotikRateLimit,
  'Mikrotik-Address-List': encodeMikrotikAddressList,
  'Cisco-AVPair': encodeCiscoAvPair,
  'WISPr-Bandwidth-Max-Down': encodeWisprBandwidthMaxDown,
  'WISPr-Bandwidth-Max-Up': encodeWisprBandwidthMaxUp,
};

/**
 * Encode a list of named attributes into a single concatenated Buffer.
 * Unknown attribute names are skipped with a warning log.
 *
 * @param {Array<{name: string, value: string}>} attrDefs
 * @returns {Buffer}
 */
function encodeNamedAttributes(attrDefs) {
  const buffers = [];
  for (const { name, value } of attrDefs) {
    const encoder = NAMED_ENCODERS[name];
    if (!encoder) {
      logger.warn({ name }, 'Unknown RADIUS attribute name — skipping');
      continue;
    }
    buffers.push(encoder(value));
  }
  return Buffer.concat(buffers);
}

// ---------------------------------------------------------------------------
// Packet builders
// ---------------------------------------------------------------------------

/**
 * Build a RADIUS packet buffer with the standard 20-byte header.
 * @param {number} code - RADIUS code (e.g. 40=Disconnect, 43=CoA, 12=Status-Server)
 * @param {number} identifier - 0–255 packet identifier
 * @param {Buffer} authenticator - 16-byte request authenticator
 * @param {Buffer} attributesBuffer - pre-encoded attributes
 * @returns {Buffer} complete RADIUS packet
 */
function buildRadiusPacket(code, identifier, authenticator, attributesBuffer) {
  const totalLength = 20 + attributesBuffer.length;
  const packet = Buffer.alloc(totalLength);
  packet[0] = code;
  packet[1] = identifier;
  packet.writeUInt16BE(totalLength, 2);
  authenticator.copy(packet, 4);
  attributesBuffer.copy(packet, 20);
  return packet;
}

/**
 * Compute the Request Authenticator per RFC 2865 §3.
 * MD5(Code + ID + Length + 16-zero-bytes + Attrs + Secret)
 *
 * Note: MD5 is mandated by the RADIUS protocol spec — not a free algorithmic choice.
 *
 * @param {Buffer} packet - fully assembled packet (with any placeholder authenticator at offset 4)
 * @param {string} secret - shared RADIUS secret
 * @returns {Buffer} 16-byte authenticator
 */
function computeRequestAuthenticator(packet, secret) {
  const zeroed = Buffer.from(packet);
  zeroed.fill(0, 4, 20); // zero out the authenticator field
  const md5 = crypto.createHash('md5');
  md5.update(zeroed);
  md5.update(Buffer.from(secret, 'utf8'));
  return md5.digest();
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  encodeUserName,
  encodeFramedIPAddress,
  encodeVSA,
  encodeMikrotikRateLimit,
  encodeMikrotikAddressList,
  encodeCiscoAvPair,
  encodeWisprBandwidthMaxDown,
  encodeWisprBandwidthMaxUp,
  encodeAttributes,
  encodeNamedAttributes,
  buildRadiusPacket,
  computeRequestAuthenticator,
};
