// =============================================================================
// FireISP 5.0 — RouterOS WireGuard service tests
// =============================================================================
// Covers: wireguardInterfaceUpsert, wireguardAddressUpsert, wireguardPeerUpsert,
//         wireguardReadTopology, wireguardPeerRemove, and their handlers entries.
//
// Strategy: real TCP mock server (sequenceServer pattern from routerosService.test.js)
// plus sentence capture (capturingServer) to assert exact command words at the
// wire level — verifying the RouterOS API paths written per the HARD CONSTRAINT
// (only /interface/wireguard, /ip/address, /interface/wireguard/peers, /ip/route).
// =============================================================================

jest.mock('../src/utils/logger', () => ({
  child: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  }),
}));

const net = require('net');
const {
  encodeWord,
  encodeSentence,
  readWord,
  wireguardInterfaceUpsert,
  wireguardAddressUpsert,
  wireguardPeerUpsert,
  wireguardReadTopology,
  wireguardPeerRemove,
  wireguardRouteUpsert,
  handlers,
} = require('../src/services/routerosService');

// =============================================================================
// Mock-server helpers — mirror routerosService.test.js exactly
// =============================================================================

function buildSentence(words) {
  return encodeSentence(words);
}

function createMockServer(onSentence) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let buf = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);

        let offset = 0;
        while (true) {
          const sentence = [];
          const startOffset = offset;
          let broke = false;

          while (true) {
            const r = readWord(buf, offset);
            if (!r) {
              buf = buf.slice(startOffset);
              broke = true;
              break;
            }
            if (r.word === '') {
              offset = r.nextOffset;
              break;
            }
            sentence.push(r.word);
            offset = r.nextOffset;
          }

          if (broke) break;

          const replies = onSentence(sentence, socket);
          if (replies) {
            for (const reply of replies) {
              socket.write(buildSentence(reply));
            }
          }
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

async function withMockServer(onSentence, testFn) {
  const { server, port } = await createMockServer(onSentence);
  try {
    await testFn(port);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

/**
 * Sequence-based mock: returns pre-defined reply batches in order.
 * Falls through to !done for any extra sentences.
 */
function sequenceServer(replies) {
  let idx = 0;
  return (sentence) => {
    if (idx < replies.length) return replies[idx++];
    return [['!done']];
  };
}

/**
 * Like sequenceServer but also captures every sentence received by the server,
 * so tests can assert exact command words sent to the router.
 *
 * @param {Array} replies   - same format as sequenceServer
 * @returns {{ handler: Function, received: string[][] }}
 *   received is populated in-place; received[0] = login sentence, received[1] = first command, etc.
 */
function capturingServer(replies) {
  const received = [];
  let idx = 0;
  const handler = (sentence) => {
    received.push([...sentence]);
    if (idx < replies.length) return replies[idx++];
    return [['!done']];
  };
  return { handler, received };
}

// =============================================================================
// Shared test data
// =============================================================================

const CONN = { host: '127.0.0.1', user: 'admin', password: 'secret' };
// Plausible 44-char base64 WireGuard key placeholders (format only — mock server ignores content)
const PRIV_KEY = 'wB5oGz0h0fPxKA7jGtBEAkFvh2OwQ3rKNmD8s5fZVmI=';
const PUB_KEY = 'YGi4NNBBEfZIuPTHnZIo2lMoWWWCBLx7GMbVx4MYbW4=';
const WG_IFACE = 'wg-fireisp';
const WG_PEER_COMMENT = 'fireisp-server';

// =============================================================================
// wireguardInterfaceUpsert
// =============================================================================

describe('wireguardInterfaceUpsert', () => {
  test('updates existing interface and returns created:false updated:true', async () => {
    const { handler, received } = capturingServer([
      [['!done']],                                                  // login
      [['!re', '=.id=*1', '=name=wg-fireisp'], ['!done']],         // /interface/wireguard/print ?name=…
      [['!done']],                                                  // /interface/wireguard/set
    ]);

    await withMockServer(handler, async (port) => {
      const result = await wireguardInterfaceUpsert(
        { ...CONN, port },
        { name: WG_IFACE, privateKey: PRIV_KEY, comment: WG_PEER_COMMENT },
      );
      expect(result).toEqual({ id: '*1', created: false, updated: true });

      // received[0] = login sentence (not checked in detail)
      // Exact print query: lookup by name only
      expect(received[1]).toEqual(['/interface/wireguard/print', `?name=${WG_IFACE}`]);

      // Exact set words — must include id, name, private-key, and comment
      expect(received[2][0]).toBe('/interface/wireguard/set');
      expect(received[2]).toContain('=.id=*1');
      expect(received[2]).toContain(`=name=${WG_IFACE}`);
      expect(received[2]).toContain(`=private-key=${PRIV_KEY}`);
      expect(received[2]).toContain(`=comment=${WG_PEER_COMMENT}`);
    });
  });

  test('creates new interface and returns created:true with id from !done ret', async () => {
    const { handler, received } = capturingServer([
      [['!done']],            // login
      [['!done']],            // /interface/wireguard/print — not found
      [['!done', '=ret=*5']], // /interface/wireguard/add
    ]);

    await withMockServer(handler, async (port) => {
      const result = await wireguardInterfaceUpsert(
        { ...CONN, port },
        { name: WG_IFACE, privateKey: PRIV_KEY },
      );
      expect(result).toEqual({ id: '*5', created: true, updated: false });

      // Add command uses /interface/wireguard/add, not /set
      expect(received[2][0]).toBe('/interface/wireguard/add');
      expect(received[2]).toContain(`=name=${WG_IFACE}`);
      expect(received[2]).toContain(`=private-key=${PRIV_KEY}`);
      // comment word must NOT appear when comment is omitted
      expect(received[2].some((w) => w.startsWith('=comment='))).toBe(false);
    });
  });

  test('includes =comment= word in add path when comment param is provided', async () => {
    const { handler, received } = capturingServer([
      [['!done']],
      [['!done']],             // not found
      [['!done', '=ret=*6']],
    ]);

    await withMockServer(handler, async (port) => {
      await wireguardInterfaceUpsert(
        { ...CONN, port },
        { name: WG_IFACE, privateKey: PRIV_KEY, comment: 'custom-comment' },
      );
      expect(received[2]).toContain('=comment=custom-comment');
    });
  });

  test('throws when name is missing', async () => {
    await expect(
      wireguardInterfaceUpsert(CONN, { privateKey: PRIV_KEY }),
    ).rejects.toThrow('wireguardInterfaceUpsert: name is required');
  });

  test('throws when privateKey is missing', async () => {
    await expect(
      wireguardInterfaceUpsert(CONN, { name: WG_IFACE }),
    ).rejects.toThrow('wireguardInterfaceUpsert: privateKey is required');
  });
});

// =============================================================================
// wireguardAddressUpsert
// =============================================================================

describe('wireguardAddressUpsert', () => {
  const ADDR = '10.255.0.1/32';

  test('updates existing address and returns created:false updated:true', async () => {
    const { handler, received } = capturingServer([
      [['!done']],                                                                          // login
      [['!re', '=.id=*2', '=interface=wg-fireisp', '=address=10.255.0.1/32'], ['!done']], // /ip/address/print
      [['!done']],                                                                          // /ip/address/set
    ]);

    await withMockServer(handler, async (port) => {
      const result = await wireguardAddressUpsert(
        { ...CONN, port },
        { interface: WG_IFACE, address: ADDR },
      );
      expect(result).toEqual({ id: '*2', created: false, updated: true });

      // Print query filters by BOTH interface AND address
      expect(received[1]).toEqual([
        '/ip/address/print',
        `?interface=${WG_IFACE}`,
        `?address=${ADDR}`,
      ]);

      // Set must include id, interface, and address
      expect(received[2][0]).toBe('/ip/address/set');
      expect(received[2]).toContain('=.id=*2');
      expect(received[2]).toContain(`=interface=${WG_IFACE}`);
      expect(received[2]).toContain(`=address=${ADDR}`);
    });
  });

  test('creates new address and returns created:true with id from !done ret', async () => {
    const { handler, received } = capturingServer([
      [['!done']],            // login
      [['!done']],            // /ip/address/print — not found
      [['!done', '=ret=*9']], // /ip/address/add
    ]);

    await withMockServer(handler, async (port) => {
      const result = await wireguardAddressUpsert(
        { ...CONN, port },
        { interface: WG_IFACE, address: ADDR },
      );
      expect(result).toEqual({ id: '*9', created: true, updated: false });

      expect(received[2][0]).toBe('/ip/address/add');
      expect(received[2]).toContain(`=interface=${WG_IFACE}`);
      expect(received[2]).toContain(`=address=${ADDR}`);
    });
  });

  test('throws when interface is missing', async () => {
    await expect(
      wireguardAddressUpsert(CONN, { address: '10.255.0.1/32' }),
    ).rejects.toThrow('wireguardAddressUpsert: interface is required');
  });

  test('throws when address is missing', async () => {
    await expect(
      wireguardAddressUpsert(CONN, { interface: WG_IFACE }),
    ).rejects.toThrow('wireguardAddressUpsert: address is required');
  });
});

// =============================================================================
// wireguardPeerUpsert
// =============================================================================

describe('wireguardPeerUpsert', () => {
  const BASE_PARAMS = {
    interface: WG_IFACE,
    publicKey: PUB_KEY,
    endpointAddress: '203.0.113.10',
    endpointPort: 51820,
    allowedAddress: '10.255.0.0/16',
    comment: WG_PEER_COMMENT,
  };

  test('updates existing peer (by interface+comment) and returns created:false updated:true', async () => {
    const { handler, received } = capturingServer([
      [['!done']],                                                           // login
      [['!re', '=.id=*3', '=comment=fireisp-server'], ['!done']],           // peers/print — found
      [['!done']],                                                           // peers/set
    ]);

    await withMockServer(handler, async (port) => {
      const result = await wireguardPeerUpsert(
        { ...CONN, port },
        { ...BASE_PARAMS, keepalive: 25 },
      );
      expect(result).toEqual({ id: '*3', created: false, updated: true });

      // Stable lookup key is interface + comment (NOT publicKey — survives key rotation)
      expect(received[1]).toEqual([
        '/interface/wireguard/peers/print',
        `?interface=${WG_IFACE}`,
        `?comment=${WG_PEER_COMMENT}`,
      ]);

      // Set command includes all required attribute words
      expect(received[2][0]).toBe('/interface/wireguard/peers/set');
      expect(received[2]).toContain('=.id=*3');
      expect(received[2]).toContain(`=interface=${WG_IFACE}`);
      expect(received[2]).toContain(`=comment=${WG_PEER_COMMENT}`);
      expect(received[2]).toContain(`=public-key=${PUB_KEY}`);
      expect(received[2]).toContain('=endpoint-address=203.0.113.10');
      expect(received[2]).toContain('=endpoint-port=51820');
      expect(received[2]).toContain('=allowed-address=10.255.0.0/16');
      expect(received[2]).toContain('=persistent-keepalive=25');
    });
  });

  test('creates new peer and returns created:true with id from !done ret', async () => {
    const { handler, received } = capturingServer([
      [['!done']],             // login
      [['!done']],             // peers/print — not found
      [['!done', '=ret=*7']], // peers/add
    ]);

    await withMockServer(handler, async (port) => {
      const result = await wireguardPeerUpsert(
        { ...CONN, port },
        BASE_PARAMS, // no keepalive
      );
      expect(result).toEqual({ id: '*7', created: true, updated: false });

      expect(received[2][0]).toBe('/interface/wireguard/peers/add');
      expect(received[2]).toContain(`=interface=${WG_IFACE}`);
      expect(received[2]).toContain(`=comment=${WG_PEER_COMMENT}`);
      expect(received[2]).toContain(`=public-key=${PUB_KEY}`);
      expect(received[2]).toContain('=endpoint-address=203.0.113.10');
      expect(received[2]).toContain('=endpoint-port=51820');
      expect(received[2]).toContain('=allowed-address=10.255.0.0/16');
      // persistent-keepalive word must be absent when keepalive is not provided
      expect(received[2].some((w) => w.startsWith('=persistent-keepalive='))).toBe(false);
    });
  });

  test('persistent-keepalive word present in add path when keepalive param is given', async () => {
    const { handler, received } = capturingServer([
      [['!done']],
      [['!done']],             // not found
      [['!done', '=ret=*8']],
    ]);

    await withMockServer(handler, async (port) => {
      await wireguardPeerUpsert(
        { ...CONN, port },
        { ...BASE_PARAMS, keepalive: 15 },
      );
      expect(received[2]).toContain('=persistent-keepalive=15');
    });
  });

  test('persistent-keepalive word absent when keepalive is null', async () => {
    const { handler, received } = capturingServer([
      [['!done']],
      [['!done']],
      [['!done', '=ret=*10']],
    ]);

    await withMockServer(handler, async (port) => {
      await wireguardPeerUpsert(
        { ...CONN, port },
        { ...BASE_PARAMS, keepalive: null },
      );
      expect(received[2].some((w) => w.startsWith('=persistent-keepalive='))).toBe(false);
    });
  });

  test('throws when interface is missing', async () => {
    await expect(wireguardPeerUpsert(CONN, {
      publicKey: PUB_KEY,
      endpointAddress: '203.0.113.10',
      endpointPort: 51820,
      allowedAddress: '10.255.0.0/16',
      comment: WG_PEER_COMMENT,
    })).rejects.toThrow('wireguardPeerUpsert: interface is required');
  });

  test('throws when publicKey is missing', async () => {
    await expect(wireguardPeerUpsert(CONN, {
      interface: WG_IFACE,
      endpointAddress: '203.0.113.10',
      endpointPort: 51820,
      allowedAddress: '10.255.0.0/16',
      comment: WG_PEER_COMMENT,
    })).rejects.toThrow('wireguardPeerUpsert: publicKey is required');
  });

  test('throws when endpointAddress is missing', async () => {
    await expect(wireguardPeerUpsert(CONN, {
      interface: WG_IFACE,
      publicKey: PUB_KEY,
      endpointPort: 51820,
      allowedAddress: '10.255.0.0/16',
      comment: WG_PEER_COMMENT,
    })).rejects.toThrow('wireguardPeerUpsert: endpointAddress is required');
  });

  test('throws when endpointPort is missing', async () => {
    await expect(wireguardPeerUpsert(CONN, {
      interface: WG_IFACE,
      publicKey: PUB_KEY,
      endpointAddress: '203.0.113.10',
      allowedAddress: '10.255.0.0/16',
      comment: WG_PEER_COMMENT,
    })).rejects.toThrow('wireguardPeerUpsert: endpointPort is required');
  });

  test('throws when allowedAddress is missing', async () => {
    await expect(wireguardPeerUpsert(CONN, {
      interface: WG_IFACE,
      publicKey: PUB_KEY,
      endpointAddress: '203.0.113.10',
      endpointPort: 51820,
      comment: WG_PEER_COMMENT,
    })).rejects.toThrow('wireguardPeerUpsert: allowedAddress is required');
  });

  test('throws when comment is missing', async () => {
    await expect(wireguardPeerUpsert(CONN, {
      interface: WG_IFACE,
      publicKey: PUB_KEY,
      endpointAddress: '203.0.113.10',
      endpointPort: 51820,
      allowedAddress: '10.255.0.0/16',
    })).rejects.toThrow('wireguardPeerUpsert: comment is required');
  });
});

// =============================================================================
// wireguardReadTopology
// =============================================================================

describe('wireguardReadTopology', () => {
  test('parses !re rows from all three endpoint queries and returns typed arrays', async () => {
    const { handler, received } = capturingServer([
      [['!done']], // login
      // /interface/wireguard/print
      [
        ['!re', '=.id=*1', '=name=wg-fireisp', '=running=true'],
        ['!done'],
      ],
      // /ip/address/print
      [
        ['!re', '=.id=*2', '=address=10.255.0.1/32', '=interface=wg-fireisp'],
        ['!done'],
      ],
      // /ip/route/print ?connect=yes — ROS7 flags connected routes with connect=true
      [
        ['!re', '=.id=*3', '=dst-address=192.168.10.0/24', '=connect=true'],
        ['!re', '=.id=*4', '=dst-address=192.168.20.0/24', '=connect=true'],
        ['!done'],
      ],
    ]);

    await withMockServer(handler, async (port) => {
      const result = await wireguardReadTopology({ ...CONN, port });

      // Interface rows parsed correctly
      expect(result.interfaces).toHaveLength(1);
      expect(result.interfaces[0].name).toBe('wg-fireisp');
      expect(result.interfaces[0].running).toBe('true');

      // Address rows parsed correctly
      expect(result.addresses).toHaveLength(1);
      expect(result.addresses[0].address).toBe('10.255.0.1/32');
      expect(result.addresses[0].interface).toBe('wg-fireisp');

      // Route rows parsed correctly
      expect(result.routes).toHaveLength(2);
      expect(result.routes[0]['dst-address']).toBe('192.168.10.0/24');
      expect(result.routes[1]['dst-address']).toBe('192.168.20.0/24');

      // Verify exact command words (read-only — no write paths)
      expect(received[1]).toEqual(['/interface/wireguard/print']);
      expect(received[2]).toEqual(['/ip/address/print']);
      // Route query uses the ?connect=yes filter (ROS7 has no `type` field)
      expect(received[3]).toEqual(['/ip/route/print', '?connect=yes']);
    });
  });

  test('returns empty arrays when no !re rows are returned for any endpoint', async () => {
    const handler = sequenceServer([
      [['!done']], // login
      [['!done']], // /interface/wireguard/print — no data
      [['!done']], // /ip/address/print — no data
      [['!done']], // /ip/route/print — no data
    ]);

    await withMockServer(handler, async (port) => {
      const result = await wireguardReadTopology({ ...CONN, port });
      expect(result.interfaces).toEqual([]);
      expect(result.addresses).toEqual([]);
      expect(result.routes).toEqual([]);
    });
  });

  test('sends exactly four sentences (login + three reads, no writes)', async () => {
    // The HARD CONSTRAINT is: no /ip/service or /ip/firewall writes.
    // readTopology is read-only — confirmed by total sentence count == 4.
    const { handler, received } = capturingServer([
      [['!done']],
      [['!done']],
      [['!done']],
      [['!done']],
    ]);

    await withMockServer(handler, async (port) => {
      await wireguardReadTopology({ ...CONN, port });
      // login + 3 reads; any write would add extra entries
      expect(received).toHaveLength(4);
      // None of the sentences is a write command
      const writePaths = ['/ip/service', '/ip/firewall', '/interface/wireguard/set', '/ip/address/set'];
      for (const sentence of received) {
        for (const writePath of writePaths) {
          expect(sentence[0]).not.toBe(writePath);
        }
      }
    });
  });
});

// =============================================================================
// wireguardPeerRemove
// =============================================================================

describe('wireguardPeerRemove', () => {
  test('removes existing peer by comment and returns deleted:true', async () => {
    const { handler, received } = capturingServer([
      [['!done']],                                                 // login
      [['!re', '=.id=*3', '=comment=fireisp-server'], ['!done']], // peers/print — found
      [['!done']],                                                 // peers/remove
    ]);

    await withMockServer(handler, async (port) => {
      const result = await wireguardPeerRemove(
        { ...CONN, port },
        { interface: WG_IFACE, comment: WG_PEER_COMMENT },
      );
      expect(result).toEqual({ deleted: true, interface: WG_IFACE, comment: WG_PEER_COMMENT });

      // Lookup by interface + comment
      expect(received[1]).toEqual([
        '/interface/wireguard/peers/print',
        `?interface=${WG_IFACE}`,
        `?comment=${WG_PEER_COMMENT}`,
      ]);
      // Remove uses the id returned by the print query
      expect(received[2]).toEqual(['/interface/wireguard/peers/remove', '=.id=*3']);
    });
  });

  test('no-ops when peer not found and returns deleted:false without sending a remove command', async () => {
    const { handler, received } = capturingServer([
      [['!done']], // login
      [['!done']], // peers/print — not found (no !re)
    ]);

    await withMockServer(handler, async (port) => {
      const result = await wireguardPeerRemove(
        { ...CONN, port },
        { interface: WG_IFACE, comment: WG_PEER_COMMENT },
      );
      expect(result).toEqual({ deleted: false, interface: WG_IFACE, comment: WG_PEER_COMMENT });
      // Only login + print: the remove sentence is never sent
      expect(received).toHaveLength(2);
    });
  });

  test('throws when interface is missing', async () => {
    await expect(
      wireguardPeerRemove(CONN, { comment: WG_PEER_COMMENT }),
    ).rejects.toThrow('wireguardPeerRemove: interface is required');
  });

  test('throws when comment is missing', async () => {
    await expect(
      wireguardPeerRemove(CONN, { interface: WG_IFACE }),
    ).rejects.toThrow('wireguardPeerRemove: comment is required');
  });
});

// =============================================================================
// wireguardRouteUpsert
// =============================================================================

describe('wireguardRouteUpsert', () => {
  const DST = '10.255.0.0/16';
  const GW  = 'fireisp-nas-7';

  test('creates a new route when absent and returns created:true with id from !done ret', async () => {
    const { handler, received } = capturingServer([
      [['!done']],             // login
      [['!done']],             // /ip/route/print — not found (no !re)
      [['!done', '=ret=*3']], // /ip/route/add
    ]);

    await withMockServer(handler, async (port) => {
      const result = await wireguardRouteUpsert(
        { ...CONN, port },
        { dstAddress: DST, gateway: GW, comment: 'fireisp-hub-return' },
      );
      expect(result).toEqual({ id: '*3', created: true, updated: false });

      // Lookup uses both dst-address AND gateway query words
      expect(received[1]).toEqual(['/ip/route/print', `?dst-address=${DST}`, `?gateway=${GW}`]);

      // Add command is /ip/route/add with all three attributes
      expect(received[2][0]).toBe('/ip/route/add');
      expect(received[2]).toContain(`=dst-address=${DST}`);
      expect(received[2]).toContain(`=gateway=${GW}`);
      expect(received[2]).toContain('=comment=fireisp-hub-return');
    });
  });

  test('no-ops when route already exists and returns created:false updated:false', async () => {
    const { handler, received } = capturingServer([
      [['!done']],                                                         // login
      [['!re', '=.id=*5', '=dst-address=10.255.0.0/16'], ['!done']],     // /ip/route/print — found
    ]);

    await withMockServer(handler, async (port) => {
      const result = await wireguardRouteUpsert(
        { ...CONN, port },
        { dstAddress: DST, gateway: GW },
      );
      expect(result).toEqual({ id: '*5', created: false, updated: false });

      // Only two sentences: login + print (no /ip/route/add sent)
      expect(received).toHaveLength(2);
    });
  });

  test('omits =comment= word when comment is not provided', async () => {
    const { handler, received } = capturingServer([
      [['!done']],
      [['!done']],             // not found
      [['!done', '=ret=*7']],
    ]);

    await withMockServer(handler, async (port) => {
      await wireguardRouteUpsert({ ...CONN, port }, { dstAddress: DST, gateway: GW });
      expect(received[2]).not.toContainEqual(expect.stringMatching(/^=comment=/));
    });
  });

  test('only emits /ip/route writes — never /ip/service or /ip/firewall', async () => {
    const { handler, received } = capturingServer([
      [['!done']],
      [['!done']],
      [['!done', '=ret=*8']],
    ]);

    await withMockServer(handler, async (port) => {
      await wireguardRouteUpsert({ ...CONN, port }, { dstAddress: DST, gateway: GW });
      for (const sentence of received) {
        expect(sentence[0]).not.toBe('/ip/service');
        expect(sentence[0]).not.toBe('/ip/firewall');
      }
      // All write words must be under /ip/route
      const writeSentences = received.filter((s) => s[0] && s[0].startsWith('/ip/route'));
      expect(writeSentences.length).toBeGreaterThanOrEqual(1);
    });
  });

  test('throws when dstAddress is missing', async () => {
    await expect(
      wireguardRouteUpsert(CONN, { gateway: GW }),
    ).rejects.toThrow('wireguardRouteUpsert: dstAddress is required');
  });

  test('throws when gateway is missing', async () => {
    await expect(
      wireguardRouteUpsert(CONN, { dstAddress: DST }),
    ).rejects.toThrow('wireguardRouteUpsert: gateway is required');
  });
});

// =============================================================================
// handlers — WireGuard FireRelay entries
// =============================================================================

describe('handlers — WireGuard entries', () => {
  test('exports all six WireGuard handler functions including wireguard.routeUpsert', () => {
    expect(typeof handlers['wireguard.interfaceUpsert']).toBe('function');
    expect(typeof handlers['wireguard.addressUpsert']).toBe('function');
    expect(typeof handlers['wireguard.peerUpsert']).toBe('function');
    expect(typeof handlers['wireguard.readTopology']).toBe('function');
    expect(typeof handlers['wireguard.peerRemove']).toBe('function');
    expect(typeof handlers['wireguard.routeUpsert']).toBe('function');
  });

  test('wireguard.interfaceUpsert handler routes through connFromParams and creates interface', async () => {
    const handler = sequenceServer([
      [['!done']],
      [['!done']],            // not found
      [['!done', '=ret=*1']],
    ]);

    await withMockServer(handler, async (port) => {
      const result = await handlers['wireguard.interfaceUpsert']({
        host: '127.0.0.1',
        port,
        user: 'admin',
        password: 'secret',
        name: WG_IFACE,
        privateKey: PRIV_KEY,
      });
      expect(result.created).toBe(true);
      expect(result.id).toBe('*1');
    });
  });

  test('wireguard.addressUpsert handler routes through connFromParams and creates address', async () => {
    const handler = sequenceServer([
      [['!done']],
      [['!done']],
      [['!done', '=ret=*2']],
    ]);

    await withMockServer(handler, async (port) => {
      const result = await handlers['wireguard.addressUpsert']({
        host: '127.0.0.1',
        port,
        user: 'admin',
        password: 'secret',
        interface: WG_IFACE,
        address: '10.255.0.1/32',
      });
      expect(result.created).toBe(true);
      expect(result.id).toBe('*2');
    });
  });

  test('wireguard.peerUpsert handler routes through connFromParams and creates peer', async () => {
    const handler = sequenceServer([
      [['!done']],
      [['!done']],
      [['!done', '=ret=*3']],
    ]);

    await withMockServer(handler, async (port) => {
      const result = await handlers['wireguard.peerUpsert']({
        host: '127.0.0.1',
        port,
        user: 'admin',
        password: 'secret',
        interface: WG_IFACE,
        publicKey: PUB_KEY,
        endpointAddress: '203.0.113.10',
        endpointPort: 51820,
        allowedAddress: '10.255.0.0/16',
        comment: WG_PEER_COMMENT,
      });
      expect(result.created).toBe(true);
      expect(result.id).toBe('*3');
    });
  });

  test('wireguard.readTopology handler reads all three RouterOS paths', async () => {
    const handler = sequenceServer([
      [['!done']], // login
      [['!re', '=.id=*1', '=name=wg-fireisp'], ['!done']], // interfaces
      [['!re', '=.id=*2', '=address=10.255.0.1/32', '=interface=wg-fireisp'], ['!done']], // addresses
      [['!done']], // routes (empty)
    ]);

    await withMockServer(handler, async (port) => {
      const result = await handlers['wireguard.readTopology']({
        host: '127.0.0.1',
        port,
        user: 'admin',
        password: 'secret',
      });
      expect(result.interfaces).toHaveLength(1);
      expect(result.addresses).toHaveLength(1);
      expect(result.routes).toEqual([]);
    });
  });

  test('wireguard.peerRemove handler returns deleted:false when peer is absent (no-op)', async () => {
    const handler = sequenceServer([
      [['!done']], // login
      [['!done']], // peers/print — not found
    ]);

    await withMockServer(handler, async (port) => {
      const result = await handlers['wireguard.peerRemove']({
        host: '127.0.0.1',
        port,
        user: 'admin',
        password: 'secret',
        interface: WG_IFACE,
        comment: WG_PEER_COMMENT,
      });
      expect(result.deleted).toBe(false);
    });
  });

  test('wireguard.peerRemove handler returns deleted:true when peer exists', async () => {
    const handler = sequenceServer([
      [['!done']],
      [['!re', '=.id=*5', '=comment=fireisp-server'], ['!done']], // found
      [['!done']], // remove
    ]);

    await withMockServer(handler, async (port) => {
      const result = await handlers['wireguard.peerRemove']({
        host: '127.0.0.1',
        port,
        user: 'admin',
        password: 'secret',
        interface: WG_IFACE,
        comment: WG_PEER_COMMENT,
      });
      expect(result.deleted).toBe(true);
    });
  });

  test('wireguard.routeUpsert handler routes through connFromParams and creates route', async () => {
    const handler = sequenceServer([
      [['!done']],
      [['!done']],             // route/print — not found
      [['!done', '=ret=*9']],
    ]);

    await withMockServer(handler, async (port) => {
      const result = await handlers['wireguard.routeUpsert']({
        host: '127.0.0.1',
        port,
        user: 'admin',
        password: 'secret',
        dstAddress: '10.255.0.0/16',
        gateway:    'wg-fireisp',
        comment:    'fireisp-hub-return',
      });
      expect(result.created).toBe(true);
      expect(result.id).toBe('*9');
    });
  });

  test('WireGuard handlers reject on missing conn params (host)', async () => {
    await expect(
      handlers['wireguard.interfaceUpsert']({
        user: 'admin',
        password: 'x',
        name: WG_IFACE,
        privateKey: PRIV_KEY,
      }),
    ).rejects.toThrow('host is required');
  });
});
