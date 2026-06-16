// =============================================================================
// FireISP 5.0 — RouterOS Service Tests
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
  parseSentences,
  parseAttrs,
  RouterOSClient,
  pppoeCreate,
  pppoeUpsert,
  pppoeDelete,
  queueSet,
  addressListAdd,
  addressListRemove,
  configBackup,
  connFromParams,
  handlers,
  DEFAULT_PORT,
} = require('../src/services/routerosService');

// =============================================================================
// Protocol helpers — unit tests (no networking)
// =============================================================================

describe('encodeWord', () => {
  test('encodes empty string as single zero byte', () => {
    const buf = encodeWord('');
    expect(buf).toEqual(Buffer.from([0x00]));
  });

  test('encodes short word with 1-byte length prefix', () => {
    const buf = encodeWord('hi');
    // length = 2 (< 0x80), followed by 'hi'
    expect(buf[0]).toBe(2);
    expect(buf.slice(1).toString()).toBe('hi');
  });

  test('encodes word of exactly 127 bytes with 1-byte prefix', () => {
    const word = 'a'.repeat(127);
    const buf = encodeWord(word);
    expect(buf[0]).toBe(0x7f);
    expect(buf.length).toBe(128);
  });

  test('encodes word of 128 bytes with 2-byte prefix', () => {
    const word = 'a'.repeat(128);
    const buf = encodeWord(word);
    // first byte: (128 >> 8) | 0x80 = 0x80
    expect(buf[0]).toBe(0x80);
    expect(buf[1]).toBe(0x80);
    expect(buf.length).toBe(130);
  });
});

describe('readWord', () => {
  test('reads a short word (1-byte length prefix)', () => {
    const buf = encodeWord('hello');
    const result = readWord(buf, 0);
    expect(result).not.toBeNull();
    expect(result.word).toBe('hello');
    expect(result.nextOffset).toBe(buf.length);
  });

  test('returns null when buffer is too short', () => {
    const buf = Buffer.from([0x10]); // says length=16 but no data follows
    expect(readWord(buf, 0)).toBeNull();
  });

  test('reads an empty word (terminator)', () => {
    const buf = Buffer.from([0x00]);
    const result = readWord(buf, 0);
    expect(result).not.toBeNull();
    expect(result.word).toBe('');
    expect(result.nextOffset).toBe(1);
  });

  test('reads 2-byte length prefix (128-byte word)', () => {
    const word = 'x'.repeat(128);
    const buf = encodeWord(word);
    const result = readWord(buf, 0);
    expect(result).not.toBeNull();
    expect(result.word).toBe(word);
    expect(result.nextOffset).toBe(buf.length);
  });
});

describe('encodeSentence / round-trip', () => {
  test('encodes a sentence and words are parseable', () => {
    const words = ['/login', '=name=admin', '=password=secret'];
    const buf = encodeSentence(words);

    // Parse words back
    let offset = 0;
    const parsed = [];
    while (true) {
      const r = readWord(buf, offset);
      expect(r).not.toBeNull();
      if (r.word === '') break;
      parsed.push(r.word);
      offset = r.nextOffset;
    }
    expect(parsed).toEqual(words);
  });
});

describe('parseAttrs', () => {
  test('parses =key=value words', () => {
    const result = parseAttrs(['!re', '=.id=*1', '=name=myuser', '=profile=default']);
    expect(result['.id']).toBe('*1');
    expect(result.name).toBe('myuser');
    expect(result.profile).toBe('default');
  });

  test('ignores non-attribute words', () => {
    const result = parseAttrs(['!done', '=ret=*5']);
    expect(result.ret).toBe('*5');
    expect(Object.keys(result)).toHaveLength(1);
  });

  test('handles value with = in it', () => {
    const result = parseAttrs(['=comment=foo=bar']);
    expect(result.comment).toBe('foo=bar');
  });
});

