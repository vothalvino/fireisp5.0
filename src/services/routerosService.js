// =============================================================================
// FireISP 5.0 — RouterOS API Service
// =============================================================================
// Implements a minimal RouterOS API client (TCP, port 8728) and exposes the
// five command functions used by the FireRelay agent:
//
//   pppoeCreate      — /ppp/secret/add
//   pppoeDelete      — /ppp/secret/remove
//   queueSet         — /queue/simple/set (or /add if not found)
//   addressListAdd   — /ip/firewall/address-list/add
//   addressListRemove— /ip/firewall/address-list/remove
//
// All functions accept a connection-descriptor object as their first argument:
//   { host, port?, user, password }
//
// Protocol reference: MikroTik RouterOS API (port 8728)
//   - Each "sentence" is a list of length-prefixed words, terminated by ""
//   - Login: /login =name=<user> =password=<pass>
//   - Commands: /path/to/command [=attr=value …] [?query …]
//   - Responses: !re (data), !done (success), !trap (error), !fatal (fatal)
// =============================================================================

const net = require('net');
const tls = require('tls');
const logger = require('../utils/logger').child({ service: 'routerosService' });

// Default RouterOS API port (plain)
const DEFAULT_PORT = 8728;
// Default RouterOS API-SSL port (TLS)
const DEFAULT_TLS_PORT = 8729;
// Default connection + command timeout (ms)
const DEFAULT_TIMEOUT_MS = 10000;

// =============================================================================
// Protocol helpers
// =============================================================================

/**
 * Encode a single RouterOS API word as a length-prefixed Buffer.
 * @param {string} word
 * @returns {Buffer}
 */
function encodeWord(word) {
  const wordBuf = Buffer.from(word, 'utf8');
  const len = wordBuf.length;
  let lenBuf;

  if (len < 0x80) {
    lenBuf = Buffer.from([len]);
  } else if (len < 0x4000) {
    lenBuf = Buffer.from([(len >> 8) | 0x80, len & 0xff]);
  } else if (len < 0x200000) {
    lenBuf = Buffer.from([(len >> 16) | 0xc0, (len >> 8) & 0xff, len & 0xff]);
  } else if (len < 0x10000000) {
    lenBuf = Buffer.from([
      (len >> 24) | 0xe0,
      (len >> 16) & 0xff,
      (len >> 8) & 0xff,
      len & 0xff,
    ]);
  } else {
    lenBuf = Buffer.from([
      0xf0,
      (len >> 24) & 0xff,
      (len >> 16) & 0xff,
      (len >> 8) & 0xff,
      len & 0xff,
    ]);
  }

  return Buffer.concat([lenBuf, wordBuf]);
}

/**
 * Encode a complete RouterOS sentence (array of words) into a Buffer.
 * The sentence is terminated with a zero-length word.
 * @param {string[]} words
 * @returns {Buffer}
 */
function encodeSentence(words) {
  const parts = words.map(encodeWord);
  // Zero-length terminator
  parts.push(Buffer.from([0x00]));
  return Buffer.concat(parts);
}

/**
 * Read a single length-prefixed word from a Buffer at a given offset.
 * Returns { word: string, nextOffset: number } or null if not enough data.
 * @param {Buffer} buf
 * @param {number} offset
 * @returns {{ word: string, nextOffset: number } | null}
 */
function readWord(buf, offset) {
  if (offset >= buf.length) return null;

  let len;
  let headerBytes;
  const b0 = buf[offset];

  if ((b0 & 0x80) === 0) {
    len = b0;
    headerBytes = 1;
  } else if ((b0 & 0xc0) === 0x80) {
    if (buf.length < offset + 2) return null;
    len = ((b0 & 0x3f) << 8) | buf[offset + 1];
    headerBytes = 2;
  } else if ((b0 & 0xe0) === 0xc0) {
    if (buf.length < offset + 3) return null;
    len = ((b0 & 0x1f) << 16) | (buf[offset + 1] << 8) | buf[offset + 2];
    headerBytes = 3;
  } else if ((b0 & 0xf0) === 0xe0) {
    if (buf.length < offset + 4) return null;
    len =
      ((b0 & 0x0f) << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3];
    headerBytes = 4;
  } else {
    if (buf.length < offset + 5) return null;
    len =
      (buf[offset + 1] << 24) |
      (buf[offset + 2] << 16) |
      (buf[offset + 3] << 8) |
      buf[offset + 4];
    headerBytes = 5;
  }

  if (buf.length < offset + headerBytes + len) return null;

  const word = buf.slice(offset + headerBytes, offset + headerBytes + len).toString('utf8');
  return { word, nextOffset: offset + headerBytes + len };
}

