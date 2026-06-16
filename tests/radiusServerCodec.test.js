// =============================================================================
// FireISP 5.0 — RADIUS Server Codec Tests
// =============================================================================
// Pure unit tests for src/services/radiusServerCodec.js — packet/attribute
// decoding plus the PAP / CHAP / Message-Authenticator / Response-Authenticator
// helpers. No DB, sockets, or mocks: every fixture is built in-process with
// radiusCoaEncoder so the expected values are derived from the same primitives
// (MD5 / HMAC-MD5) the protocol mandates.
// =============================================================================

const crypto = require('crypto');

const {
  CODE,
  ATTR,
  decodePacket,
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
} = require('../src/services/radiusServerCodec');

const {
  encodeUserName,
  encodeFramedIPAddress,
  encodeVSA,
  encodeAttributes,
  buildRadiusPacket,
} = require('../src/services/radiusCoaEncoder');

const SECRET = 'testing123';
// A fixed 16-byte request authenticator so fixtures are deterministic.
const REQ_AUTH = Buffer.from([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
]);

describe('radiusServerCodec', () => {
  // ---------------------------------------------------------------------------
  // decodePacket
  // ---------------------------------------------------------------------------
  describe('decodePacket()', () => {
    test('parses the 20-byte header and a flat attribute list (incl. a VSA type 26)', () => {
      const vsa = encodeVSA(14988, 8, Buffer.from('10M/5M', 'utf8')); // Mikrotik-Rate-Limit
      const attrs = encodeAttributes([
        encodeUserName('alice'),
        encodeFramedIPAddress('10.20.30.40'),
        encodeIntAttr(ATTR.SESSION_TIMEOUT, 3600),
        vsa,
      ]);
      const packet = buildRadiusPacket(CODE.ACCESS_REQUEST, 7, REQ_AUTH, attrs);

      const decoded = decodePacket(packet);

      expect(decoded.code).toBe(CODE.ACCESS_REQUEST);
      expect(decoded.identifier).toBe(7);
      expect(decoded.length).toBe(packet.length);
      expect(decoded.authenticator.equals(REQ_AUTH)).toBe(true);

      // Attributes preserved in order.
      const types = decoded.attributes.map((a) => a.type);
      expect(types).toEqual([
        ATTR.USER_NAME,
        ATTR.FRAMED_IP_ADDRESS,
        ATTR.SESSION_TIMEOUT,
        ATTR.VENDOR_SPECIFIC,
      ]);

      // The Vendor-Specific attribute (type 26) is present and carries the raw
      // vendor TLV: 4-byte vendor-id + vendor-type + vendor-len + value.
      const vsaAttr = decoded.attributes.find((a) => a.type === ATTR.VENDOR_SPECIFIC);
      expect(vsaAttr).toBeTruthy();
      expect(vsaAttr.value.readUInt32BE(0)).toBe(14988); // Mikrotik vendor id
      expect(vsaAttr.value[4]).toBe(8); // vendor-type
      expect(vsaAttr.value.subarray(6).toString('utf8')).toBe('10M/5M');

      expect(getString(decoded.attributes, ATTR.USER_NAME)).toBe('alice');
    });

    test('rejects a buffer shorter than the 20-byte header', () => {
      expect(() => decodePacket(Buffer.alloc(19))).toThrow(/too short/i);
    });

    test('rejects a non-Buffer argument', () => {
      expect(() => decodePacket('not a buffer')).toThrow(/too short/i);
    });

    test('rejects a declared length larger than the buffer', () => {
      const attrs = encodeAttributes([encodeUserName('bob')]);
      const packet = buildRadiusPacket(CODE.ACCESS_REQUEST, 1, REQ_AUTH, attrs);
      // Overstate the header length field beyond the actual buffer size.
      packet.writeUInt16BE(packet.length + 10, 2);
      expect(() => decodePacket(packet)).toThrow(/out of range/i);
    });

    test('rejects a declared length below the minimum header size', () => {
      const packet = buildRadiusPacket(CODE.ACCESS_REQUEST, 1, REQ_AUTH, Buffer.alloc(0));
      packet.writeUInt16BE(19, 2); // < 20
      expect(() => decodePacket(packet)).toThrow(/out of range/i);
    });
  });

  // ---------------------------------------------------------------------------
  // getString / getInt / getIp
  // ---------------------------------------------------------------------------
  describe('attribute accessors', () => {
    const attrs = decodePacket(
      buildRadiusPacket(
        CODE.ACCESS_REQUEST,
        2,
        REQ_AUTH,
        encodeAttributes([
          encodeUserName('carol'),
          encodeIntAttr(ATTR.SESSION_TIMEOUT, 86400),
          encodeFramedIPAddress('192.168.1.50'),
        ]),
      ),
    ).attributes;

    test('getString returns the utf8 value', () => {
      expect(getString(attrs, ATTR.USER_NAME)).toBe('carol');
    });

    test('getString returns null for a missing attribute', () => {
      expect(getString(attrs, ATTR.REPLY_MESSAGE)).toBeNull();
    });

    test('getInt returns the 32-bit unsigned value', () => {
      expect(getInt(attrs, ATTR.SESSION_TIMEOUT)).toBe(86400);
    });

    test('getInt returns null for a missing attribute', () => {
      expect(getInt(attrs, ATTR.NAS_PORT)).toBeNull();
    });

    test('getIp returns the dotted-quad string', () => {
      expect(getIp(attrs, ATTR.FRAMED_IP_ADDRESS)).toBe('192.168.1.50');
    });

    test('getIp returns null for a missing attribute', () => {
      expect(getIp(attrs, ATTR.NAS_IP_ADDRESS)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // PAP encode/decode round-trip
  // ---------------------------------------------------------------------------
  describe('PAP password round-trip', () => {
    test('encodePapPassword then decodePapPassword recovers a short password', () => {
      const plain = 's3cret';
      const enc = encodePapPassword(plain, SECRET, REQ_AUTH);
      expect(enc.length).toBe(16); // padded up to one 16-byte block
      expect(decodePapPassword(enc, SECRET, REQ_AUTH)).toBe(plain);
    });

    test('round-trips an exactly-16-byte password (one block, no extra pad block)', () => {
      const plain = '0123456789abcdef'; // exactly 16 bytes
      const enc = encodePapPassword(plain, SECRET, REQ_AUTH);
      expect(enc.length).toBe(16);
      expect(decodePapPassword(enc, SECRET, REQ_AUTH)).toBe(plain);
    });

    test('round-trips a password longer than 16 bytes (two blocks, chained)', () => {
      const plain = 'this-password-is-definitely-longer-than-sixteen-bytes';
      const enc = encodePapPassword(plain, SECRET, REQ_AUTH);
      expect(enc.length).toBe(64); // 53 bytes -> 4 blocks of 16
      expect(enc.length % 16).toBe(0);
      expect(decodePapPassword(enc, SECRET, REQ_AUTH)).toBe(plain);
    });

    test('a wrong secret does not recover the original password', () => {
      const plain = 's3cret';
      const enc = encodePapPassword(plain, SECRET, REQ_AUTH);
      expect(decodePapPassword(enc, 'wrong-secret', REQ_AUTH)).not.toBe(plain);
    });
  });

  // ---------------------------------------------------------------------------
  // verifyChap
  // ---------------------------------------------------------------------------
  describe('verifyChap()', () => {
    const password = 'hunter2';
    const challenge = Buffer.from('0123456789abcdef', 'utf8'); // 16-byte challenge
    const chapId = 0x42;

    function buildChapPassword(id, pwd, chal) {
      const md5 = crypto
        .createHash('md5')
        .update(Buffer.from([id]))
        .update(Buffer.from(pwd, 'utf8'))
        .update(chal)
        .digest();
      return Buffer.concat([Buffer.from([id]), md5]); // 1 + 16 = 17 bytes
    }

    test('returns true for a correctly-computed CHAP-Password', () => {
      const chapPw = buildChapPassword(chapId, password, challenge);
      expect(verifyChap(chapPw, challenge, password)).toBe(true);
    });

    test('returns false when the password is wrong', () => {
      const chapPw = buildChapPassword(chapId, password, challenge);
      expect(verifyChap(chapPw, challenge, 'wrong-password')).toBe(false);
    });

    test('returns false when a response byte is flipped', () => {
      const chapPw = buildChapPassword(chapId, password, challenge);
      chapPw[5] ^= 0xff;
      expect(verifyChap(chapPw, challenge, password)).toBe(false);
    });

    test('returns false for a too-short CHAP-Password buffer', () => {
      expect(verifyChap(Buffer.alloc(10), challenge, password)).toBe(false);
    });

    test('returns false for a non-Buffer CHAP-Password', () => {
      expect(verifyChap(null, challenge, password)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // encodeIntAttr
  // ---------------------------------------------------------------------------
  describe('encodeIntAttr()', () => {
    test('emits a 6-byte TLV with the value big-endian', () => {
      const buf = encodeIntAttr(ATTR.SESSION_TIMEOUT, 3600);
      expect(buf.length).toBe(6);
      expect(buf[0]).toBe(ATTR.SESSION_TIMEOUT);
      expect(buf[1]).toBe(6);
      expect(buf.readUInt32BE(2)).toBe(3600);
    });

    test('coerces the value to an unsigned 32-bit integer', () => {
      const buf = encodeIntAttr(ATTR.NAS_PORT, -1);
      expect(buf.length).toBe(6);
      expect(buf.readUInt32BE(2)).toBe(0xffffffff);
    });
  });

  // ---------------------------------------------------------------------------
  // verifyMessageAuthenticator
  // ---------------------------------------------------------------------------
  describe('verifyMessageAuthenticator()', () => {
    test('returns true when no Message-Authenticator attribute is present', () => {
      const packet = buildRadiusPacket(
        CODE.ACCESS_REQUEST,
        3,
        REQ_AUTH,
        encodeAttributes([encodeUserName('dave')]),
      );
      const { attributes } = decodePacket(packet);
      expect(verifyMessageAuthenticator(packet, attributes, SECRET)).toBe(true);
    });

    test('validates a correctly-computed HMAC-MD5 Message-Authenticator', () => {
      // Build a packet with a 16-zero MA placeholder, then fill it with the
      // HMAC-MD5 over the whole packet (MA field already zeroed).
      const attrs = encodeAttributes([
        encodeUserName('erin'),
        messageAuthenticatorPlaceholder(),
      ]);
      const packet = buildRadiusPacket(CODE.ACCESS_REQUEST, 4, REQ_AUTH, attrs);

      // Locate the placeholder (type 80, len 18) and compute the HMAC over the
      // packet with that 16-byte value field zeroed (it already is).
      const maOffset = packet.indexOf(Buffer.from([ATTR.MESSAGE_AUTHENTICATOR, 18]), 20);
      expect(maOffset).toBeGreaterThan(0);
      const mac = crypto
        .createHmac('md5', Buffer.from(SECRET, 'utf8'))
        .update(packet) // MA value field is currently 16 zero bytes
        .digest();
      mac.copy(packet, maOffset + 2);

      const { attributes } = decodePacket(packet);
      expect(verifyMessageAuthenticator(packet, attributes, SECRET)).toBe(true);

      // Flip a byte of the embedded MA -> verification fails.
      packet[maOffset + 2] ^= 0xff;
      const { attributes: tampered } = decodePacket(packet);
      expect(verifyMessageAuthenticator(packet, tampered, SECRET)).toBe(false);
    });

    test('returns false for a Message-Authenticator of the wrong length', () => {
      // Hand-craft an attr 80 with a 15-byte (wrong) value.
      const badMa = Buffer.alloc(17);
      badMa[0] = ATTR.MESSAGE_AUTHENTICATOR;
      badMa[1] = 17; // 2 + 15
      const packet = buildRadiusPacket(
        CODE.ACCESS_REQUEST,
        5,
        REQ_AUTH,
        encodeAttributes([encodeUserName('frank'), badMa]),
      );
      const { attributes } = decodePacket(packet);
      expect(verifyMessageAuthenticator(packet, attributes, SECRET)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // signResponse
  // ---------------------------------------------------------------------------
  describe('signResponse()', () => {
    test('writes a Response-Authenticator = MD5(packet-with-reqAuth + secret)', () => {
      const attrs = encodeAttributes([encodeIntAttr(ATTR.SESSION_TIMEOUT, 1800)]);
      // Response packets start with a zero authenticator; signResponse overwrites it.
      const packet = buildRadiusPacket(CODE.ACCESS_ACCEPT, 9, Buffer.alloc(16), attrs);

      // Compute the expected Response-Authenticator the same way the codec does:
      // the request authenticator is placed in the auth field, then MD5 over the
      // whole packet + secret.
      const expectBase = Buffer.from(packet);
      REQ_AUTH.copy(expectBase, 4);
      const expected = crypto
        .createHash('md5')
        .update(expectBase)
        .update(Buffer.from(SECRET, 'utf8'))
        .digest();

      const signed = signResponse(packet, REQ_AUTH, SECRET);
      expect(signed.subarray(4, 20).equals(expected)).toBe(true);
      // Signs in place and returns the same buffer.
      expect(signed).toBe(packet);
    });

    test('fills a Message-Authenticator placeholder before the Response-Authenticator', () => {
      const attrs = encodeAttributes([
        encodeIntAttr(ATTR.SESSION_TIMEOUT, 600),
        messageAuthenticatorPlaceholder(),
      ]);
      const packet = buildRadiusPacket(CODE.ACCESS_ACCEPT, 10, Buffer.alloc(16), attrs);

      const signed = signResponse(packet, REQ_AUTH, SECRET, true);

      // The Message-Authenticator is no longer all zeros.
      const maOffset = signed.indexOf(Buffer.from([ATTR.MESSAGE_AUTHENTICATOR, 18]), 20);
      const maValue = signed.subarray(maOffset + 2, maOffset + 18);
      expect(maValue.equals(Buffer.alloc(16))).toBe(false);

      // And the Response-Authenticator is non-zero / well-formed.
      expect(signed.subarray(4, 20).equals(Buffer.alloc(16))).toBe(false);
    });
  });
});
