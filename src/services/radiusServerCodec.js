// =============================================================================
// FireISP 5.0 — RADIUS Server Codec (decode + auth helpers)
// =============================================================================
// Decoding + authentication helpers for the embedded RADIUS server
// (radiusServerService). Complements radiusCoaEncoder (which handles attribute
// and packet ENCODING for CoA/Disconnect, reused here for replies).
//
// Implements just enough of RFC 2865 / 2866 / 2869 to authenticate and account
// PPPoE subscribers natively inside FireISP — so an external FreeRADIUS daemon
// is no longer required:
//   - packet + attribute (incl. Vendor-Specific) decoding
//   - PAP User-Password decrypt (and encrypt, for tests/symmetry)
//   - CHAP-Password verification
//   - Response-Authenticator + (optional) Message-Authenticator signing/verify
//
// Note: MD5 / HMAC-MD5 are mandated by the RADIUS protocol — not a free choice.
// =============================================================================

const crypto = require('crypto');

// RADIUS packet codes (RFC 2865 §3, RFC 2866)
const CODE = {
  ACCESS_REQUEST: 1,
  ACCESS_ACCEPT: 2,
  ACCESS_REJECT: 3,
  ACCOUNTING_REQUEST: 4,
  ACCOUNTING_RESPONSE: 5,
};

// RADIUS attribute types used by the server.
const ATTR = {
  USER_NAME: 1,
  USER_PASSWORD: 2,
  CHAP_PASSWORD: 3,
  NAS_IP_ADDRESS: 4,
  NAS_PORT: 5,
  SERVICE_TYPE: 6,
  FRAMED_PROTOCOL: 7,
  FRAMED_IP_ADDRESS: 8,
  FRAMED_POOL: 88,
  REPLY_MESSAGE: 18,
  VENDOR_SPECIFIC: 26,
  CALLED_STATION_ID: 30,
  CALLING_STATION_ID: 31,
  SESSION_TIMEOUT: 27,
  ACCT_STATUS_TYPE: 40,
  ACCT_INPUT_OCTETS: 42,
  ACCT_OUTPUT_OCTETS: 43,
  ACCT_SESSION_ID: 44,
  ACCT_SESSION_TIME: 46,
  ACCT_TERMINATE_CAUSE: 49,
  ACCT_INPUT_GIGAWORDS: 52,
  ACCT_OUTPUT_GIGAWORDS: 53,
  CHAP_CHALLENGE: 60,
  NAS_PORT_ID: 87,
  FRAMED_IPV6_PREFIX: 97,
  MESSAGE_AUTHENTICATOR: 80,
};

// Acct-Status-Type values (RFC 2866 §5.1)
const ACCT_STATUS = { 1: 'Start', 2: 'Stop', 3: 'Interim-Update' };

/**
 * Decode a RADIUS packet into its header + flat attribute list.
 * @param {Buffer} buf
 * @returns {{ code:number, identifier:number, length:number,
 *            authenticator:Buffer, attributes:Array<{type:number,value:Buffer}>, raw:Buffer }}
 */
function decodePacket(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 20) {
    throw new Error('RADIUS packet too short');
  }
  const code = buf[0];
  const identifier = buf[1];
  const length = buf.readUInt16BE(2);
  if (length < 20 || length > buf.length) {
    throw new Error('RADIUS packet length out of range');
  }
  const authenticator = Buffer.from(buf.subarray(4, 20));
  const attributes = [];
  let off = 20;
  while (off + 2 <= length) {
    const type = buf[off];
    const alen = buf[off + 1];
    if (alen < 2 || off + alen > length) break; // malformed — stop parsing
    attributes.push({ type, value: Buffer.from(buf.subarray(off + 2, off + alen)) });
    off += alen;
  }
  return { code, identifier, length, authenticator, attributes, raw: Buffer.from(buf.subarray(0, length)) };
}

/** First attribute value of a given type, or null. */
function getAttr(attributes, type) {
  const a = attributes.find((x) => x.type === type);
  return a ? a.value : null;
}
/** Attribute value as utf8 string, or null. */
function getString(attributes, type) {
  const v = getAttr(attributes, type);
  return v ? v.toString('utf8') : null;
}
/** Attribute value as 32-bit unsigned int, or null. */
function getInt(attributes, type) {
  const v = getAttr(attributes, type);
  return v && v.length >= 4 ? v.readUInt32BE(0) : null;
}
/** Attribute value as dotted-quad IPv4 string, or null. */
function getIp(attributes, type) {
  const v = getAttr(attributes, type);
  return v && v.length === 4 ? `${v[0]}.${v[1]}.${v[2]}.${v[3]}` : null;
}

/**
 * Decrypt a PAP User-Password (RFC 2865 §5.2).
 * @param {Buffer} enc  - encrypted password bytes (multiple of 16)
 * @param {string} secret
 * @param {Buffer} requestAuthenticator - 16-byte request authenticator
 * @returns {string} plaintext password (trailing NULs stripped)
 */
function decodePapPassword(enc, secret, requestAuthenticator) {
  // RFC 2865 §5.2: User-Password must be a non-zero multiple of 16 bytes.
  if (!Buffer.isBuffer(enc) || enc.length === 0 || enc.length % 16 !== 0) return null;
  const secretBuf = Buffer.from(secret, 'utf8');
  const out = Buffer.alloc(enc.length);
  let last = requestAuthenticator;
  for (let i = 0; i < enc.length; i += 16) {
    const b = crypto.createHash('md5').update(secretBuf).update(last).digest();
    for (let j = 0; j < 16 && i + j < enc.length; j++) out[i + j] = enc[i + j] ^ b[j];
    last = enc.subarray(i, i + 16);
  }
  let end = out.length;
  while (end > 0 && out[end - 1] === 0) end--;
  return out.subarray(0, end).toString('utf8');
}

