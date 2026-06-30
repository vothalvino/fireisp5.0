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
        const err = new Error(`RouterOS connect timeout to ${this.host}:${this.port}`);
        // A connect that never completes = transport unreachable, so provisioning
        // callers map it to 502 / fall back to a snippet rather than a hard error.
        err.routerUnreachable = true;
        reject(err);
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
        // Destroy the half-open socket before rejecting so a failed connect
        // (refused / TLS handshake error) never leaks a file descriptor — the
        // caller awaits createClient() outside its try/finally, so it has no
        // client handle to close on this path.
        socket.destroy();
        // A connect-phase failure (EHOSTUNREACH / ECONNREFUSED / ENETUNREACH /
        // TLS handshake, etc.) means the transport never came up — the device is
        // unreachable. Tag it so provisioning callers surface a clean "router
        // unreachable" (502) or fall back to the paste-once snippet, instead of a
        // raw "connect EHOSTUNREACH". Critical for a NATed NAS: its API IP only
        // becomes reachable AFTER the WG tunnel that bootstrap is setting up, so
        // the first bootstrap MUST degrade to a snippet. The specific cause is
        // preserved in err.message (stored as the tunnel's last_error).
        err.routerUnreachable = true;
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
      const socket = this._socket;
      this._socket = null;
      // If the socket is gone or already destroyed (e.g. the peer dropped the
      // connection mid-operation and it has already emitted 'close'), destroy()
      // would be a no-op and would NOT re-emit 'close' — awaiting that event
      // would hang the caller's `finally { await client.close() }` forever. So
      // resolve immediately on that path instead.
      if (!socket || socket.destroyed) {
        resolve();
        return;
      }
      socket.once('close', resolve);
      socket.destroy();
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
      // A !trap/!fatal reply to /login surfaces here as a rejection (see
      // _onSentence) and means the device is reachable but rejected our
      // credentials — a misconfiguration the operator must fix (422). A transport
      // failure OR a no-reply timeout mid-login is already tagged routerUnreachable
      // (→ 502), so only the credential-rejection case falls through to here.
      if (!err.routerUnreachable) err.routerAuthFailed = true;
      throw err;
    }

    const first = response[0] || [];
    if (first[0] === '!done') return; // success

    if (this._socket) this._socket.destroy();
    this._socket = null;

    if (first[0] === '!trap') {
      const msg = first.find((w) => w.startsWith('=message='));
      const err = new Error(`RouterOS login failed: ${msg ? msg.slice(9) : 'unknown error'}`);
      err.routerAuthFailed = true;
      throw err;
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
        const err = new Error(`RouterOS command timed out: ${words[0]}`);
        // No reply within the timeout = the device isn't responding. Treat it as
        // a transport failure (so the seed aborts to 502 and a login that hangs
        // isn't misreported as a credential rejection), not a per-command error.
        err.routerUnreachable = true;
        reject(err);
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
    // Transport-level failure — let provisioning callers surface a 502 (router
    // unreachable) instead of swallowing it as a per-command error.
    err.routerUnreachable = true;
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
      const err = new Error('RouterOS connection closed');
      err.routerUnreachable = true;
      p.reject(err);
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
 * Interpret a RouterOS API boolean field as a real boolean.
 *
 * The binary API returns booleans as the STRINGS "true"/"false" — NOT the
 * "yes"/"no" that the CLI/Winbox display. This is the single place that maps any
 * of those spellings to a boolean, so call sites never compare an API value
 * against a hard-coded string form (a recurring bug: `prev.accept === 'yes'` is
 * always false because the API returns "true"). Truthy: true / "true" / "yes";
 * everything else (false / "false" / "no" / "" / undefined / null) is false.
 *
 * @param {string|boolean|undefined|null} value
 * @returns {boolean}
 */
function rosBool(value) {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return v === 'true' || v === 'yes';
}

/**
 * Find the `.id` of the first row under `basePath` matching the given query words
 * (e.g. `?name=foo`, `?comment=bar`). Returns null when nothing matches. This is
 * the single implementation of the "run /print, scan !re sentences, return .id"
 * pattern shared by the name/comment/list lookups below and by callers.
 *
 * @param {RouterOSClient} client
 * @param {string} basePath  e.g. '/ppp/secret', '/queue/simple', '/radius'
 * @param {string[]} [queries]
 * @returns {Promise<string|null>}
 */
async function findId(client, basePath, queries = []) {
  const sentences = await client.run([`${basePath}/print`, ...queries]);
  for (const sentence of sentences) {
    if (sentence[0] === '!re') {
      const attrs = parseAttrs(sentence.slice(1));
      if (attrs['.id']) return attrs['.id'];
    }
  }
  return null;
}

/**
 * Find the `.id` of a PPPoE secret by name.
 * Returns null if not found.
 * @param {RouterOSClient} client
 * @param {string} name
 * @returns {Promise<string|null>}
 */
async function findPppoeSecretId(client, name) {
  return findId(client, '/ppp/secret', [`?name=${name}`]);
}

/**
 * Find the `.id` of a simple queue by name.
 * Returns null if not found.
 * @param {RouterOSClient} client
 * @param {string} name
 * @returns {Promise<string|null>}
 */
async function findQueueId(client, name) {
  return findId(client, '/queue/simple', [`?name=${name}`]);
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
  return findId(client, '/ip/firewall/address-list', [`?list=${list}`, `?address=${address}`]);
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
// WireGuard command functions (RouterOS 7, native /interface/wireguard)
// =============================================================================
// HARD CONSTRAINT: these five functions are the ONLY WireGuard writes FireISP
// makes to the router. They NEVER touch /ip/service (Winbox/8291 is left fully
// alone) and NEVER touch /ip/firewall. The only permitted write paths are:
//   /interface/wireguard   /ip/address   /interface/wireguard/peers   /ip/route
// =============================================================================

/**
 * Create-or-update a WireGuard interface by name (idempotent).
 * No listen-port is written — the NAS dials out to the FireISP server hub.
 *
 * @param {{ host: string, port?: number, user: string, password: string,
 *            secure?: boolean, timeoutMs?: number }} conn
 * @param {{ name: string, privateKey: string, comment?: string }} params
 * @returns {Promise<{ id: string, created: boolean, updated: boolean }>}
 */
async function wireguardInterfaceUpsert(conn, params) {
  const { name, privateKey, comment } = params;
  if (!name) throw new Error('wireguardInterfaceUpsert: name is required');
  if (!privateKey) throw new Error('wireguardInterfaceUpsert: privateKey is required');

  const client = await createClient(conn);
  try {
    const existingId = await findId(client, '/interface/wireguard', [`?name=${name}`]);

    // NOTE: privateKey is intentionally omitted from log output.
    const attrWords = [`=private-key=${privateKey}`];
    if (comment) attrWords.push(`=comment=${comment}`);

    if (existingId) {
      await client.run([
        '/interface/wireguard/set',
        `=.id=${existingId}`,
        `=name=${name}`,
        ...attrWords,
      ]);
      logger.info({ name, id: existingId }, 'RouterOS: WireGuard interface updated');
      return { id: existingId, created: false, updated: true };
    }

    const sentences = await client.run([
      '/interface/wireguard/add',
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
    logger.info({ name, id: newId }, 'RouterOS: WireGuard interface created');
    return { id: newId, created: true, updated: false };
  } finally {
    await client.close();
  }
}

/**
 * Create-or-update a WireGuard tunnel address on an interface (idempotent).
 * Looks up by interface + address; updates in place or adds if absent.
 *
 * @param {{ host: string, port?: number, user: string, password: string }} conn
 * @param {{ interface: string, address: string }} params
 *   address: full CIDR notation, e.g. "10.255.0.1/32"
 * @returns {Promise<{ id: string, created: boolean, updated: boolean }>}
 */
async function wireguardAddressUpsert(conn, params) {
  const { interface: iface, address } = params;
  if (!iface) throw new Error('wireguardAddressUpsert: interface is required');
  if (!address) throw new Error('wireguardAddressUpsert: address is required');

  const client = await createClient(conn);
  try {
    const existingId = await findId(client, '/ip/address', [
      `?interface=${iface}`,
      `?address=${address}`,
    ]);

    if (existingId) {
      await client.run([
        '/ip/address/set',
        `=.id=${existingId}`,
        `=interface=${iface}`,
        `=address=${address}`,
      ]);
      logger.info({ interface: iface, address, id: existingId }, 'RouterOS: WireGuard address updated');
      return { id: existingId, created: false, updated: true };
    }

    const sentences = await client.run([
      '/ip/address/add',
      `=interface=${iface}`,
      `=address=${address}`,
    ]);
    let newId = '';
    for (const sentence of sentences) {
      if (sentence[0] === '!done') {
        newId = parseAttrs(sentence.slice(1)).ret || '';
        break;
      }
    }
    logger.info({ interface: iface, address, id: newId }, 'RouterOS: WireGuard address created');
    return { id: newId, created: true, updated: false };
  } finally {
    await client.close();
  }
}

/**
 * Create-or-update a WireGuard peer by interface + comment (idempotent).
 * Comment is the stable lookup key so the peer survives server-side key rotation.
 *
 * @param {{ host: string, port?: number, user: string, password: string }} conn
 * @param {{ interface: string, publicKey: string, endpointAddress: string,
 *            endpointPort: number|string, allowedAddress: string,
 *            keepalive?: number, comment: string }} params
 *   allowedAddress: the server's tunnel subnet(s), e.g. "10.255.0.0/16"
 * @returns {Promise<{ id: string, created: boolean, updated: boolean }>}
 */
async function wireguardPeerUpsert(conn, params) {
  const {
    interface: iface,
    publicKey,
    endpointAddress,
    endpointPort,
    allowedAddress,
    keepalive,
    comment,
  } = params;

  if (!iface) throw new Error('wireguardPeerUpsert: interface is required');
  if (!publicKey) throw new Error('wireguardPeerUpsert: publicKey is required');
  if (!endpointAddress) throw new Error('wireguardPeerUpsert: endpointAddress is required');
  if (!endpointPort) throw new Error('wireguardPeerUpsert: endpointPort is required');
  if (!allowedAddress) throw new Error('wireguardPeerUpsert: allowedAddress is required');
  if (!comment) throw new Error('wireguardPeerUpsert: comment is required');

  const client = await createClient(conn);
  try {
    // Stable lookup: interface + comment (comment survives key rotation).
    const existingId = await findId(client, '/interface/wireguard/peers', [
      `?interface=${iface}`,
      `?comment=${comment}`,
    ]);

    const attrWords = [
      `=public-key=${publicKey}`,
      `=endpoint-address=${endpointAddress}`,
      `=endpoint-port=${endpointPort}`,
      `=allowed-address=${allowedAddress}`,
    ];
    if (keepalive !== null && keepalive !== undefined) attrWords.push(`=persistent-keepalive=${keepalive}`);

    if (existingId) {
      await client.run([
        '/interface/wireguard/peers/set',
        `=.id=${existingId}`,
        `=interface=${iface}`,
        `=comment=${comment}`,
        ...attrWords,
      ]);
      logger.info({ interface: iface, comment, id: existingId }, 'RouterOS: WireGuard peer updated');
      return { id: existingId, created: false, updated: true };
    }

    const sentences = await client.run([
      '/interface/wireguard/peers/add',
      `=interface=${iface}`,
      `=comment=${comment}`,
      ...attrWords,
    ]);
    let newId = '';
    for (const sentence of sentences) {
      if (sentence[0] === '!done') {
        newId = parseAttrs(sentence.slice(1)).ret || '';
        break;
      }
    }
    logger.info({ interface: iface, comment, id: newId }, 'RouterOS: WireGuard peer created');
    return { id: newId, created: true, updated: false };
  } finally {
    await client.close();
  }
}

/**
 * Read the WireGuard topology from the router (read-only, no writes).
 * Returns the current WireGuard interfaces, IP addresses, and connected routes.
 * Used by wgProvisioningService.discoverSubnets to propose routed_subnets.
 *
 * @param {{ host: string, port?: number, user: string, password: string }} conn
 * @returns {Promise<{ interfaces: object[], addresses: object[], routes: object[] }>}
 */
async function wireguardReadTopology(conn) {
  const client = await createClient(conn);
  try {
    // WireGuard interfaces
    const ifaceSentences = await client.run(['/interface/wireguard/print']);
    const interfaces = ifaceSentences
      .filter((s) => s[0] === '!re')
      .map((s) => parseAttrs(s.slice(1)));

    // IP addresses (all interfaces; caller filters by interface name)
    const addrSentences = await client.run(['/ip/address/print']);
    const addresses = addrSentences
      .filter((s) => s[0] === '!re')
      .map((s) => parseAttrs(s.slice(1)));

    // Connected routes. RouterOS 7's API has NO `type` field on route records;
    // connected (auto-added) routes are flagged by the boolean property `connect`
    // (CLI flag "C"), so the query is `?connect=yes`. The old `?type=connected`
    // matched zero rows on ROS7, making subnet discovery always come up empty.
    // The caller further excludes WAN/mgmt, the WG tunnel subnet, and /32 hosts.
    const routeSentences = await client.run(['/ip/route/print', '?connect=yes']);
    const routes = routeSentences
      .filter((s) => s[0] === '!re')
      .map((s) => parseAttrs(s.slice(1)));

    logger.info(
      { host: conn.host, interfaces: interfaces.length, addresses: addresses.length, routes: routes.length },
      'RouterOS: WireGuard topology read',
    );
    return { interfaces, addresses, routes };
  } finally {
    await client.close();
  }
}

/**
 * Create-or-no-op an /ip/route entry by dst-address + gateway (idempotent).
 *
 * Looks up an existing route matching both dst-address and gateway; if found,
 * returns immediately (no write). If absent, adds the route and returns the
 * assigned .id.
 *
 * HARD CONSTRAINT: only writes to /ip/route — never /ip/service or /ip/firewall.
 *
 * @param {{ host: string, port?: number, user: string, password: string }} conn
 * @param {{ dstAddress: string, gateway: string, comment?: string }} params
 * @returns {Promise<{ id: string, created: boolean, updated: boolean }>}
 */
async function wireguardRouteUpsert(conn, { dstAddress, gateway, comment } = {}) {
  if (!dstAddress) throw new Error('wireguardRouteUpsert: dstAddress is required');
  if (!gateway) throw new Error('wireguardRouteUpsert: gateway is required');

  const client = await createClient(conn);
  try {
    const existingId = await findId(client, '/ip/route', [
      `?dst-address=${dstAddress}`,
      `?gateway=${gateway}`,
    ]);

    if (existingId) {
      logger.info({ dstAddress, gateway, id: existingId }, 'RouterOS: IP route already exists (no-op)');
      return { id: existingId, created: false, updated: false };
    }

    const words = ['/ip/route/add', `=dst-address=${dstAddress}`, `=gateway=${gateway}`];
    if (comment) words.push(`=comment=${comment}`);

    const sentences = await client.run(words);
    let newId = '';
    for (const sentence of sentences) {
      if (sentence[0] === '!done') {
        newId = parseAttrs(sentence.slice(1)).ret || '';
        break;
      }
    }
    logger.info({ dstAddress, gateway, id: newId }, 'RouterOS: IP route created');
    return { id: newId, created: true, updated: false };
  } finally {
    await client.close();
  }
}

/**
 * Remove a WireGuard peer by interface + comment (idempotent — no-ops if absent).
 *
 * @param {{ host: string, port?: number, user: string, password: string }} conn
 * @param {{ interface: string, comment: string }} params
 * @returns {Promise<{ deleted: boolean, interface: string, comment: string }>}
 */
async function wireguardPeerRemove(conn, params) {
  const { interface: iface, comment } = params;
  if (!iface) throw new Error('wireguardPeerRemove: interface is required');
  if (!comment) throw new Error('wireguardPeerRemove: comment is required');

  const client = await createClient(conn);
  try {
    const existingId = await findId(client, '/interface/wireguard/peers', [
      `?interface=${iface}`,
      `?comment=${comment}`,
    ]);

    if (!existingId) {
      logger.info({ interface: iface, comment }, 'RouterOS: WireGuard peer not found (no-op remove)');
      return { deleted: false, interface: iface, comment };
    }

    await client.run(['/interface/wireguard/peers/remove', `=.id=${existingId}`]);
    logger.info({ interface: iface, comment, id: existingId }, 'RouterOS: WireGuard peer removed');
    return { deleted: true, interface: iface, comment };
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
  'wireguard.interfaceUpsert': async (params) => {
    const conn = connFromParams(params);
    return wireguardInterfaceUpsert(conn, params);
  },
  'wireguard.addressUpsert': async (params) => {
    const conn = connFromParams(params);
    return wireguardAddressUpsert(conn, params);
  },
  'wireguard.peerUpsert': async (params) => {
    const conn = connFromParams(params);
    return wireguardPeerUpsert(conn, params);
  },
  'wireguard.readTopology': async (params) => {
    const conn = connFromParams(params);
    return wireguardReadTopology(conn);
  },
  'wireguard.peerRemove': async (params) => {
    const conn = connFromParams(params);
    return wireguardPeerRemove(conn, params);
  },
  'wireguard.routeUpsert': async (params) => {
    const conn = connFromParams(params);
    return wireguardRouteUpsert(conn, params);
  },
};

module.exports = {
  RouterOSClient,
  encodeSentence,
  encodeWord,
  readWord,
  parseSentences,
  parseAttrs,
  rosBool,
  createClient,
  findId,
  pppoeCreate,
  pppoeUpsert,
  pppoeDelete,
  queueSet,
  addressListAdd,
  addressListRemove,
  configBackup,
  wireguardInterfaceUpsert,
  wireguardAddressUpsert,
  wireguardPeerUpsert,
  wireguardReadTopology,
  wireguardPeerRemove,
  wireguardRouteUpsert,
  handlers,
  connFromParams,
  DEFAULT_PORT,
  DEFAULT_TLS_PORT,
};
