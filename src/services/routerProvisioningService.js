// =============================================================================
// FireISP 5.0 — Router Provisioning Service (direct RouterOS API)
// =============================================================================
// Pushes provisioning DIRECTLY to a MikroTik RouterOS device over its binary
// API (no FireRelay/proxy agent). Builds a RouterOS connection descriptor from
// a NAS row (decrypting the stored API password) and delegates to the low-level
// routerosService client.
//
// Per-NAS API connection is configurable:
//   nas.ip_address            — RouterOS host
//   nas.api_port              — API port (defaults to ros.DEFAULT_PORT / 8728)
//   nas.api_username          — API username
//   nas.api_password_encrypted— AES-256-GCM encrypted API password
//   nas.api_use_tls           — use api-ssl (TLS) transport
// =============================================================================

const ros = require('./routerosService');
const { decrypt } = require('../utils/encryption');
const { ValidationError } = require('../utils/errors');
const logger = require('../utils/logger').child({ service: 'routerProvisioningService' });

// =============================================================================
// Connection descriptor
// =============================================================================

/**
 * Build a RouterOS connection descriptor from a NAS row.
 *
 * @param {object} nas
 * @param {string} nas.ip_address
 * @param {number} [nas.api_port]
 * @param {string} nas.api_username
 * @param {string} [nas.api_password_encrypted]
 * @param {boolean|number} [nas.api_use_tls]
 * @returns {{ host: string, port: number, user: string, password: string,
 *            secure: boolean, timeoutMs: number }}
 */
function nasToConn(nas) {
  if (!nas || !nas.ip_address || !nas.api_username) {
    throw new ValidationError('NAS has no RouterOS API username configured');
  }

  return {
    host: nas.ip_address,
    // Honor an explicit api_port; when unset, default to the api-ssl port (8729)
    // for TLS connections and the plain API port (8728) otherwise.
    port: nas.api_port || (nas.api_use_tls ? ros.DEFAULT_TLS_PORT : ros.DEFAULT_PORT),
    user: nas.api_username,
    password: decrypt(nas.api_password_encrypted) || '',
    secure: !!nas.api_use_tls,
    timeoutMs: 12000,
  };
}

// =============================================================================
// Operations
// =============================================================================

/**
 * Open a connection to the NAS and read basic system info to confirm the API
 * is reachable and the credentials are valid.
 *
 * Connection errors are allowed to propagate so the calling route can map them
 * to an HTTP 502 (ROUTER_UNREACHABLE).
 *
 * @param {object} nas
 * @returns {Promise<{ ok: true, host: string, port: number, tls: boolean,
 *                     version: string, boardName: string, identity: string }>}
 */
async function testConnection(nas) {
  const conn = nasToConn(nas);
  const client = await ros.createClient(conn);

  try {
    let version = '';
    let boardName = '';
    let identity = '';

    const resSentences = await client.run(['/system/resource/print']);
    for (const sentence of resSentences) {
      if (sentence[0] === '!re') {
        const attrs = ros.parseAttrs(sentence.slice(1));
        version = attrs.version || version;
        boardName = attrs['board-name'] || boardName;
      }
    }

    // Identity is best-effort — don't fail the whole probe if it errors.
    try {
      const idSentences = await client.run(['/system/identity/print']);
      for (const sentence of idSentences) {
        if (sentence[0] === '!re') {
          const attrs = ros.parseAttrs(sentence.slice(1));
          identity = attrs.name || identity;
        }
      }
    } catch (err) {
      logger.warn({ host: conn.host, err: err.message }, 'RouterOS identity probe failed (ignored)');
    }

    logger.info(
      { host: conn.host, port: conn.port, tls: conn.secure, version, boardName, identity },
      'RouterOS test-connection succeeded',
    );

    return {
      ok: true,
      host: conn.host,
      port: conn.port,
      tls: conn.secure,
      version,
      boardName,
      identity,
    };
  } finally {
    await client.close();
  }
}

/**
 * Create-or-update a PPPoE subscriber secret on the NAS.
 *
 * @param {object} nas
 * @param {{ username: string, password: string, profile?: string, comment?: string }} sub
 * @returns {Promise<{ id: string, created: boolean, updated: boolean }>}
 */
async function pushSubscriber(nas, { username, password, profile, comment }) {
  const conn = nasToConn(nas);
  return ros.pppoeUpsert(conn, {
    name: username,
    secretPassword: password,
    profile,
    comment,
    service: 'pppoe',
  });
}

module.exports = {
  nasToConn,
  testConnection,
  pushSubscriber,
};