/**
 * Parse as many complete sentences as possible from a Buffer.
 * Returns { sentences: string[][], remaining: Buffer }.
 * @param {Buffer} buf
 * @returns {{ sentences: string[][], remaining: Buffer }}
 */
function parseSentences(buf) {
  const sentences = [];
  let offset = 0;

  for (;;) {
    const sentence = [];
    const startOffset = offset;

    for (;;) {
      const result = readWord(buf, offset);
      if (result === null) {
        // Not enough data — return what we have so far
        return { sentences, remaining: buf.slice(startOffset) };
      }
      if (result.word === '') {
        // End of sentence
        offset = result.nextOffset;
        sentences.push(sentence);
        break;
      }
      sentence.push(result.word);
      offset = result.nextOffset;
    }
  }
}

// =============================================================================
// RouterOSClient
// =============================================================================

/**
 * Lightweight RouterOS API client.
 * Usage:
 *   const client = new RouterOSClient({ host, port, user, password });
 *   await client.connect();
 *   const result = await client.run('/ppp/secret/print', ['?name=myuser']);
 *   await client.close();
 */
class RouterOSClient {
  /**
   * @param {object} opts
   * @param {string} opts.host
   * @param {number} [opts.port]
   * @param {string} opts.user
   * @param {string} opts.password
   * @param {number} [opts.timeoutMs]
   * @param {boolean} [opts.secure]           - Use TLS (API-SSL) instead of plain TCP
   * @param {boolean} [opts.rejectUnauthorized] - Validate server certificate (default false)
   */
  constructor({ host, port, user, password, timeoutMs, secure, rejectUnauthorized } = {}) {
    this.host = host;
    this.secure = !!secure;
    // Plain default 8728; TLS default 8729 when no explicit port is supplied.
    this.port = port || (this.secure ? DEFAULT_TLS_PORT : DEFAULT_PORT);
    this.user = user;
    this.password = password;
    this.timeoutMs = timeoutMs || DEFAULT_TIMEOUT_MS;
    // RouterOS devices commonly use self-signed certificates, so default to not
    // rejecting unauthorized certs unless the caller explicitly opts in.
    this.rejectUnauthorized = rejectUnauthorized === true;

    /** @type {net.Socket|null} */
    this._socket = null;
    /** @type {Buffer} */
    this._buf = Buffer.alloc(0);
    /** @type {Array<{resolve: Function, reject: Function}>} */
    this._pending = [];
    this._currentSentences = [];
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Open TCP connection and authenticate with RouterOS.
   * @returns {Promise<void>}
   */
  connect() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._socket) this._socket.destroy();
        reject(new Error(`RouterOS connect timeout to ${this.host}:${this.port}`));
      }, this.timeoutMs);

      // 'secureConnect' for TLS, 'connect' for plain TCP — the event that
      // signals the transport is established and ready for I/O.
      let socket;
      let readyEvent;
      if (this.secure) {
        socket = tls.connect({
          host: this.host,
          port: this.port,
          rejectUnauthorized: this.rejectUnauthorized,
        });
        readyEvent = 'secureConnect';
      } else {
        socket = net.createConnection({ host: this.host, port: this.port });
        readyEvent = 'connect';
      }
      this._socket = socket;

      socket.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      socket.on(readyEvent, () => {
        clearTimeout(timer);
        socket.removeAllListeners('error');

        socket.on('data', (chunk) => this._onData(chunk));
        socket.on('error', (err) => this._onSocketError(err));
        socket.on('close', () => this._onClose());

        // Authenticate
        this._login().then(resolve).catch(reject);
      });
    });
  }

  /**
   * Close the TCP connection.
   * @returns {Promise<void>}
   */
  close() {
    return new Promise((resolve) => {
      if (!this._socket) {
        resolve();
        return;
      }
      this._socket.once('close', resolve);
      this._socket.destroy();
      this._socket = null;
    });
  }

  // ─── Login ─────────────────────────────────────────────────────────────────

  async _login() {
    // RouterOS 6.43+ direct-password login
    let response;
    try {
      response = await this._sendSentence([
        '/login',
        `=name=${this.user}`,
        `=password=${this.password}`,
      ]);
    } catch (err) {
      if (this._socket) this._socket.destroy();
      this._socket = null;
      throw err;
    }

    const first = response[0] || [];
    if (first[0] === '!done') return; // success

    if (this._socket) this._socket.destroy();
    this._socket = null;

    if (first[0] === '!trap') {
      const msg = first.find((w) => w.startsWith('=message='));
      throw new Error(`RouterOS login failed: ${msg ? msg.slice(9) : 'unknown error'}`);
    }

    throw new Error(`RouterOS login unexpected response: ${JSON.stringify(first)}`);
  }

  // ─── Command execution ─────────────────────────────────────────────────────

  /**
   * Send a RouterOS command sentence and collect all response sentences until !done.
   * Returns an array of sentences (each sentence is an array of words).
   *
   * @param {string[]} words  - Command words (e.g. ['/ppp/secret/print', '?name=foo'])
   * @returns {Promise<string[][]>}
   */
  run(words) {
    return this._sendSentence(words);
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  _sendSentence(words) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove this pending entry and reject
        this._pending = this._pending.filter((p) => p.reject !== reject);
        reject(new Error(`RouterOS command timed out: ${words[0]}`));
      }, this.timeoutMs);

      this._pending.push({
        resolve,
        reject,
        timer,
        sentences: [],
      });

      try {
        this._socket.write(encodeSentence(words));
      } catch (err) {
        clearTimeout(timer);
        this._pending.pop();
        reject(err);
      }
    });
  }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);

    // Extract as many complete sentences as possible from the buffer
    let offset = 0;

    for (;;) {
      const sentence = [];
      const startOffset = offset;

      for (;;) {
        const result = readWord(this._buf, offset);
        if (result === null) {
          // Not enough data yet — keep the unprocessed bytes
          this._buf = this._buf.slice(startOffset);
          return;
        }
        if (result.word === '') {
          offset = result.nextOffset;
          // Sentence complete
          this._onSentence(sentence);
          break;
        }
        sentence.push(result.word);
        offset = result.nextOffset;
      }
    }
  }

  _onSentence(sentence) {
    const pending = this._pending[0];
    if (!pending) return;

    pending.sentences.push(sentence);

    const type = sentence[0];
    if (type === '!done' || type === '!trap' || type === '!fatal') {
      clearTimeout(pending.timer);
      this._pending.shift();

      if (type === '!done') {
        pending.resolve(pending.sentences);
      } else {
        const msg = sentence.find((w) => w.startsWith('=message='));
        pending.reject(new Error(msg ? msg.slice(9) : `RouterOS ${type}`));
      }
    }
  }

  _onSocketError(err) {
    logger.warn({ host: this.host, err: err.message }, 'RouterOS socket error');
    while (this._pending.length) {
      const p = this._pending.shift();
      clearTimeout(p.timer);
      p.reject(err);
    }
  }

  _onClose() {
    while (this._pending.length) {
      const p = this._pending.shift();
      clearTimeout(p.timer);
      p.reject(new Error('RouterOS connection closed'));
    }
  }
}