/**
 * Encrypt a PAP User-Password (inverse of decodePapPassword) — used by tests
 * and any internal RADIUS client.
 * @returns {Buffer}
 */
function encodePapPassword(plaintext, secret, requestAuthenticator) {
  const secretBuf = Buffer.from(secret, 'utf8');
  const src = Buffer.from(plaintext, 'utf8');
  const padLen = Math.max(16, Math.ceil(src.length / 16) * 16);
  const padded = Buffer.alloc(padLen);
  src.copy(padded);
  const out = Buffer.alloc(padLen);
  let last = requestAuthenticator;
  for (let i = 0; i < padLen; i += 16) {
    const b = crypto.createHash('md5').update(secretBuf).update(last).digest();
    for (let j = 0; j < 16; j++) out[i + j] = padded[i + j] ^ b[j];
    last = out.subarray(i, i + 16);
  }
  return out;
}

/**
 * Verify a CHAP-Password (RFC 2865 §5.3).
 * @param {Buffer} chapPassword - 1-byte CHAP ident + 16-byte response
 * @param {Buffer} challenge    - CHAP-Challenge value, or the Request Authenticator
 * @param {string} plaintextPassword - the subscriber's stored cleartext password
 * @returns {boolean}
 */
function verifyChap(chapPassword, challenge, plaintextPassword) {
  if (!Buffer.isBuffer(chapPassword) || chapPassword.length < 17) return false;
  const chapId = chapPassword[0];
  const resp = chapPassword.subarray(1, 17);
  const expected = crypto
    .createHash('md5')
    .update(Buffer.from([chapId]))
    .update(Buffer.from(plaintextPassword, 'utf8'))
    .update(challenge)
    .digest();
  return resp.length === expected.length && crypto.timingSafeEqual(resp, expected);
}

/**
 * Encode a 32-bit integer attribute (Service-Type, Framed-Protocol, Session-Timeout…).
 * @returns {Buffer}
 */
function encodeIntAttr(type, value) {
  const buf = Buffer.alloc(6);
  buf[0] = type;
  buf[1] = 6;
  buf.writeUInt32BE(value >>> 0, 2);
  return buf;
}

/**
 * Verify the Message-Authenticator (attr 80, RFC 2869 §5.14) on a request, if present.
 * HMAC-MD5(secret) over the whole packet with the MA value field zeroed.
 * @returns {boolean} true when absent (nothing to verify) or valid; false when invalid.
 */
function verifyMessageAuthenticator(packet, attributes, secret) {
  const ma = getAttr(attributes, ATTR.MESSAGE_AUTHENTICATOR);
  if (!ma) return true; // not present — nothing to verify
  if (ma.length !== 16) return false;
  const work = Buffer.from(packet);
  // Find the MA attribute offset in the packet and zero its 16-byte value.
  let off = 20;
  while (off + 2 <= work.length) {
    const type = work[off];
    const alen = work[off + 1];
    if (alen < 2) break;
    if (type === ATTR.MESSAGE_AUTHENTICATOR && alen === 18) {
      work.fill(0, off + 2, off + 18);
      const computed = crypto.createHmac('md5', Buffer.from(secret, 'utf8')).update(work).digest();
      return computed.length === ma.length && crypto.timingSafeEqual(computed, ma);
    }
    off += alen;
  }
  return false;
}

/**
 * Sign a response packet in place:
 *   1. (optional) fill a Message-Authenticator placeholder via HMAC-MD5
 *   2. compute the Response Authenticator: MD5(Code+ID+Len+ReqAuth+Attrs+Secret)
 *
 * @param {Buffer} packet - full response packet; the 16-byte authenticator field
 *   (offset 4) is overwritten. If a Message-Authenticator attr (80) with a
 *   16-zero placeholder is present it is filled first.
 * @param {Buffer} requestAuthenticator - the request's authenticator
 * @param {string} secret
 * @param {boolean} [withMessageAuth=false]
 * @returns {Buffer} the same packet, signed
 */
function signResponse(packet, requestAuthenticator, secret, withMessageAuth = false) {
  // Put the request authenticator into the auth field first (RFC 2865 §3).
  requestAuthenticator.copy(packet, 4);

  if (withMessageAuth) {
    // Locate a 16-zero Message-Authenticator placeholder and fill it.
    let off = 20;
    while (off + 2 <= packet.length) {
      const type = packet[off];
      const alen = packet[off + 1];
      if (alen < 2) break;
      if (type === ATTR.MESSAGE_AUTHENTICATOR && alen === 18) {
        packet.fill(0, off + 2, off + 18);
        const mac = crypto.createHmac('md5', Buffer.from(secret, 'utf8')).update(packet).digest();
        mac.copy(packet, off + 2);
        break;
      }
      off += alen;
    }
  }

  const respAuth = crypto
    .createHash('md5')
    .update(packet)
    .update(Buffer.from(secret, 'utf8'))
    .digest();
  respAuth.copy(packet, 4);
  return packet;
}

/** A 16-zero Message-Authenticator placeholder attribute (type 80, len 18). */
function messageAuthenticatorPlaceholder() {
  const buf = Buffer.alloc(18);
  buf[0] = ATTR.MESSAGE_AUTHENTICATOR;
  buf[1] = 18;
  return buf;
}

module.exports = {
  CODE,
  ATTR,
  ACCT_STATUS,
  decodePacket,
  getAttr,
  getString,
  getInt,
  getIp,
  decodePapPassword,
  encodePapPassword,
  verifyChap,
  encodeIntAttr,
  verifyMessageAuthenticator,
  signResponse,
  messageAuthenticatorPlaceholder,
};
