// =============================================================================
// FireISP 5.0 — RADIUS CoA Encoder Tests
// =============================================================================
// Tests RFC 2865-compliant attribute encoding. No mocks needed — pure Buffer
// manipulation with no I/O or external dependencies.
// =============================================================================

const {
  encodeUserName,
  encodeFramedIPAddress,
  encodeVSA,
  encodeMikrotikRateLimit,
  encodeMikrotikAddressList,
  encodeCiscoAvPair,
  encodeNamedAttributes,
  buildRadiusPacket,
  computeRequestAuthenticator,
} = require('../src/services/radiusCoaEncoder');

describe('radiusCoaEncoder', () => {
  // ---------------------------------------------------------------------------
  // encodeUserName
  // ---------------------------------------------------------------------------
  describe('encodeUserName()', () => {
    test('produces correct TLV layout for a 5-character username', () => {
      const buf = encodeUserName('alice');
      expect(buf.length).toBe(7);           // 2 + 5
      expect(buf[0]).toBe(1);               // type: User-Name
      expect(buf[1]).toBe(7);               // length: 2 + 5
      expect(buf.slice(2).toString()).toBe('alice');
    });

    test('produces correct length for a single-character username', () => {
      const buf = encodeUserName('x');
      expect(buf.length).toBe(3);
      expect(buf[1]).toBe(3);
      expect(buf.slice(2).toString()).toBe('x');
    });

    test('encodes UTF-8 value correctly', () => {
      const buf = encodeUserName('bob');
      expect(buf[0]).toBe(1);
      expect(buf.slice(2).toString('utf8')).toBe('bob');
    });
  });

  // ---------------------------------------------------------------------------
  // encodeFramedIPAddress
  // ---------------------------------------------------------------------------
  describe('encodeFramedIPAddress()', () => {
    test('produces correct 6-byte layout for 192.168.1.1', () => {
      const buf = encodeFramedIPAddress('192.168.1.1');
      expect(buf.length).toBe(6);
      expect(buf[0]).toBe(8);   // type: Framed-IP-Address
      expect(buf[1]).toBe(6);   // length
      expect(buf[2]).toBe(192);
      expect(buf[3]).toBe(168);
      expect(buf[4]).toBe(1);
      expect(buf[5]).toBe(1);
    });

    test('encodes 10.0.0.1 correctly', () => {
      const buf = encodeFramedIPAddress('10.0.0.1');
      expect(buf[2]).toBe(10);
      expect(buf[3]).toBe(0);
      expect(buf[4]).toBe(0);
      expect(buf[5]).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // encodeVSA
  // ---------------------------------------------------------------------------
  describe('encodeVSA()', () => {
    test('MikroTik Rate-Limit — exact byte layout for "10M/5M"', () => {
      const value = Buffer.from('10M/5M');   // 6 bytes
      const buf = encodeVSA(14988, 8, value);

      // Total buffer = 2 (outer type+len) + 4 (vendor-id) + 1 (v-type) + 1 (v-len) + 6 (value)
      expect(buf.length).toBe(14);

      expect(buf[0]).toBe(26);              // type: Vendor-Specific
      expect(buf[1]).toBe(14);             // outer length = 8 + 6
      expect(buf.readUInt32BE(2)).toBe(14988); // vendor-id: MikroTik
      expect(buf[6]).toBe(8);              // vendor-type: Mikrotik-Rate-Limit
      expect(buf[7]).toBe(8);              // vendor-length = 2 + 6
      expect(buf.slice(8).toString()).toBe('10M/5M');
    });

    test('Cisco AVPair — correct vendor-id (9) and vendor-type (1)', () => {
      const value = Buffer.from('ip:sub-qos-policy-in=TEST');
      const buf = encodeVSA(9, 1, value);

      expect(buf[0]).toBe(26);
      expect(buf.readUInt32BE(2)).toBe(9);  // Cisco vendor-id
      expect(buf[6]).toBe(1);              // cisco-avpair attr
    });

    test('outer length = 8 + value length for a zero-length value', () => {
      const buf = encodeVSA(14988, 8, Buffer.alloc(0));
      expect(buf.length).toBe(8);
      expect(buf[1]).toBe(8);   // 8 + 0
      expect(buf[7]).toBe(2);   // vendor-length = 2 + 0
    });
  });

  // ---------------------------------------------------------------------------
  // encodeMikrotikRateLimit
  // ---------------------------------------------------------------------------
  describe('encodeMikrotikRateLimit()', () => {
    test('produces identical result to encodeVSA(14988, 8, ...)', () => {
      const expected = encodeVSA(14988, 8, Buffer.from('10M/5M'));
      const actual = encodeMikrotikRateLimit('10M/5M');
      expect(actual).toEqual(expected);
    });

    test('vendor-type byte (buf[6]) is 8', () => {
      const buf = encodeMikrotikRateLimit('5M/2M');
      expect(buf[6]).toBe(8);
    });
  });

  // ---------------------------------------------------------------------------
  // encodeMikrotikAddressList
  // ---------------------------------------------------------------------------
  describe('encodeMikrotikAddressList()', () => {
    test('vendor-type byte (buf[6]) is 19', () => {
      const buf = encodeMikrotikAddressList('blocked');
      expect(buf[6]).toBe(19);  // vendor-type: Mikrotik-Address-List
    });

    test('encodes vendor-id 14988 (MikroTik)', () => {
      const buf = encodeMikrotikAddressList('blocked');
      expect(buf.readUInt32BE(2)).toBe(14988);
    });

    test('value bytes are correct', () => {
      const buf = encodeMikrotikAddressList('blocked');
      expect(buf.slice(8).toString()).toBe('blocked');
    });
  });

  // ---------------------------------------------------------------------------
  // encodeCiscoAvPair
  // ---------------------------------------------------------------------------
  describe('encodeCiscoAvPair()', () => {
    test('encodes vendor-id 9 (Cisco) and vendor-type 1', () => {
      const buf = encodeCiscoAvPair('ip:sub-qos-policy-in=TEST');
      expect(buf.readUInt32BE(2)).toBe(9);
      expect(buf[6]).toBe(1);
    });

    test('outer type byte is 26 (VSA)', () => {
      const buf = encodeCiscoAvPair('ip:sub-qos-policy-in=POLICY');
      expect(buf[0]).toBe(26);
    });

    test('value bytes match the av-pair string', () => {
      const avPair = 'ip:sub-qos-policy-in=TEST';
      const buf = encodeCiscoAvPair(avPair);
      expect(buf.slice(8).toString()).toBe(avPair);
    });
  });

  // ---------------------------------------------------------------------------
  // encodeNamedAttributes
  // ---------------------------------------------------------------------------
  describe('encodeNamedAttributes()', () => {
    test('concatenates User-Name and Mikrotik-Rate-Limit into a single buffer', () => {
      const result = encodeNamedAttributes([
        { name: 'User-Name', value: 'bob' },
        { name: 'Mikrotik-Rate-Limit', value: '5M/2M' },
      ]);

      // User-Name: 2 + 3 = 5 bytes
      // Mikrotik-Rate-Limit VSA: 8 + 5 = 13 bytes
      expect(result.length).toBe(18);

      // First attribute is User-Name (type 1)
      expect(result[0]).toBe(1);
      expect(result[1]).toBe(5);
      expect(result.slice(2, 5).toString()).toBe('bob');

      // Second attribute is VSA (type 26) at offset 5
      expect(result[5]).toBe(26);
    });

    test('skips unknown attribute names and still returns the known ones', () => {
      const result = encodeNamedAttributes([
        { name: 'User-Name', value: 'alice' },
        { name: 'Unknown-Attr', value: 'ignored' },
      ]);

      // Only User-Name (5 + 5 = 7 bytes)
      expect(result.length).toBe(7);
      expect(result[0]).toBe(1);
    });

    test('returns empty buffer for empty input', () => {
      const result = encodeNamedAttributes([]);
      expect(result.length).toBe(0);
    });

    test('encodes Framed-IP-Address correctly via named dispatch', () => {
      const result = encodeNamedAttributes([
        { name: 'Framed-IP-Address', value: '10.0.0.1' },
      ]);
      expect(result.length).toBe(6);
      expect(result[0]).toBe(8);
    });
  });

  // ---------------------------------------------------------------------------
  // buildRadiusPacket
  // ---------------------------------------------------------------------------
  describe('buildRadiusPacket()', () => {
    test('CoA-Request (code 43) with no attributes — 20-byte packet', () => {
      const authenticator = Buffer.alloc(16);
      const buf = buildRadiusPacket(43, 5, authenticator, Buffer.alloc(0));

      expect(buf.length).toBe(20);
      expect(buf[0]).toBe(43);               // code: CoA-Request
      expect(buf[1]).toBe(5);               // identifier
      expect(buf.readUInt16BE(2)).toBe(20); // total length
      expect(buf.slice(4, 20)).toEqual(authenticator);
    });

    test('Disconnect-Request (code 40) with attributes appended after offset 20', () => {
      const authenticator = Buffer.alloc(16);
      const attrs = encodeUserName('carol');  // 7 bytes
      const buf = buildRadiusPacket(40, 1, authenticator, attrs);

      expect(buf.length).toBe(27);            // 20 + 7
      expect(buf[0]).toBe(40);
      expect(buf.readUInt16BE(2)).toBe(27);
      expect(buf.slice(20)).toEqual(attrs);
    });

    test('authenticator is copied verbatim to bytes 4–19', () => {
      const authenticator = Buffer.from([
        1, 2, 3, 4, 5, 6, 7, 8,
        9, 10, 11, 12, 13, 14, 15, 16,
      ]);
      const buf = buildRadiusPacket(43, 0, authenticator, Buffer.alloc(0));
      expect(buf.slice(4, 20)).toEqual(authenticator);
    });
  });

  // ---------------------------------------------------------------------------
  // computeRequestAuthenticator
  // ---------------------------------------------------------------------------
  describe('computeRequestAuthenticator()', () => {
    test('returns a 16-byte Buffer', () => {
      const authenticator = Buffer.alloc(16);
      const packet = buildRadiusPacket(43, 1, authenticator, Buffer.alloc(0));
      const result = computeRequestAuthenticator(packet, 'secret');
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBe(16);
    });

    test('returns different values for different secrets', () => {
      const authenticator = Buffer.alloc(16);
      const packet = buildRadiusPacket(43, 1, authenticator, Buffer.alloc(0));
      const r1 = computeRequestAuthenticator(packet, 'secret1');
      const r2 = computeRequestAuthenticator(packet, 'secret2');
      expect(r1).not.toEqual(r2);
    });

    test('is deterministic — same inputs produce same output', () => {
      const authenticator = Buffer.alloc(16);
      const packet = buildRadiusPacket(43, 7, authenticator, Buffer.alloc(0));
      const r1 = computeRequestAuthenticator(packet, 'testing123');
      const r2 = computeRequestAuthenticator(packet, 'testing123');
      expect(r1).toEqual(r2);
    });

    test('does not mutate the original packet', () => {
      const authenticator = Buffer.alloc(16, 0xff);
      const packet = buildRadiusPacket(43, 1, authenticator, Buffer.alloc(0));
      const original = Buffer.from(packet);
      computeRequestAuthenticator(packet, 'secret');
      expect(packet).toEqual(original);
    });
  });
});