// =============================================================================
// Helper utilities
// =============================================================================

/**
 * Create a connected and authenticated RouterOSClient.
 * @param {{ host: string, port?: number, user: string, password: string, timeoutMs?: number }} conn
 * @returns {Promise<RouterOSClient>}
 */
async function createClient(conn) {
  const client = new RouterOSClient(conn);
  await client.connect();
  return client;
}

/**
 * Parse RouterOS `=key=value` attribute words into a plain object.
 * @param {string[]} words
 * @returns {Record<string, string>}
 */
function parseAttrs(words) {
  const obj = {};
  for (const word of words) {
    if (word.startsWith('=') && word.indexOf('=', 1) !== -1) {
      const eq = word.indexOf('=', 1);
      const key = word.slice(1, eq);
      const val = word.slice(eq + 1);
      obj[key] = val;
    }
  }
  return obj;
}

/**
 * Find the `.id` of a PPPoE secret by name.
 * Returns null if not found.
 * @param {RouterOSClient} client
 * @param {string} name
 * @returns {Promise<string|null>}
 */
async function findPppoeSecretId(client, name) {
  const sentences = await client.run(['/ppp/secret/print', `?name=${name}`]);
  for (const sentence of sentences) {
    if (sentence[0] === '!re') {
      const attrs = parseAttrs(sentence.slice(1));
      if (attrs['.id']) return attrs['.id'];
    }
  }
  return null;
}