describe('connFromParams', () => {
  test('extracts connection fields', () => {
    const conn = connFromParams({ host: '10.0.0.1', port: 8728, user: 'admin', password: 'pass', name: 'myuser' });
    expect(conn).toEqual({ host: '10.0.0.1', port: 8728, user: 'admin', password: 'pass' });
  });

  test('uses DEFAULT_PORT when port is omitted', () => {
    const conn = connFromParams({ host: '10.0.0.1', user: 'admin', password: '' });
    expect(conn.port).toBe(DEFAULT_PORT);
  });

  test('throws if host is missing', () => {
    expect(() => connFromParams({ user: 'admin', password: 'p' })).toThrow('host is required');
  });

  test('throws if user is missing', () => {
    expect(() => connFromParams({ host: '10.0.0.1', password: 'p' })).toThrow('user is required');
  });

  test('throws if password is missing', () => {
    expect(() => connFromParams({ host: '10.0.0.1', user: 'admin' })).toThrow('password is required');
  });
});

// =============================================================================
// RouterOSClient with a mock TCP server
// =============================================================================

/**
 * Build a Buffer representing a complete RouterOS response sentence.
 */
function buildSentence(words) {
  return encodeSentence(words);
}

/**
 * Start a mock RouterOS TCP server.
 * onSentence is called for each complete sentence received and should return
 * an array of sentences (string[][]) to send back, or null to send nothing.
 */
function createMockServer(onSentence) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let buf = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);

        // Parse sentences from buffer
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

          // Got a complete sentence — call the handler
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

// Sequence-based mock: each call to onSentence consumes the next replies entry
function sequenceServer(replies) {
  let idx = 0;
  return (sentence) => {
    if (idx < replies.length) {
      return replies[idx++];
    }
    return [['!done']];
  };
}

