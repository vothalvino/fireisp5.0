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
  parseAttrs,
  RouterOSClient,
  pppoeCreate,
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