/**
 * Find the `.id` of a simple queue by name.
 * Returns null if not found.
 * @param {RouterOSClient} client
 * @param {string} name
 * @returns {Promise<string|null>}
 */
async function findQueueId(client, name) {
  const sentences = await client.run(['/queue/simple/print', `?name=${name}`]);
  for (const sentence of sentences) {
    if (sentence[0] === '!re') {
      const attrs = parseAttrs(sentence.slice(1));
      if (attrs['.id']) return attrs['.id'];
    }
  }
  return null;
}

/**
 * Find the `.id` of a firewall address-list entry matching list + address.
 * Returns null if not found.
 * @param {RouterOSClient} client
 * @param {string} list
 * @param {string} address
 * @returns {Promise<string|null>}
 */
async function findAddressListEntryId(client, list, address) {
  const sentences = await client.run([
    '/ip/firewall/address-list/print',
    `?list=${list}`,
    `?address=${address}`,
  ]);
  for (const sentence of sentences) {
    if (sentence[0] === '!re') {
      const attrs = parseAttrs(sentence.slice(1));
      if (attrs['.id']) return attrs['.id'];
    }
  }
  return null;
}

// =============================================================================
// Public command functions
// =============================================================================

/**
 * Create a PPPoE secret on the router.
 *
 * @param {{ host: string, port?: number, user: string, password: string }} conn
 * @param {{ name: string, secretPassword: string, profile?: string, service?: string,
 *            localAddress?: string, remoteAddress?: string, comment?: string }} params
 * @returns {Promise<{ id: string }>}
 */
async function pppoeCreate(conn, params) {
  const { name, secretPassword, profile, service, localAddress, remoteAddress, comment } = params;

  if (!name) throw new Error('pppoeCreate: name is required');
  if (!secretPassword) throw new Error('pppoeCreate: secretPassword is required');

  const client = await createClient(conn);
  try {
    const words = [
      '/ppp/secret/add',
      `=name=${name}`,
      `=password=${secretPassword}`,
      `=service=${service || 'pppoe'}`,
    ];
    if (profile) words.push(`=profile=${profile}`);
    if (localAddress) words.push(`=local-address=${localAddress}`);
    if (remoteAddress) words.push(`=remote-address=${remoteAddress}`);
    if (comment) words.push(`=comment=${comment}`);

    const sentences = await client.run(words);
    // !done response for /add includes the new .id in =ret= word
    for (const sentence of sentences) {
      if (sentence[0] === '!done') {
        const attrs = parseAttrs(sentence.slice(1));
        const id = attrs.ret || '';
        logger.info({ name, id }, 'RouterOS: PPPoE secret created');
        return { id };
      }
    }
    return { id: '' };
  } finally {
    await client.close();
  }
}

/**
 * Create-or-update a PPPoE secret by name (idempotent provisioning).
 *
 * Looks up an existing secret by name; if found it issues /ppp/secret/set against
 * the existing .id, otherwise /ppp/secret/add. Optional attributes (profile,
 * local-address, remote-address, comment) are only sent when provided.
 *
 * @param {{ host: string, port?: number, user: string, password: string,
 *            secure?: boolean, rejectUnauthorized?: boolean, timeoutMs?: number }} conn
 * @param {{ name: string, secretPassword: string, profile?: string, service?: string,
 *            localAddress?: string, remoteAddress?: string, comment?: string }} params
 * @returns {Promise<{ id: string, created: boolean, updated: boolean }>}
 */
async function pppoeUpsert(conn, params) {
  const { name, secretPassword, profile, service, localAddress, remoteAddress, comment } = params;

  if (!name) throw new Error('pppoeUpsert: name is required');
  if (!secretPassword) throw new Error('pppoeUpsert: secretPassword is required');

  const client = await createClient(conn);
  try {
    // Shared optional attribute words for both create and update paths.
    const attrWords = [
      `=password=${secretPassword}`,
      `=service=${service || 'pppoe'}`,
    ];
    if (profile) attrWords.push(`=profile=${profile}`);
    if (localAddress) attrWords.push(`=local-address=${localAddress}`);
    if (remoteAddress) attrWords.push(`=remote-address=${remoteAddress}`);
    if (comment) attrWords.push(`=comment=${comment}`);

    const existingId = await findPppoeSecretId(client, name);

    if (existingId) {
      // Update existing secret in place.
      await client.run([
        '/ppp/secret/set',
        `=.id=${existingId}`,
        `=name=${name}`,
        ...attrWords,
      ]);
      logger.info({ name, id: existingId }, 'RouterOS: PPPoE secret updated');
      return { id: existingId, created: false, updated: true };
    }

    // Create a new secret and read the assigned .id from the !done =ret= word.
    const sentences = await client.run([
      '/ppp/secret/add',
      `=name=${name}`,
      ...attrWords,
    ]);
    let newId = '';
    for (const sentence of sentences) {
      if (sentence[0] === '!done') {
        newId = parseAttrs(sentence.slice(1)).ret || '';
        break;
      }
    }
    logger.info({ name, id: newId }, 'RouterOS: PPPoE secret created');
    return { id: newId, created: true, updated: false };
  } finally {
    await client.close();
  }
}

