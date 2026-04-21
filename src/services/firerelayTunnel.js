// =============================================================================
// FireISP 5.0 — FireRelay WebSocket Tunnel Server
// =============================================================================
// Manages persistent WebSocket connections from remote POP-site agents.
// Each agent connects outbound to the central server, authenticates with a
// shared secret, and then waits for RouterOS commands.  The server can push
// a command message and await the agent's response via a Promise-based API.
//
// Message protocol (all messages are JSON):
//
//   Agent → Server (auth):
//     { "type": "auth", "node_id": "<id>", "token": "<FIRERELAY_TUNNEL_SECRET>" }
//
//   Server → Agent (auth result):
//     { "type": "auth_ok" }   |   { "type": "auth_fail", "reason": "..." }
//
//   Server → Agent (command):
//     { "type": "command", "id": "<uuid>", "method": "<method>", "params": {...} }
//
//   Agent → Server (command response):
//     { "type": "response", "id": "<uuid>", "ok": true|false, "data": {...} }
//
//   Agent → Server (heartbeat acknowledgement, optional):
//     WebSocket native pong frames are used (server sends ping, agent replies pong).
// =============================================================================

const { EventEmitter } = require('events');
const { WebSocketServer } = require('ws');
const { randomUUID } = require('crypto');
const db = require('../config/database');
const relayConfig = require('../config/firerelay');
const logger = require('../utils/logger').child({ service: 'firerelayTunnel' });

// ─────────────────────────────────────────────────────────────────────────────
// TunnelServer
// ─────────────────────────────────────────────────────────────────────────────

