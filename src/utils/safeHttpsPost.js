// =============================================================================
// FireISP 5.0 — bounded, DNS-pinned outbound HTTPS POST
// =============================================================================
// Shared by saved webhooks and SNMP trap forwarding. The response body is
// deliberately ignored: tenant-controlled endpoints must not turn FireISP
// into a response-body exfiltration proxy or hold a worker with an endless
// stream after response headers have arrived.
// =============================================================================

const https = require('https');
const { AppError } = require('./errors');
const {
  resolveSafeOutboundUrl,
  isBlockedIp,
} = require('./safeOutboundUrl');

const WEBHOOK_ABSOLUTE_TIMEOUT_MS = 10000;
const MAX_WEBHOOK_HEADER_BYTES = 16 * 1024;
// Kept as an explicit public contract: no response bytes are retained.
const MAX_WEBHOOK_RESPONSE_BYTES = 0;

function timeoutError() {
  return Object.assign(new Error('Outbound HTTPS request timed out'), { code: 'ETIMEDOUT' });
}

/**
 * POST JSON-compatible bytes to a validated public HTTPS endpoint.
 *
 * DNS resolution is part of the absolute deadline. The resulting lookup
 * callback is pinned to the validated public addresses, redirects are never
 * followed, the actual connected peer is checked again, and completion occurs
 * as soon as response headers arrive. The response stream is immediately
 * destroyed without being read or persisted.
 */
async function safeHttpsPost(
  rawUrl,
  body,
  headers = {},
  timeoutMs = WEBHOOK_ABSOLUTE_TIMEOUT_MS,
  field = 'outbound destination',
) {
  const boundedTimeoutMs = Math.max(1, Math.min(60000, Number(timeoutMs) || WEBHOOK_ABSOLUTE_TIMEOUT_MS));
  const start = Date.now();
  const resolved = await resolveSafeOutboundUrl(rawUrl, field, {
    timeoutMs: boundedTimeoutMs,
    timeoutCode: 'ETIMEDOUT',
  });
  const remainingMs = boundedTimeoutMs - (Date.now() - start);
  if (remainingMs <= 0) throw timeoutError();

  return new Promise((resolve, reject) => {
    let req;
    let response;
    let absoluteTimer = null;
    let settled = false;

    const finish = (callback, value) => {
      if (settled) return false;
      settled = true;
      if (absoluteTimer) clearTimeout(absoluteTimer);
      callback(value);
      return true;
    };
    const fail = error => finish(reject, error);
    const succeed = value => finish(resolve, value);

    try {
      req = https.request({
        protocol: 'https:',
        hostname: resolved.url.hostname.replace(/^\[|\]$/g, ''),
        port: resolved.url.port || 443,
        path: `${resolved.url.pathname}${resolved.url.search}`,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        timeout: remainingMs,
        lookup: resolved.lookup,
        agent: false,
        maxHeaderSize: MAX_WEBHOOK_HEADER_BYTES,
      }, (res) => {
        response = res;
        const peer = res.socket?.remoteAddress;
        if (!peer || isBlockedIp(peer)) {
          const error = new AppError(
            `${field} connected to a non-public address.`,
            422,
            'UNSAFE_URL',
          );
          fail(error);
          if (typeof res.destroy === 'function') res.destroy();
          return;
        }

        const statusCode = Number(res.statusCode);
        if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
          const error = Object.assign(new Error('Outbound HTTPS response had no valid status code'), { code: 'EPROTO' });
          fail(error);
          if (typeof res.destroy === 'function') res.destroy();
          return;
        }

        // Response bodies are unused and may be attacker-controlled streams.
        // Accept the status line as the complete result, then close the stream.
        succeed({
          statusCode,
          responseTimeMs: Date.now() - start,
          body: null,
        });
        if (typeof res.destroy === 'function') res.destroy();
      });
    } catch (error) {
      fail(error);
      return;
    }

    if (!settled) {
      absoluteTimer = setTimeout(() => {
        const error = timeoutError();
        fail(error);
        if (typeof response?.destroy === 'function') response.destroy();
        if (typeof req?.destroy === 'function') req.destroy(error);
      }, remainingMs);
      if (typeof absoluteTimer.unref === 'function') absoluteTimer.unref();
    }

    req.on('timeout', () => {
      const error = timeoutError();
      fail(error);
      req.destroy(error);
    });
    req.on('error', fail);
    req.end(body);
  });
}

module.exports = {
  safeHttpsPost,
  WEBHOOK_ABSOLUTE_TIMEOUT_MS,
  MAX_WEBHOOK_HEADER_BYTES,
  MAX_WEBHOOK_RESPONSE_BYTES,
};
