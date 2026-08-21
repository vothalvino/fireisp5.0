// =============================================================================
// FireISP 5.0 — one-shot, DNS-pinned and cancellable SMTP delivery
// =============================================================================
// Tenant SMTP destinations are untrusted egress configuration: every delivery
// resolves all addresses, rejects non-public results, and connects to one of
// those exact addresses without allowing Nodemailer to resolve the host again.
// The install relay has a separate, explicitly trusted entry point so a local
// operator-managed relay remains possible without weakening tenant policy.
//
// Nodemailer 9 promises do not accept AbortSignal and SMTPTransport.close() does
// not own an active non-pooled SMTPConnection. `getSocket` lets this wrapper own
// the exact socket for one delivery; the absolute deadline destroys that socket
// so the SMTP exchange cannot continue after the caller records a timeout.
// =============================================================================

const net = require('net');
const tls = require('tls');
const nodemailer = require('nodemailer');
const { AppError } = require('./errors');
const {
  resolveSafeOutboundHost,
  resolveTrustedOutboundHost,
  isBlockedIp,
  DEFAULT_DNS_TIMEOUT_MS,
} = require('./safeOutboundUrl');

const DEFAULT_SMTP_ABSOLUTE_TIMEOUT_MS = 60000;
const MAX_SMTP_ABSOLUTE_TIMEOUT_MS = 120000;
const MIN_SMTP_ABSOLUTE_TIMEOUT_MS = 50;
const DEFAULT_SMTP_CONNECTION_TIMEOUT_MS = 30000;
const DEFAULT_SMTP_GREETING_TIMEOUT_MS = 30000;
const DEFAULT_SMTP_SOCKET_TIMEOUT_MS = 60000;

function boundedTimeout(value, fallback, ceiling) {
  const parsed = Number(value);
  const selected = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.max(1, Math.min(ceiling, Math.floor(selected)));
}

function smtpTimeoutError() {
  return Object.assign(new Error('Email delivery exceeded its absolute deadline.'), {
    code: 'EMAIL_DELIVERY_TIMEOUT',
  });
}

function smtpConnectTimeoutError() {
  return Object.assign(new Error('SMTP connection timed out.'), { code: 'ETIMEDOUT' });
}

function validatePort(value, secure) {
  const port = value === undefined || value === null || value === ''
    ? (secure ? 465 : 587)
    : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AppError('SMTP port must be an integer between 1 and 65535.', 422, 'INVALID_SMTP_CONFIG');
  }
  return port;
}

function validateMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new AppError('SMTP message is required.', 422, 'INVALID_SMTP_CONFIG');
  }
  return message;
}