class TunnelServer extends EventEmitter {
  constructor() {
    super();
    /** @type {WebSocketServer|null} */
    this._wss = null;
    /** @type {Map<string, WebSocket>} nodeId → authenticated WebSocket */
    this._agents = new Map();
    /** @type {Map<string, {resolve: Function, reject: Function, timer: NodeJS.Timeout}>} */
    this._pending = new Map();
    /** @type {Map<WebSocket, NodeJS.Timeout>} ws → ping interval timer */
    this._pingTimers = new Map();
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Attach the tunnel to an existing HTTP server.
   * Only starts if FIRERELAY_TUNNEL_SECRET is configured.
   * @param {import('http').Server} httpServer
   */
  attach(httpServer) {
    if (!relayConfig.tunnelSecret) {
      logger.info('Tunnel disabled — set FIRERELAY_TUNNEL_SECRET to enable');
      return;
    }
    if (this._wss) {
      throw new Error('TunnelServer already attached');
    }

    this._wss = new WebSocketServer({ server: httpServer, path: '/ws/firerelay' });

    this._wss.on('connection', (ws, req) => {
      const remoteIp = req.socket.remoteAddress;
      logger.debug({ remoteIp }, 'Tunnel: new WebSocket connection');
      this._handleConnection(ws, remoteIp);
    });

    this._wss.on('error', (err) => {
      logger.error({ err }, 'Tunnel WebSocket server error');
    });

    logger.info('Tunnel WebSocket server attached at /ws/firerelay');
  }

  /**
   * Close all connections and shut down the WebSocket server.
   * @returns {Promise<void>}
   */
  close() {
    return new Promise((resolve) => {
      // Reject all pending commands
      for (const [id, { reject, timer }] of this._pending) {
        clearTimeout(timer);
        reject(new Error('Tunnel server closing'));
        this._pending.delete(id);
      }

      // Stop ping timers and close agent sockets
      for (const [ws, timer] of this._pingTimers) {
        clearInterval(timer);
        ws.terminate();
      }
      this._pingTimers.clear();
      this._agents.clear();

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

  // ─── Connection Handling ────────────────────────────────────────────────────

  _handleConnection(ws, remoteIp) {
    // Set a short auth timeout — unauthenticated connections must identify quickly
    const authTimeout = setTimeout(() => {
      logger.warn({ remoteIp }, 'Tunnel: auth timeout, closing connection');
      ws.close(4001, 'Authentication timeout');
    }, 10000);

    // Track whether this socket has authenticated yet
    ws._authenticated = false;
    ws._nodeId = null;

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_e) {
        ws.send(JSON.stringify({ type: 'error', reason: 'Invalid JSON' }));
        return;
      }

      if (!ws._authenticated) {
        this._handleAuth(ws, msg, authTimeout, remoteIp);
      } else {
        this._handleMessage(ws, msg);
      }
    });

    ws.on('pong', () => {
      // Agent is still alive
      ws._lastPong = Date.now();
    });

    ws.on('close', (code, reason) => {
      clearTimeout(authTimeout);
      if (ws._nodeId) {
        this._onAgentDisconnect(ws._nodeId, code, reason.toString());
      }
    });

    ws.on('error', (err) => {
      logger.warn({ nodeId: ws._nodeId, err: err.message }, 'Tunnel: agent socket error');
    });
  }

  _handleAuth(ws, msg, authTimeout, remoteIp) {
    if (msg.type !== 'auth') {
      ws.send(JSON.stringify({ type: 'auth_fail', reason: 'Expected auth message first' }));
      ws.close(4002, 'Protocol error');
      return;
    }

    const { node_id, token } = msg;

    if (!node_id || typeof node_id !== 'string' || node_id.length < 1 || node_id.length > 64) {
      ws.send(JSON.stringify({ type: 'auth_fail', reason: 'Invalid node_id' }));
      ws.close(4003, 'Invalid node_id');
      return;
    }

    if (!token || token !== relayConfig.tunnelSecret) {
      logger.warn({ remoteIp, node_id }, 'Tunnel: auth failed — wrong token');
      ws.send(JSON.stringify({ type: 'auth_fail', reason: 'Invalid token' }));
      ws.close(4004, 'Unauthorized');
      return;
    }

    clearTimeout(authTimeout);

    // Disconnect any existing connection for the same node_id
    const existing = this._agents.get(node_id);
    if (existing) {
      logger.info({ node_id }, 'Tunnel: replacing stale agent connection');
      existing.close(4010, 'Replaced by new connection');
      this._clearPingTimer(existing);
    }

    ws._authenticated = true;
    ws._nodeId = node_id;
    ws._lastPong = Date.now();

    this._agents.set(node_id, ws);
    this._startPingTimer(ws);

    ws.send(JSON.stringify({ type: 'auth_ok' }));
    logger.info({ node_id, remoteIp }, 'Tunnel: agent authenticated');

    this._onAgentConnect(node_id).catch((err) => {
      logger.warn({ node_id, err: err.message }, 'Tunnel: failed to update agent status in DB');
    });

    this.emit('agent:connect', node_id);
  }

  _handleMessage(ws, msg) {
    if (msg.type === 'response') {
      const pending = this._pending.get(msg.id);
      if (!pending) {
        logger.debug({ id: msg.id }, 'Tunnel: received response for unknown command id');
        return;
      }
      clearTimeout(pending.timer);
      this._pending.delete(msg.id);
      if (msg.ok) {
        pending.resolve(msg.data ?? null);
      } else {
        pending.reject(new Error(msg.error || 'Agent returned error'));
      }
    } else {
      logger.debug({ nodeId: ws._nodeId, type: msg.type }, 'Tunnel: unhandled message type from agent');
    }
  }

  // ─── Heartbeat ──────────────────────────────────────────────────────────────

  _startPingTimer(ws) {
    const interval = relayConfig.tunnelPingInterval;
    const timer = setInterval(() => {
      if (ws.readyState !== ws.OPEN) {
        this._clearPingTimer(ws);
        return;
      }
      // If we haven't received a pong since the last ping, disconnect
      if (ws._lastPong && Date.now() - ws._lastPong > interval * 2) {
        logger.warn({ nodeId: ws._nodeId }, 'Tunnel: agent missed heartbeat, terminating');
        ws.terminate();
        this._clearPingTimer(ws);
        return;
      }
      ws.ping();
    }, interval);

    if (timer.unref) timer.unref();
    this._pingTimers.set(ws, timer);
  }

  _clearPingTimer(ws) {
    const timer = this._pingTimers.get(ws);
    if (timer) {
      clearInterval(timer);
      this._pingTimers.delete(ws);
    }
  }

  // ─── Agent Connect/Disconnect Hooks ────────────────────────────────────────

  async _onAgentConnect(nodeId) {
    try {
      await db.query(
        `UPDATE firerelay_nodes
            SET status = 'active', last_seen_at = NOW()
          WHERE id = ? AND deleted_at IS NULL`,
        [nodeId],
      );
    } catch (_err) {
      // Node may not be in the registry yet — ignore
    }
  }

  _onAgentDisconnect(nodeId, code, reason) {
    this._clearPingTimer(this._agents.get(nodeId));
    this._agents.delete(nodeId);

    logger.info({ nodeId, code, reason }, 'Tunnel: agent disconnected');

    db.query(
      `UPDATE firerelay_nodes
          SET status = 'offline', last_seen_at = NOW()
        WHERE id = ? AND deleted_at IS NULL`,
      [nodeId],
    ).catch((err) => {
      logger.warn({ nodeId, err: err.message }, 'Tunnel: failed to mark agent offline in DB');
    });

    this.emit('agent:disconnect', nodeId, code, reason);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Send a command to a connected agent and await its response.
   *
   * @param {string} nodeId        - The agent's node_id
   * @param {string} method        - Command method (e.g. 'pppoe.create')
   * @param {object} [params]      - Command parameters
   * @param {number} [timeoutMs]   - Override default command timeout
   * @returns {Promise<any>}       - Resolves with agent response data
   */
  sendCommand(nodeId, method, params = {}, timeoutMs) {
    const ws = this._agents.get(nodeId);
    if (!ws || ws.readyState !== ws.OPEN) {
      return Promise.reject(new Error(`Agent ${nodeId} is not connected`));
    }

    const id = randomUUID();
    const timeout = timeoutMs ?? relayConfig.tunnelCommandTimeout;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`Command ${method} to agent ${nodeId} timed out after ${timeout}ms`));
      }, timeout);

      if (timer.unref) timer.unref();

      this._pending.set(id, { resolve, reject, timer });

      try {
        ws.send(JSON.stringify({ type: 'command', id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(err);
      }
    });
  }

  /**
   * Returns true if an agent with the given node_id is currently connected.
   * @param {string} nodeId
   * @returns {boolean}
   */
  isConnected(nodeId) {
    const ws = this._agents.get(nodeId);
    return !!(ws && ws.readyState === ws.OPEN);
  }

  /**
   * Returns an array of node_ids for all currently connected agents.
   * @returns {string[]}
   */
  connectedAgents() {
    return Array.from(this._agents.keys()).filter((id) => this.isConnected(id));
  }
}

// Export a singleton — the server shares one tunnel instance
const tunnelServer = new TunnelServer();

module.exports = { TunnelServer, tunnelServer };