describe('RouterOSClient', () => {
  test('connects and logs in successfully', async () => {
    const handler = sequenceServer([
      // Response to /login
      [['!done']],
    ]);

    await withMockServer(handler, async (port) => {
      const client = new RouterOSClient({
        host: '127.0.0.1',
        port,
        user: 'admin',
        password: 'secret',
      });
      await expect(client.connect()).resolves.toBeUndefined();
      await client.close();
    });
  });

  test('rejects on login trap', async () => {
    const handler = sequenceServer([
      [['!trap', '=message=invalid credentials']],
    ]);

    await withMockServer(handler, async (port) => {
      const client = new RouterOSClient({
        host: '127.0.0.1',
        port,
        user: 'admin',
        password: 'wrong',
      });
      await expect(client.connect()).rejects.toThrow('invalid credentials');
    });
  });

  test('run() collects !re sentences and resolves on !done', async () => {
    const handler = sequenceServer([
      // /login
      [['!done']],
      // /ppp/secret/print
      [
        ['!re', '=.id=*1', '=name=testuser'],
        ['!done'],
      ],
    ]);

    await withMockServer(handler, async (port) => {
      const client = new RouterOSClient({ host: '127.0.0.1', port, user: 'admin', password: '' });
      await client.connect();
      const sentences = await client.run(['/ppp/secret/print', '?name=testuser']);
      expect(sentences.some((s) => s[0] === '!re')).toBe(true);
      await client.close();
    });
  });

  test('run() rejects on !trap', async () => {
    const handler = sequenceServer([
      [['!done']], // login
      [['!trap', '=message=no such item']],
    ]);

    await withMockServer(handler, async (port) => {
      const client = new RouterOSClient({ host: '127.0.0.1', port, user: 'admin', password: '' });
      await client.connect();
      await expect(client.run(['/ppp/secret/remove', '=.id=*99'])).rejects.toThrow('no such item');
      await client.close();
    });
  });

  test('rejects on connection timeout', async () => {
    // Listen on a port then immediately close to force connection failure
    const blocker = net.createServer();
    await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
    const { port } = blocker.address();
    blocker.close();

    const client = new RouterOSClient({
      host: '127.0.0.1',
      port: 19999, // no listener on this port
      user: 'admin',
      password: '',
      timeoutMs: 200,
    });
    await expect(client.connect()).rejects.toThrow();
  });

  test('close() resolves immediately when socket is null', async () => {
    // After a failed connect, _socket is null — close() should resolve instantly
    const client = new RouterOSClient({ host: '127.0.0.1', port: 19999, user: 'u', password: 'p' });
    // _socket starts as null before connect() is called
    await expect(client.close()).resolves.toBeUndefined();
  });

  test('rejects with !fatal login response', async () => {
    // !fatal is handled in _onSentence same as !trap — rejects with message
    const handler = sequenceServer([
      [['!fatal', '=message=fatal error during auth']],
    ]);
    await withMockServer(handler, async (port) => {
      const client = new RouterOSClient({ host: '127.0.0.1', port, user: 'admin', password: '' });
      await expect(client.connect()).rejects.toThrow('fatal error during auth');
    });
  });

  test('_onSocketError rejects pending commands when socket emits error', async () => {
    // Simulate a socket error occurring mid-command by destroying the server socket
    // which causes the client socket to emit ECONNRESET (handled by _onSocketError)
    let serverSideSocket;
    const { server, port } = await createMockServer((sentence, socket) => {
      if (sentence[0] === '/login') {
        socket.write(buildSentence(['!done']));
        serverSideSocket = socket;
      }
      // Don't reply to command — let the forced destroy trigger the error
      return null;
    });
    try {
      const client = new RouterOSClient({ host: '127.0.0.1', port, user: 'admin', password: '' });
      await client.connect();
      const runPromise = client.run(['/ppp/secret/print']);
      // Destroy server socket → client gets ECONNRESET (fires _onSocketError)
      if (serverSideSocket) serverSideSocket.destroy();
      await expect(runPromise).rejects.toThrow();
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test('_onClose rejects pending commands with connection-closed error (graceful close)', async () => {
    // Simulate server ending connection gracefully (FIN, not RST)
    // which fires socket close event → _onClose
    let serverSideSocket;
    const { server, port } = await createMockServer((sentence, socket) => {
      if (sentence[0] === '/login') {
        socket.write(buildSentence(['!done']));
        serverSideSocket = socket;
      }
      // Don't reply to command
      return null;
    });
    try {
      const client = new RouterOSClient({ host: '127.0.0.1', port, user: 'admin', password: '' });
      await client.connect();
      const runPromise = client.run(['/ppp/secret/print']);
      // End server socket gracefully (sends FIN, fires close on client)
      if (serverSideSocket) serverSideSocket.end();
      const rejection = await runPromise.catch((e) => e);
      // Either ECONNRESET, connection closed, or similar
      expect(rejection).toBeInstanceOf(Error);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

// =============================================================================
// High-level command functions
// =============================================================================

const CONN = { host: '127.0.0.1', user: 'admin', password: 'secret' };

describe('pppoeCreate', () => {
  test('creates a PPPoE secret and returns id', async () => {
    const handler = sequenceServer([
      [['!done']],                          // login
      [['!done', '=ret=*5']],              // /ppp/secret/add
    ]);

    await withMockServer(handler, async (port) => {
      const result = await pppoeCreate(
        { ...CONN, port },
        { name: 'client1', secretPassword: 'pass123', profile: 'default' },
      );
      expect(result.id).toBe('*5');
    });
  });

  test('throws when name is missing', async () => {
    await expect(
      pppoeCreate(CONN, { secretPassword: 'pass' }),
    ).rejects.toThrow('name is required');
  });

  test('throws when secretPassword is missing', async () => {
    await expect(
      pppoeCreate(CONN, { name: 'user1' }),
    ).rejects.toThrow('secretPassword is required');
  });
});

describe('pppoeUpsert', () => {
  test('updates an existing secret (found by name) and returns updated=true', async () => {
    const handler = sequenceServer([
      [['!done']],                                          // login
      [['!re', '=.id=*3', '=name=client1'], ['!done']],    // /ppp/secret/print — found
      [['!done']],                                          // /ppp/secret/set
    ]);

    await withMockServer(handler, async (port) => {
      const result = await pppoeUpsert(
        { ...CONN, port },
        { name: 'client1', secretPassword: 'pass123', profile: 'default', comment: 'c' },
      );
      expect(result).toEqual({ id: '*3', created: false, updated: true });
    });
  });

  test('creates a new secret (not found) and returns the new id with created=true', async () => {
    const handler = sequenceServer([
      [['!done']],                 // login
      [['!done']],                 // /ppp/secret/print — no !re, not found
      [['!done', '=ret=*8']],     // /ppp/secret/add
    ]);

    await withMockServer(handler, async (port) => {
      const result = await pppoeUpsert(
        { ...CONN, port },
        { name: 'newclient', secretPassword: 'pw' },
      );
      expect(result).toEqual({ id: '*8', created: true, updated: false });
    });
  });

  test('throws when name is missing', async () => {
    await expect(
      pppoeUpsert(CONN, { secretPassword: 'pass' }),
    ).rejects.toThrow('name is required');
  });

  test('throws when secretPassword is missing', async () => {
    await expect(
      pppoeUpsert(CONN, { name: 'user1' }),
    ).rejects.toThrow('secretPassword is required');
  });
});

describe('pppoeDelete', () => {
  test('deletes an existing PPPoE secret by name', async () => {
    const handler = sequenceServer([
      [['!done']],                                        // login
      [['!re', '=.id=*3', '=name=client1'], ['!done']], // /ppp/secret/print
      [['!done']],                                        // /ppp/secret/remove
    ]);

    await withMockServer(handler, async (port) => {
      const result = await pppoeDelete({ ...CONN, port }, { name: 'client1' });
      expect(result.deleted).toBe(true);
      expect(result.name).toBe('client1');
    });
  });

  test('throws when secret not found', async () => {
    const handler = sequenceServer([
      [['!done']],   // login
      [['!done']],   // /ppp/secret/print — no !re, not found
    ]);

    await withMockServer(handler, async (port) => {
      await expect(
        pppoeDelete({ ...CONN, port }, { name: 'nonexistent' }),
      ).rejects.toThrow('not found');
    });
  });

  test('throws when name is missing', async () => {
    await expect(pppoeDelete(CONN, {})).rejects.toThrow('name is required');
  });
});

describe('queueSet', () => {
  test('updates an existing queue', async () => {
    const handler = sequenceServer([
      [['!done']],                                          // login
      [['!re', '=.id=*2', '=name=client1'], ['!done']],   // /queue/simple/print
      [['!done', '=ret=*2']],                               // /queue/simple/set
    ]);

    await withMockServer(handler, async (port) => {
      const result = await queueSet(
        { ...CONN, port },
        { name: 'client1', target: '10.0.0.5/32', maxLimit: '10M/5M' },
      );
      expect(result.created).toBe(false);
    });
  });

  test('creates a new queue when one does not exist', async () => {
    const handler = sequenceServer([
      [['!done']],          // login
      [['!done']],          // /queue/simple/print — no !re
      [['!done', '=ret=*9']], // /queue/simple/add
    ]);

    await withMockServer(handler, async (port) => {
      const result = await queueSet(
        { ...CONN, port },
        { name: 'newclient', target: '10.0.0.8/32', maxLimit: '20M/10M' },
      );
      expect(result.created).toBe(true);
      expect(result.id).toBe('*9');
    });
  });

  test('throws when name is missing', async () => {
    await expect(queueSet(CONN, { target: '10.0.0.1/32' })).rejects.toThrow('name is required');
  });

  test('throws when target is missing', async () => {
    await expect(queueSet(CONN, { name: 'q1' })).rejects.toThrow('target is required');
  });
});

describe('addressListAdd', () => {
  test('adds an address to a list and returns id', async () => {
    const handler = sequenceServer([
      [['!done']],              // login
      [['!done', '=ret=*7']],  // /ip/firewall/address-list/add
    ]);

    await withMockServer(handler, async (port) => {
      const result = await addressListAdd(
        { ...CONN, port },
        { list: 'blocked', address: '1.2.3.4', comment: 'manual block' },
      );
      expect(result.id).toBe('*7');
    });
  });

  test('throws when list is missing', async () => {
    await expect(addressListAdd(CONN, { address: '1.2.3.4' })).rejects.toThrow('list is required');
  });

  test('throws when address is missing', async () => {
    await expect(addressListAdd(CONN, { list: 'blocked' })).rejects.toThrow('address is required');
  });
});

describe('addressListRemove', () => {
  test('removes an address from a list', async () => {
    const handler = sequenceServer([
      [['!done']],                                                      // login
      [['!re', '=.id=*4', '=list=blocked', '=address=1.2.3.4'], ['!done']], // print
      [['!done']],                                                      // remove
    ]);

    await withMockServer(handler, async (port) => {
      const result = await addressListRemove(
        { ...CONN, port },
        { list: 'blocked', address: '1.2.3.4' },
      );
      expect(result.deleted).toBe(true);
      expect(result.address).toBe('1.2.3.4');
    });
  });

  test('throws when entry is not found', async () => {
    const handler = sequenceServer([
      [['!done']], // login
      [['!done']], // print — no !re
    ]);

    await withMockServer(handler, async (port) => {
      await expect(
        addressListRemove({ ...CONN, port }, { list: 'blocked', address: '9.9.9.9' }),
      ).rejects.toThrow('not found');
    });
  });

  test('throws when list is missing', async () => {
    await expect(addressListRemove(CONN, { address: '1.1.1.1' })).rejects.toThrow('list is required');
  });

  test('throws when address is missing', async () => {
    await expect(addressListRemove(CONN, { list: 'blocked' })).rejects.toThrow('address is required');
  });
});

// =============================================================================
// handlers export (FireRelay integration)
// =============================================================================

describe('handlers', () => {
  test('exports all six expected methods', () => {
    expect(typeof handlers['pppoe.create']).toBe('function');
    expect(typeof handlers['pppoe.delete']).toBe('function');
    expect(typeof handlers['queue.set']).toBe('function');
    expect(typeof handlers['addressList.add']).toBe('function');
    expect(typeof handlers['addressList.remove']).toBe('function');
    expect(typeof handlers['config.backup']).toBe('function');
  });

  test('pppoe.create handler uses conn from params', async () => {
    const handler = sequenceServer([
      [['!done']],             // login
      [['!done', '=ret=*1']], // add
    ]);

    await withMockServer(handler, async (port) => {
      const result = await handlers['pppoe.create']({
        host: '127.0.0.1',
        port,
        user: 'admin',
        password: 'secret',
        name: 'u1',
        secretPassword: 'pw1',
      });
      expect(result.id).toBe('*1');
    });
  });

  test('handlers reject on missing conn params', async () => {
    await expect(
      handlers['pppoe.create']({ user: 'admin', password: 'x', name: 'u', secretPassword: 'p' }),
    ).rejects.toThrow('host is required');
  });

  test('config.backup handler uses conn from params', async () => {
    const line1 = '# RouterOS export';
    const line2 = '/system identity set name=R1';
    const mockHandler = sequenceServer([
      [['!done']],                                // login
      [['!re', `=ret=${line1}`], ['!re', `=ret=${line2}`], ['!done']], // /export
    ]);

    await withMockServer(mockHandler, async (port) => {
      const result = await handlers['config.backup']({
        host: '127.0.0.1',
        port,
        user: 'admin',
        password: 'secret',
      });
      expect(result.configType).toBe('mikrotik_export');
      expect(result.content).toContain(line1);
      expect(result.content).toContain(line2);
    });
  });
});

// =============================================================================
// configBackup
// =============================================================================

const BACKUP_CONN = { host: '127.0.0.1', user: 'admin', password: 'secret' };

describe('configBackup', () => {
  test('collects !re ret lines and returns combined content', async () => {
    const lines = ['# RouterOS config', '/ip address add address=192.168.1.1/24 interface=ether1'];
    const mockHandler = sequenceServer([
      [['!done']], // login
      [
        ['!re', `=ret=${lines[0]}`],
        ['!re', `=ret=${lines[1]}`],
        ['!done'],
      ],
    ]);

    await withMockServer(mockHandler, async (port) => {
      const result = await configBackup({ ...BACKUP_CONN, port }, {});
      expect(result.configType).toBe('mikrotik_export');
      expect(result.content).toBe(lines.join('\n'));
    });
  });

  test('uses mikrotik_compact type when compact=true', async () => {
    const mockHandler = sequenceServer([
      [['!done']],  // login
      [['!re', '=ret=/ip/address/add...'], ['!done']],
    ]);

    await withMockServer(mockHandler, async (port) => {
      const result = await configBackup({ ...BACKUP_CONN, port }, { compact: true });
      expect(result.configType).toBe('mikrotik_compact');
    });
  });

  test('returns empty content when router sends no !re lines', async () => {
    const mockHandler = sequenceServer([
      [['!done']], // login
      [['!done']], // /export — no data lines
    ]);

    await withMockServer(mockHandler, async (port) => {
      const result = await configBackup({ ...BACKUP_CONN, port }, {});
      expect(result.content).toBe('');
    });
  });

  test('ignores sentences without =ret= attribute', async () => {
    const mockHandler = sequenceServer([
      [['!done']], // login
      [
        ['!re', '=other=value'],     // no =ret=
        ['!re', '=ret=valid line'],  // has =ret=
        ['!done'],
      ],
    ]);

    await withMockServer(mockHandler, async (port) => {
      const result = await configBackup({ ...BACKUP_CONN, port }, {});
      expect(result.content).toBe('valid line');
    });
  });
});

// =============================================================================
// encodeWord — 3-byte length prefix branch (len >= 0x4000 = 16384)
// =============================================================================

describe('encodeWord — multi-byte prefix branches', () => {
  test('encodes word of 16384 bytes with 3-byte prefix (0xc0 marker)', () => {
    // len = 0x4000, first encoded byte = (0x4000 >> 16) | 0xc0 = 0xc0
    // But 0x4000 >> 16 = 0, so first byte = 0xc0, second = 0x40, third = 0x00
    const word = 'z'.repeat(16384);
    const buf = encodeWord(word);
    // 3-byte header: 0xc0, 0x40, 0x00
    expect(buf[0]).toBe(0xc0);
    expect(buf[1]).toBe(0x40);
    expect(buf[2]).toBe(0x00);
    expect(buf.length).toBe(16387); // 3 header + 16384 data
  });

  test('round-trips 3-byte-prefix word through readWord', () => {
    const word = 'a'.repeat(16384);
    const buf = encodeWord(word);
    const result = readWord(buf, 0);
    expect(result).not.toBeNull();
    expect(result.word.length).toBe(16384);
    expect(result.word[0]).toBe('a');
    expect(result.nextOffset).toBe(buf.length);
  });

  test('readWord returns null when 3-byte prefix word has insufficient data', () => {
    // Craft a 3-byte prefix header for len=16384 but provide no data
    const header = Buffer.from([0xc0, 0x40, 0x00]);
    const result = readWord(header, 0);
    expect(result).toBeNull();
  });
});

// =============================================================================
// readWord — 4-byte and 5-byte prefix branches (crafted raw bytes)
// =============================================================================

describe('readWord — 4-byte and 5-byte prefix parsing', () => {
  test('reads a 4-byte-prefix word (0xe0 marker)', () => {
    // Build a word with len=3 using 4-byte header: 0xe0, 0x00, 0x00, 0x03
    // This is the 0xe0 branch: b0 & 0xf0 === 0xe0
    const header = Buffer.from([0xe0, 0x00, 0x00, 0x03]);
    const data = Buffer.from('abc');
    const terminator = Buffer.from([0x00]);
    const buf = Buffer.concat([header, data, terminator]);
    const result = readWord(buf, 0);
    expect(result).not.toBeNull();
    expect(result.word).toBe('abc');
    expect(result.nextOffset).toBe(7); // 4 header + 3 data
  });

  test('readWord returns null when 4-byte prefix header is incomplete', () => {
    // Only 3 bytes provided but 4-byte header needs offset+4
    const buf = Buffer.from([0xe0, 0x00, 0x00]); // incomplete 4-byte header
    expect(readWord(buf, 0)).toBeNull();
  });

  test('reads a 5-byte-prefix word (0xf0 marker)', () => {
    // 5-byte header: first byte 0xf0, then 4 bytes of length
    // len = 3 => bytes: 0xf0, 0x00, 0x00, 0x00, 0x03
    const header = Buffer.from([0xf0, 0x00, 0x00, 0x00, 0x03]);
    const data = Buffer.from('xyz');
    const buf = Buffer.concat([header, data]);
    const result = readWord(buf, 0);
    expect(result).not.toBeNull();
    expect(result.word).toBe('xyz');
    expect(result.nextOffset).toBe(8); // 5 header + 3 data
  });

  test('readWord returns null when 5-byte prefix header is incomplete', () => {
    const buf = Buffer.from([0xf0, 0x00, 0x00]); // only 3 bytes
    expect(readWord(buf, 0)).toBeNull();
  });

  test('readWord returns null when data follows 5-byte prefix but is shorter than len', () => {
    // len=100 but only 2 bytes of data after 5-byte header
    const header = Buffer.from([0xf0, 0x00, 0x00, 0x00, 0x64]); // len=100
    const data = Buffer.from('hi'); // only 2 bytes
    const buf = Buffer.concat([header, data]);
    expect(readWord(buf, 0)).toBeNull();
  });
});

// =============================================================================
// parseSentences — standalone parser
// =============================================================================

describe('parseSentences', () => {
  test('parses a single complete sentence from buffer', () => {
    const buf = encodeSentence(['/ppp/secret/print', '?name=user1']);
    const { sentences, remaining } = parseSentences(buf);
    expect(sentences).toHaveLength(1);
    expect(sentences[0]).toEqual(['/ppp/secret/print', '?name=user1']);
    expect(remaining.length).toBe(0);
  });

  test('parses multiple sentences', () => {
    const s1 = encodeSentence(['!re', '=.id=*1', '=name=user1']);
    const s2 = encodeSentence(['!done']);
    const buf = Buffer.concat([s1, s2]);
    const { sentences } = parseSentences(buf);
    expect(sentences).toHaveLength(2);
    expect(sentences[0][0]).toBe('!re');
    expect(sentences[1][0]).toBe('!done');
  });

  test('returns remaining bytes when sentence is incomplete', () => {
    // Only a partial sentence (word without terminator)
    const partial = encodeWord('/login');
    const { sentences, remaining } = parseSentences(partial);
    expect(sentences).toHaveLength(0);
    expect(remaining.length).toBe(partial.length);
  });

  test('handles empty buffer', () => {
    const { sentences, remaining } = parseSentences(Buffer.alloc(0));
    expect(sentences).toHaveLength(0);
    expect(remaining.length).toBe(0);
  });
});

// =============================================================================
// findPppoeSecretId, findQueueId, findAddressListEntryId — internal helpers
// Tested indirectly via pppoeDelete, queueSet, and addressListRemove which
// call these internal functions through mock-server round-trips.
// =============================================================================

describe('findPppoeSecretId — via pppoeDelete (not-found branch)', () => {
  test('pppoeDelete handles !re sentence without .id attribute', async () => {
    // findPppoeSecretId: if sentence is !re but has no .id, returns null
    const handler = sequenceServer([
      [['!done']],                    // login
      [['!re', '=name=user1'], ['!done']], // print — no .id attr
    ]);
    await withMockServer(handler, async (port) => {
      await expect(
        pppoeDelete({ ...CONN, port }, { name: 'user1' }),
      ).rejects.toThrow('not found');
    });
  });

  test('findPppoeSecretId returns id from !re sentence', async () => {
    // Verified indirectly: pppoeDelete succeeds when !re has .id
    const handler = sequenceServer([
      [['!done']],                                          // login
      [['!re', '=.id=*5', '=name=user1'], ['!done']],      // print — found
      [['!done']],                                          // remove
    ]);
    await withMockServer(handler, async (port) => {
      const result = await pppoeDelete({ ...CONN, port }, { name: 'user1' });
      expect(result.deleted).toBe(true);
    });
  });
});

describe('findQueueId — via queueSet (not-found creates new)', () => {
  test('findQueueId returns null when !re has no .id (creates queue)', async () => {
    const handler = sequenceServer([
      [['!done']],                                   // login
      [['!re', '=name=q1'], ['!done']],              // queue print — no .id
      [['!done', '=ret=*99']],                       // queue add
    ]);
    await withMockServer(handler, async (port) => {
      const result = await queueSet({ ...CONN, port }, { name: 'q1', target: '10.0.0.1/32' });
      expect(result.created).toBe(true);
    });
  });
});

describe('findAddressListEntryId — via addressListRemove (not-found error)', () => {
  test('findAddressListEntryId returns null when !re has no .id', async () => {
    const handler = sequenceServer([
      [['!done']],                                          // login
      [['!re', '=list=blocked', '=address=9.9.9.9'], ['!done']], // print — no .id
    ]);
    await withMockServer(handler, async (port) => {
      await expect(
        addressListRemove({ ...CONN, port }, { list: 'blocked', address: '9.9.9.9' }),
      ).rejects.toThrow('not found');
    });
  });
});
