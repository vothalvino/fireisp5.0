// =============================================================================
// FireISP 5.0 — FireRelay Agent (Remote POP Process)
// =============================================================================
// Maintains an outbound WebSocket connection to the master tunnel endpoint,
// authenticates with node_id + shared secret, receives command messages, runs
// local handlers, and returns response messages.
// =============================================================================

const { EventEmitter } = require('events');
const WebSocket = require('ws');
const baseLogger = require('../utils/logger').child({ service: 'firerelayAgent' });

class FireRelayAgent extends EventEmitter {
  constructor({
    nodeId,
    token,
    tunnelUrl,
    reconnectDelayMs = 2000,
    handlers = {},
    logger = baseLogger,
    WebSocketImpl = WebSocket,
  } = {}) {
    super();
    this.nodeId = nodeId;
    this.token = token;
    this.tunnelUrl = tunnelUrl;
    this.reconnectDelayMs = reconnectDelayMs;
    this.handlers = { ...handlers };
    this.logger = logger;
    this.WebSocketImpl = WebSocketImpl;

    this._ws = null;
    this._isStarted = false;
    this._isAuthenticated = false;
    this._reconnectTimer = null;
  }

  setHandler(method, fn) {
    if (typeof method !== 'string' || method.length < 1) {
      throw new Error('method must be a non-empty string');
    }
    if (typeof fn !== 'function') {
      throw new Error('handler must be a function');
    }
    this.handlers[method] = fn;
  }

  async start() {
    if (this._isStarted) return;
    if (!this.nodeId) throw new Error('FIRERELAY_NODE_ID is required');
    if (!this.token) throw new Error('FIRERELAY_TUNNEL_SECRET is required');
    if (!this.tunnelUrl) throw new Error('FIRERELAY_TUNNEL_URL (or FIRERELAY_MASTER_URL) is required');

    this._isStarted = true;
    this._connect();
  }

  async stop() {
    this._isStarted = false;
    this._isAuthenticated = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this._ws) {
      try {
        if (this._ws.readyState === this.WebSocketImpl.OPEN) {
          this._ws.close(1000, 'Agent stopping');
        } else {
          this._ws.terminate();
        }
      } catch (_err) {
        // best effort
      }
      this._ws = null;
    }
  }

  _connect() {
    if (!this._isStarted) return;
    if (this._ws && (this._ws.readyState === this.WebSocketImpl.CONNECTING || this._ws.readyState === this.WebSocketImpl.OPEN)) {
      return;
    }

    this.logger.info({ nodeId: this.nodeId, tunnelUrl: this.tunnelUrl }, 'Agent connecting to tunnel');
    const ws = new this.WebSocketImpl(this.tunnelUrl);
    this._ws = ws;
    this._isAuthenticated = false;

    ws.on('open', () => {
      this._send({
        type: 'auth',
        node_id: this.nodeId,
        token: this.token,
      });
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_err) {
        this.logger.warn('Agent received invalid JSON from tunnel');
        return;
      }
      this._handleMessage(msg);
    });

    ws.on('close', (code, reason) => {
      const reasonText = reason?.toString?.() || '';
      this.logger.warn({ code, reason: reasonText }, 'Agent tunnel disconnected');
      const wasAuthenticated = this._isAuthenticated;
      this._isAuthenticated = false;
      this.emit('disconnect', code, reasonText);
      if (this._isStarted) {
        this._scheduleReconnect();
      } else if (wasAuthenticated) {
        this.logger.info('Agent stopped');
      }
    });

    ws.on('error', (err) => {
      this.logger.warn({ err: err.message }, 'Agent WebSocket error');
    });
  }

  _scheduleReconnect() {
    if (this._reconnectTimer || !this._isStarted) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, this.reconnectDelayMs);
    if (this._reconnectTimer.unref) this._reconnectTimer.unref();
  }

  _handleMessage(msg) {
    if (msg.type === 'auth_ok') {
      this._isAuthenticated = true;
      this.logger.info({ nodeId: this.nodeId }, 'Agent authenticated with tunnel');
      this.emit('connected');
      return;
    }

    if (msg.type === 'auth_fail') {
      this.logger.error({ reason: msg.reason || 'unknown' }, 'Agent authentication failed');
      if (this._ws && this._ws.readyState === this.WebSocketImpl.OPEN) {
        this._ws.close(4004, 'Authentication failed');
      }
      return;
    }

    if (msg.type === 'command') {
      this._handleCommand(msg).catch((err) => {
        this.logger.warn({ err: err.message }, 'Agent command handler failed unexpectedly');
      });
    }
  }

  async _handleCommand(msg) {
    const { id, method, params } = msg;
    if (!id || typeof id !== 'string') return;

    try {
      const handler = this.handlers[method];
      if (!handler) {
        throw new Error(`Unsupported command method: ${method}`);
      }
      const data = await handler(params ?? {});
      this._send({
        type: 'response',
        id,
        ok: true,
        data: data ?? null,
      });
    } catch (err) {
      this._send({
        type: 'response',
        id,
        ok: false,
        error: err.message || 'Command failed',
      });
    }
  }

  _send(payload) {
    if (!this._ws || this._ws.readyState !== this.WebSocketImpl.OPEN) return;
    this._ws.send(JSON.stringify(payload));
  }
}

module.exports = FireRelayAgent;