/**
 * Delete a PPPoE secret by name.
 *
 * @param {{ host: string, port?: number, user: string, password: string }} conn
 * @param {{ name: string }} params
 * @returns {Promise<{ deleted: boolean, name: string }>}
 */
async function pppoeDelete(conn, params) {
  const { name } = params;
  if (!name) throw new Error('pppoeDelete: name is required');

  const client = await createClient(conn);
  try {
    const id = await findPppoeSecretId(client, name);
    if (!id) {
      throw new Error(`PPPoE secret "${name}" not found`);
    }
    await client.run(['/ppp/secret/remove', `=.id=${id}`]);
    logger.info({ name, id }, 'RouterOS: PPPoE secret deleted');
    return { deleted: true, name };
  } finally {
    await client.close();
  }
}

/**
 * Set bandwidth limits on a simple queue by name (creates the queue if it doesn't exist).
 *
 * @param {{ host: string, port?: number, user: string, password: string }} conn
 * @param {{ name: string, target: string, maxLimit?: string, burstLimit?: string,
 *            burstThreshold?: string, burstTime?: string, comment?: string }} params
 *  maxLimit / burstLimit format: "<download>/<upload>" e.g. "10M/5M"
 * @returns {Promise<{ id: string, created: boolean }>}
 */
async function queueSet(conn, params) {
  const { name, target, maxLimit, burstLimit, burstThreshold, burstTime, comment } = params;

  if (!name) throw new Error('queueSet: name is required');
  if (!target) throw new Error('queueSet: target is required');

  const client = await createClient(conn);
  try {
    const existingId = await findQueueId(client, name);

    const attrWords = [];
    if (maxLimit) attrWords.push(`=max-limit=${maxLimit}`);
    if (burstLimit) attrWords.push(`=burst-limit=${burstLimit}`);
    if (burstThreshold) attrWords.push(`=burst-threshold=${burstThreshold}`);
    if (burstTime) attrWords.push(`=burst-time=${burstTime}`);
    if (comment) attrWords.push(`=comment=${comment}`);

    let id;
    let created;

    if (existingId) {
      // Update existing queue
      const sentences = await client.run([
        '/queue/simple/set',
        `=.id=${existingId}`,
        `=name=${name}`,
        `=target=${target}`,
        ...attrWords,
      ]);
      const done = sentences.find((s) => s[0] === '!done');
      id = done ? (parseAttrs(done.slice(1)).ret || existingId) : existingId;
      created = false;
    } else {
      // Create new queue
      const sentences = await client.run([
        '/queue/simple/add',
        `=name=${name}`,
        `=target=${target}`,
        ...attrWords,
      ]);
      const done = sentences.find((s) => s[0] === '!done');
      id = done ? (parseAttrs(done.slice(1)).ret || '') : '';
      created = true;
    }

    logger.info({ name, target, id, created }, 'RouterOS: queue set');
    return { id, created };
  } finally {
    await client.close();
  }
}

/**
 * Add an address to a firewall address-list.
 *
 * @param {{ host: string, port?: number, user: string, password: string }} conn
 * @param {{ list: string, address: string, comment?: string, timeout?: string }} params
 *  timeout: RouterOS timeout format e.g. "1d" — omit for permanent entry
 * @returns {Promise<{ id: string }>}
 */
