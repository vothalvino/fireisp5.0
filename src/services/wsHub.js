// =============================================================================
// FireISP 5.0 — WebSocket Hub
// =============================================================================
// Real-time push hub for browser clients.  Runs at path /ws on the same HTTP
// server, separate from the FireRelay agent tunnel (/ws/firerelay).
//
// Protocol (all messages are JSON):
//
//   Client → Server (auth, must arrive within AUTH_TIMEOUT_MS):
//     { "type": "auth", "token": "<access JWT>" }
//
//   Server → Client (auth result):
//     { "type": "auth_ok", "orgId": N }
//     { "type": "auth_fail", "reason": "..." }
//
//   Client → Server (channel management, after auth):
//     { "type": "subscribe",   "channel": "notifications" }
//     { "type": "unsubscribe", "channel": "notifications" }
//
//     Valid channel names: "notifications" | "metrics" | "outages" |
//                          "ticket:<positive integer>"
//
//   Server → Client (push event):
//     { "type": "event", "event": "<name>", "data": {...}, "channel": "<full>" }
//
//   Server → Client (heartbeat):
//     WebSocket native ping/pong frames (client must respond with pong)
//
// Notes:
//   - Auth uses the short-lived (15 m) JWT access token only — no DB lookup —
//     which keeps the hot path dependency-free.  Compromised/suspended users
//     are naturally evicted when their token expires.
//   - Each authenticated client is scoped to a single organization; cross-org
//     channel subscription attempts are rejected.
// =============================================================================

const { WebSocketServer, WebSocket } = require('ws');
const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger').child({ service: 'wsHub' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTH_TIMEOUT_MS = 5000;
const PING_INTERVAL_MS = 30000;
const PONG_WAIT_MS = 10000;

/** Channel names that a client is allowed to subscribe to (relative names). */
const SIMPLE_CHANNELS = new Set(['notifications', 'metrics', 'outages']);
const TICKET_CHANNEL_RE = /^ticket:(\d+)$/;

// ---------------------------------------------------------------------------
// WsHub
// ---------------------------------------------------------------------------