function createSafeSmtpSender(dependencies = {}) {
  const createTransport = dependencies.createTransport
    || nodemailer.createTransport.bind(nodemailer);
  const connect = dependencies.connect || net.connect.bind(net);
  const tlsConnect = dependencies.tlsConnect || tls.connect.bind(tls);
  const resolveSafeHost = dependencies.resolveSafeHost || resolveSafeOutboundHost;
  const resolveTrustedHost = dependencies.resolveTrustedHost || resolveTrustedOutboundHost;

  async function sendOneShot(input, trustedRelay) {
    const options = input || {};
    const secure = Boolean(options.secure);
    const port = validatePort(options.port, secure);
    const message = validateMessage(options.message);
    const absoluteTimeoutMs = Math.max(
      MIN_SMTP_ABSOLUTE_TIMEOUT_MS,
      boundedTimeout(
        options.absoluteTimeoutMs,
        DEFAULT_SMTP_ABSOLUTE_TIMEOUT_MS,
        MAX_SMTP_ABSOLUTE_TIMEOUT_MS,
      ),
    );
    const deadlineAt = Date.now() + absoluteTimeoutMs;
    const connectionTimeoutMs = boundedTimeout(
      options.connectionTimeoutMs,
      DEFAULT_SMTP_CONNECTION_TIMEOUT_MS,
      absoluteTimeoutMs,
    );
    const greetingTimeoutMs = boundedTimeout(
      options.greetingTimeoutMs,
      DEFAULT_SMTP_GREETING_TIMEOUT_MS,
      absoluteTimeoutMs,
    );
    const socketTimeoutMs = boundedTimeout(
      options.socketTimeoutMs,
      DEFAULT_SMTP_SOCKET_TIMEOUT_MS,
      absoluteTimeoutMs,
    );

    let activeSocket = null;
    let aborted = false;
    let abortReason = null;
    let absoluteTimer = null;
    let transporter = null;

    const remainingMs = () => Math.max(0, deadlineAt - Date.now());
    const assertActive = () => {
      if (aborted) throw abortReason || smtpTimeoutError();
      if (remainingMs() <= 0) {
        abortReason = smtpTimeoutError();
        aborted = true;
        throw abortReason;
      }
    };
    const destroyActiveSocket = error => {
      const socket = activeSocket;
      if (!socket || socket.destroyed || typeof socket.destroy !== 'function') return;
      // Nodemailer annotates socket errors in place (for example changing the
      // code to ESOCKET). Keep the canonical caller-facing timeout immutable by
      // giving the socket its own teardown error object.
      const socketError = error
        ? Object.assign(new Error(error.message), { code: error.code })
        : undefined;
      try { socket.destroy(socketError); } catch (_) { /* already closing */ }
    };
    const abort = error => {
      if (!aborted) {
        aborted = true;
        abortReason = error;
      }
      destroyActiveSocket(abortReason);
    };

    const openPinnedSocket = (address, servername) => new Promise((resolve, reject) => {
      assertActive();
      let socket;
      let settled = false;
      let connectTimer = null;

      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (connectTimer) clearTimeout(connectTimer);
        callback(value);
      };
      const fail = error => {
        finish(reject, error);
        if (socket && !socket.destroyed && typeof socket.destroy === 'function') {
          try { socket.destroy(); } catch (_) { /* already closing */ }
        }
      };
      const connected = () => {
        try {
          assertActive();
          const peer = String(socket?.remoteAddress || '').split('%')[0];
          if (!peer || net.isIP(peer) === 0) {
            throw new AppError('SMTP connection did not expose a valid remote address.', 502, 'SMTP_PEER_INVALID');
          }
          if (!trustedRelay && isBlockedIp(peer)) {
            throw new AppError(
              'SMTP destination connected to a non-public address.',
              422,
              'UNSAFE_HOST',
            );
          }
          if (typeof socket.setKeepAlive === 'function') socket.setKeepAlive(true);
          finish(resolve, socket);
        } catch (error) {
          fail(error);
        }
      };

      const socketOptions = {
        host: address.address,
        port,
        family: Number(address.family),
      };
      try {
        socket = secure
          ? tlsConnect({
            ...socketOptions,
            rejectUnauthorized: true,
            ...(servername && { servername }),
          })
          : connect(socketOptions);
        activeSocket = socket;
      } catch (error) {
        fail(error);
        return;
      }

      // Keep the error handler installed after connection establishment. There
      // is otherwise a small gap before Nodemailer attaches its own handlers.
      socket.once('error', fail);
      socket.once(secure ? 'secureConnect' : 'connect', connected);
      const dialTimeout = Math.max(1, Math.min(connectionTimeoutMs, remainingMs()));
      connectTimer = setTimeout(() => fail(smtpConnectTimeoutError()), dialTimeout);
      if (typeof connectTimer.unref === 'function') connectTimer.unref();
    });

    const getSocket = (_transportOptions, callback) => {
      let called = false;
      const done = (error, value) => {
        if (called) {
          if (value?.connection && typeof value.connection.destroy === 'function') {
            value.connection.destroy();
          }
          return;
        }
        called = true;
        callback(error, value);
      };

      (async () => {
        assertActive();
        const resolver = trustedRelay ? resolveTrustedHost : resolveSafeHost;
        const resolved = await resolver(options.host, 'smtp_host', {
          timeoutMs: Math.max(1, Math.min(DEFAULT_DNS_TIMEOUT_MS, remainingMs())),
          timeoutCode: 'ETIMEDOUT',
        });
        assertActive();

        const servername = net.isIP(resolved.hostname) ? undefined : resolved.hostname;
        let lastError = null;
        for (const address of resolved.addresses) {
          try {
            const socket = await openPinnedSocket(address, servername);
            assertActive();
            done(null, {
              connection: socket,
              secured: secure,
              host: resolved.hostname,
              ...(servername && { servername }),
            });
            return;
          } catch (error) {
            lastError = error;
            if (aborted) throw abortReason || error;
          }
        }
        throw lastError || new AppError('SMTP host had no usable address.', 422, 'UNSAFE_HOST');
      })().catch(error => done(error));
    };

    // Tenant SMTP always uses either implicit TLS or mandatory STARTTLS. The
    // trusted install relay may explicitly allow plaintext; when credentials
    // are present its safe default is still mandatory STARTTLS.
    const requireTLS = !secure && (trustedRelay
      ? (options.requireTls === undefined ? Boolean(options.auth) : Boolean(options.requireTls))
      : true);

    transporter = createTransport({
      host: String(options.host || ''),
      port,
      secure,
      requireTLS,
      ignoreTLS: false,
      auth: options.auth || undefined,
      connectionTimeout: connectionTimeoutMs,
      greetingTimeout: greetingTimeoutMs,
      socketTimeout: socketTimeoutMs,
      tls: { rejectUnauthorized: true },
      getSocket,
    });

    const timeoutPromise = new Promise((_, reject) => {
      absoluteTimer = setTimeout(() => {
        const error = smtpTimeoutError();
        abort(error);
        reject(error);
      }, absoluteTimeoutMs);
      if (typeof absoluteTimer.unref === 'function') absoluteTimer.unref();
    });

    const sendPromise = Promise.resolve()
      .then(() => transporter.sendMail(message))
      .catch(error => {
        // Socket destruction may make Nodemailer surface ESOCKET before the
        // timeout promise's rejection wins the race. Preserve the caller's
        // deterministic deadline result only when this wrapper caused abort.
        if (aborted && abortReason) throw abortReason;
        throw error;
      });
    try {
      return await Promise.race([sendPromise, timeoutPromise]);
    } finally {
      if (absoluteTimer) clearTimeout(absoluteTimer);
      // SMTPTransport.close() is retained for listener cleanup, but socket
      // destruction is the operation that actually terminates this delivery.
      try { transporter.close(); } catch (_) { /* already closed */ }
      destroyActiveSocket();
    }
  }

  return {
    sendTenantSmtp: options => sendOneShot(options, false),
    sendTrustedSmtp: options => sendOneShot(options, true),
  };
}

const defaultSender = createSafeSmtpSender();

module.exports = {
  ...defaultSender,
  createSafeSmtpSender,
  DEFAULT_SMTP_ABSOLUTE_TIMEOUT_MS,
  MAX_SMTP_ABSOLUTE_TIMEOUT_MS,
  DEFAULT_SMTP_CONNECTION_TIMEOUT_MS,
  DEFAULT_SMTP_GREETING_TIMEOUT_MS,
  DEFAULT_SMTP_SOCKET_TIMEOUT_MS,
};