async function addressListAdd(conn, params) {
  const { list, address, comment, timeout } = params;

  if (!list) throw new Error('addressListAdd: list is required');
  if (!address) throw new Error('addressListAdd: address is required');

  const client = await createClient(conn);
  try {
    const words = [
      '/ip/firewall/address-list/add',
      `=list=${list}`,
      `=address=${address}`,
    ];
    if (comment) words.push(`=comment=${comment}`);
    if (timeout) words.push(`=timeout=${timeout}`);

    const sentences = await client.run(words);
    const done = sentences.find((s) => s[0] === '!done');
    const id = done ? (parseAttrs(done.slice(1)).ret || '') : '';

    logger.info({ list, address, id }, 'RouterOS: address-list entry added');
    return { id };
  } finally {
    await client.close();
  }
}

/**
 * Export the running configuration from a RouterOS device.
 *
 * Uses /export (or /export with =compact=yes for compact output).
 * Each !re sentence in the response contributes a line to the configuration
 * text via its =ret= attribute.
 *
 * @param {{ host: string, port?: number, user: string, password: string }} conn
 * @param {{ compact?: boolean }} params
 * @returns {Promise<{ content: string, configType: string }>}
 */
async function configBackup(conn, params = {}) {
  const { compact = false } = params;

  const client = await createClient(conn);
  try {
    const words = compact ? ['/export', '=compact=yes'] : ['/export'];
    const sentences = await client.run(words);

    const lines = [];
    for (const sentence of sentences) {
      if (sentence[0] === '!re') {
        const attrs = parseAttrs(sentence.slice(1));
        if (attrs.ret !== undefined) {
          lines.push(attrs.ret);
        }
      }
    }

    const content = lines.join('\n');
    const configType = compact ? 'mikrotik_compact' : 'mikrotik_export';

    logger.info({ host: conn.host, configType, lines: lines.length }, 'RouterOS: config export complete');
    return { content, configType };
  } finally {
    await client.close();
  }
}

/**
 * Remove an address from a firewall address-list.
 *
 * @param {{ host: string, port?: number, user: string, password: string }} conn
 * @param {{ list: string, address: string }} params
 * @returns {Promise<{ deleted: boolean, list: string, address: string }>}
 */
async function addressListRemove(conn, params) {
  const { list, address } = params;

  if (!list) throw new Error('addressListRemove: list is required');
  if (!address) throw new Error('addressListRemove: address is required');

  const client = await createClient(conn);
  try {
    const id = await findAddressListEntryId(client, list, address);
    if (!id) {
      throw new Error(`Address-list entry "${address}" in list "${list}" not found`);
    }
    await client.run(['/ip/firewall/address-list/remove', `=.id=${id}`]);

    logger.info({ list, address, id }, 'RouterOS: address-list entry removed');
    return { deleted: true, list, address };
  } finally {
    await client.close();
  }
}

// =============================================================================
// FireRelay handler wrappers
// =============================================================================
// Each wrapper extracts the router connection details from the flat params
// object sent over the tunnel and delegates to the command function above.

/**
 * Build a RouterOS connection descriptor from FireRelay command params.
 * The agent script passes: host, port (optional), user, password.
 * @param {object} params
 * @returns {{ host: string, port?: number, user: string, password: string }}
 */
function connFromParams(params) {
  const { host, port, user, password } = params;
  if (!host) throw new Error('host is required');
  if (!user) throw new Error('user is required');
  if (password === undefined || password === null) throw new Error('password is required');
  return { host, port: port ? Number(port) : DEFAULT_PORT, user, password };
}

const handlers = {
  'pppoe.create': async (params) => {
    const conn = connFromParams(params);
    return pppoeCreate(conn, params);
  },
  'pppoe.delete': async (params) => {
    const conn = connFromParams(params);
    return pppoeDelete(conn, params);
  },
  'queue.set': async (params) => {
    const conn = connFromParams(params);
    return queueSet(conn, params);
  },
  'addressList.add': async (params) => {
    const conn = connFromParams(params);
    return addressListAdd(conn, params);
  },
  'addressList.remove': async (params) => {
    const conn = connFromParams(params);
    return addressListRemove(conn, params);
  },
  'config.backup': async (params) => {
    const conn = connFromParams(params);
    return configBackup(conn, params);
  },
};

module.exports = {
  RouterOSClient,
  encodeSentence,
  encodeWord,
  readWord,
  parseSentences,
  parseAttrs,
  createClient,
  pppoeCreate,
  pppoeUpsert,
  pppoeDelete,
  queueSet,
  addressListAdd,
  addressListRemove,
  configBackup,
  handlers,
  connFromParams,
  DEFAULT_PORT,
  DEFAULT_TLS_PORT,
};