class WsHub {
  constructor() {
    /** @type {WebSocketServer|null} */
    this._wss = null;

    /**
     * channel (full, e.g. "org:1:notifications") → Set<WebSocket>
     * @type {Map<string, Set<WebSocket>>}
     */
    this._channels = new Map();

    /** ws → Set<string channels> */
    this._clientChannels = new Map();

    /** ws → NodeJS.Timeout (ping interval) */
    this._pingTimers = new Map();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Attach the hub to an existing HTTP server.
   * @param {import('http').Server} httpServer
   */
  attach(httpServer) {
    if (this._wss) {
      throw new Error('WsHub already attached');
    }

    this._wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    this._wss.on('connection', (ws, req) => {
      const remoteIp = req.socket.remoteAddress;
      logger.debug({ remoteIp }, 'WsHub: new connection');
      this._handleConnection(ws);
    });

    this._wss.on('error', (err) => {
      logger.error({ err }, 'WsHub: server error');
    });

    logger.info('WsHub attached at /ws');
  }

  /**
   * Close all client connections and shut down the WebSocket server.
   * @returns {Promise<void>}
   */
  close() {
    return new Promise((resolve) => {
      // Stop all ping timers
      for (const [ws, timer] of this._pingTimers) {
        clearInterval(timer);
        ws.terminate();
      }
      this._pingTimers.clear();
      this._channels.clear();
      this._clientChannels.clear();

      if (this._wss) {
        this._wss.close(() => {
          this._wss = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // ── Broadcasting ───────────────────────────────────────────────────────────

  /**
   * Send an event to all WebSocket clients subscribed to a channel.
   * @param {string} channel - Full channel name, e.g. "org:1:notifications"
   * @param {string} event   - Event name, e.g. "notification"
   * @param {object} data    - Payload (serialised to JSON)
   */
  broadcastWs(channel, event, data) {
    const clients = this._channels.get(channel);
    if (!clients || clients.size === 0) return;

    const message = JSON.stringify({ type: 'event', event, data, channel });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(message);
        } catch (err) {
          logger.warn({ err: err.message }, 'WsHub: send error, removing client');
          this._removeClient(ws);
        }
      } else {
        this._removeClient(ws);
      }
    }
  }

  // ── Connection Handling ────────────────────────────────────────────────────

  _handleConnection(ws) {
    ws._authenticated = false;
    ws._orgId = null;

    // Require auth within AUTH_TIMEOUT_MS
    const authTimer = setTimeout(() => {
      if (!ws._authenticated) {
        logger.warn('WsHub: auth timeout, closing connection');
        ws.close(4001, 'Authentication timeout');
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_e) {
        ws.send(JSON.stringify({ type: 'error', reason: 'Invalid JSON' }));
        return;
      }

      if (!ws._authenticated) {
        this._handleAuth(ws, msg, authTimer);
      } else {
        this._handleClientMessage(ws, msg);
      }
    });

    ws.on('pong', () => {
      ws._lastPong = Date.now();
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      this._removeClient(ws);
    });

    ws.on('error', (err) => {
      logger.warn({ err: err.message }, 'WsHub: client error');
    });
  }

  _handleAuth(ws, msg, authTimer) {
    if (msg.type !== 'auth' || typeof msg.token !== 'string') {
      ws.send(JSON.stringify({ type: 'auth_fail', reason: 'Expected {type:"auth",token:"..."}' }));
      ws.close(4002, 'Auth protocol error');
      return;
    }

    let payload;
    try {
      payload = jwt.verify(msg.token, config.jwt.secret, { algorithms: [config.jwt.algorithm] });
    } catch (_err) {
      ws.send(JSON.stringify({ type: 'auth_fail', reason: 'Invalid or expired token' }));
      ws.close(4003, 'Invalid token');
      return;
    }

    const orgId = payload.orgId;
    if (!orgId) {
      ws.send(JSON.stringify({ type: 'auth_fail', reason: 'Token missing orgId claim' }));
      ws.close(4004, 'Missing orgId');
      return;
    }

    clearTimeout(authTimer);
    ws._authenticated = true;
    ws._orgId = orgId;
    ws._lastPong = Date.now();

    this._clientChannels.set(ws, new Set());

    ws.send(JSON.stringify({ type: 'auth_ok', orgId }));
    logger.debug({ orgId }, 'WsHub: client authenticated');

    // Start heartbeat
    const pingTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(pingTimer);
        this._pingTimers.delete(ws);
        return;
      }
      const now = Date.now();
      if (ws._lastPong && now - ws._lastPong > PING_INTERVAL_MS + PONG_WAIT_MS) {
        logger.warn({ orgId }, 'WsHub: pong timeout, terminating client');
        ws.terminate();
        clearInterval(pingTimer);
        this._pingTimers.delete(ws);
        return;
      }
      ws.ping();
    }, PING_INTERVAL_MS);

    this._pingTimers.set(ws, pingTimer);
  }

  _handleClientMessage(ws, msg) {
    if (msg.type === 'subscribe') {
      this._subscribe(ws, msg.channel);
    } else if (msg.type === 'unsubscribe') {
      this._unsubscribe(ws, msg.channel);
    } else {
      ws.send(JSON.stringify({ type: 'error', reason: `Unknown message type: ${msg.type}` }));
    }
  }

  /**
   * Subscribe an authenticated client to a channel.
   * @param {WebSocket} ws
   * @param {string} relativeChannel - e.g. "notifications", "ticket:42"
   */
  _subscribe(ws, relativeChannel) {
    const full = this._resolveChannel(ws._orgId, relativeChannel);
    if (!full) {
      ws.send(JSON.stringify({ type: 'error', reason: `Invalid channel: ${relativeChannel}` }));
      return;
    }

    if (!this._channels.has(full)) {
      this._channels.set(full, new Set());
    }
    this._channels.get(full).add(ws);
    this._clientChannels.get(ws).add(full);

    ws.send(JSON.stringify({ type: 'subscribed', channel: full }));
    logger.debug({ orgId: ws._orgId, channel: full }, 'WsHub: subscribed');
  }

  /**
   * Unsubscribe a client from a channel.
   */
  _unsubscribe(ws, relativeChannel) {
    const full = this._resolveChannel(ws._orgId, relativeChannel);
    if (!full) {
      ws.send(JSON.stringify({ type: 'error', reason: `Invalid channel: ${relativeChannel}` }));
      return;
    }

    const channelClients = this._channels.get(full);
    if (channelClients) {
      channelClients.delete(ws);
      if (channelClients.size === 0) this._channels.delete(full);
    }
    const clientSubs = this._clientChannels.get(ws);
    if (clientSubs) clientSubs.delete(full);

    ws.send(JSON.stringify({ type: 'unsubscribed', channel: full }));
  }

  /**
   * Remove a client from all channels and clean up timers.
   */
  _removeClient(ws) {
    const timer = this._pingTimers.get(ws);
    if (timer) {
      clearInterval(timer);
      this._pingTimers.delete(ws);
    }

    const subs = this._clientChannels.get(ws);
    if (subs) {
      for (const ch of subs) {
        const set = this._channels.get(ch);
        if (set) {
          set.delete(ws);
          if (set.size === 0) this._channels.delete(ch);
        }
      }
      this._clientChannels.delete(ws);
    }
  }

  /**
   * Resolve a relative channel name to a full org-scoped channel name.
   * Returns null if the channel name is not valid.
   * @param {number|string} orgId
   * @param {string} relative
   * @returns {string|null}
   */
  _resolveChannel(orgId, relative) {
    if (typeof relative !== 'string') return null;

    if (SIMPLE_CHANNELS.has(relative)) {
      return `org:${orgId}:${relative}`;
    }

    const m = relative.match(TICKET_CHANNEL_RE);
    if (m) {
      const ticketId = parseInt(m[1], 10);
      if (ticketId > 0) {
        return `org:${orgId}:ticket:${ticketId}`;
      }
    }

    return null;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const wsHub = new WsHub();

module.exports = { WsHub, wsHub };
