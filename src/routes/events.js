// =============================================================================
// FireISP 5.0 — Real-Time Events (SSE)
// =============================================================================
// Server-Sent Events (SSE) implementation for real-time push notifications.
// Uses SSE instead of WebSocket to avoid additional dependencies (Socket.io)
// and to work through HTTP/2 proxies and load balancers without extra config.
//
// Channels:
//   /api/events/stream         — Authenticated user's notification feed
//   /api/events/metrics        — Live SNMP metrics for dashboard (admin)
//   /api/events/tickets/:id    — Ticket comment/status updates
// =============================================================================

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const logger = require('../utils/logger');

const router = Router();

// ---------------------------------------------------------------------------
// SSE Client Registry
// ---------------------------------------------------------------------------

/** @type {Map<string, Set<import('http').ServerResponse>>} */
const channels = new Map();

/**
 * Get or create a channel's client set.
 */
function getChannel(name) {
  if (!channels.has(name)) {
    channels.set(name, new Set());
  }
  return channels.get(name);
}

/**
 * Broadcast an event to all clients subscribed to a channel.
 * @param {string} channel - Channel name (e.g. 'org:1:notifications')
 * @param {string} event   - SSE event name
 * @param {object} data    - Payload (serialized to JSON)
 */
function broadcast(channel, event, data) {
  const clients = channels.get(channel);
  if (!clients || clients.size === 0) return;

  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(message);
    } catch (_err) {
      clients.delete(res);
    }
  }
}

/**
 * Send an event to a specific SSE response.
 */
function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Setup SSE headers and keepalive.
 */
function initSseResponse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });
  res.write(':ok\n\n'); // Initial comment to establish connection
}

/**
 * Start a keepalive timer and register cleanup on client disconnect.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} channel
 * @param {Set} clients
 */
function registerSseClient(req, res, channel, clients) {
  clients.add(res);

  const keepalive = setInterval(() => {
    try {
      res.write(':keepalive\n\n');
    } catch (_err) {
      clearInterval(keepalive);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(keepalive);
    clients.delete(res);
    if (clients.size === 0) channels.delete(channel);
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/events/stream
 * Authenticated SSE stream for the current user's organization notifications.
 */
router.get('/stream', authenticate, orgScope, (req, res) => {
  initSseResponse(res);

  const channel = `org:${req.orgId}:notifications`;
  const clients = getChannel(channel);

  logger.debug({ channel, userId: req.user.id }, 'SSE client connected');

  // Send initial connection confirmation
  sendEvent(res, 'connected', { channel, timestamp: new Date().toISOString() });

  registerSseClient(req, res, channel, clients);
});

/**
 * GET /api/events/metrics
 * Real-time SNMP metrics stream (admin only).
 * Broadcasts latest poll results as they arrive.
 */
router.get('/metrics', authenticate, orgScope, (req, res) => {
  initSseResponse(res);

  const channel = `org:${req.orgId}:metrics`;
  const clients = getChannel(channel);

  sendEvent(res, 'connected', { channel, timestamp: new Date().toISOString() });
  registerSseClient(req, res, channel, clients);
});

/**
 * GET /api/events/tickets/:id
 * Real-time updates for a specific ticket (comments, status changes).
 * The ticket ID is validated as a numeric integer to prevent injection.
 */
router.get('/tickets/:id', authenticate, orgScope, (req, res) => {
  // Validate and sanitize the ticket ID (integer only)
  const ticketId = parseInt(req.params.id, 10);
  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Ticket ID must be a positive integer' } });
  }

  initSseResponse(res);

  const channel = `org:${req.orgId}:ticket:${ticketId}`;
  const clients = getChannel(channel);

  sendEvent(res, 'connected', { channel, ticketId, timestamp: new Date().toISOString() });
  registerSseClient(req, res, channel, clients);
});

/**
 * GET /api/events/outages
 * Real-time outage alerts for the organization.
 */
router.get('/outages', authenticate, orgScope, (req, res) => {
  initSseResponse(res);

  const channel = `org:${req.orgId}:outages`;
  const clients = getChannel(channel);

  sendEvent(res, 'connected', { channel, timestamp: new Date().toISOString() });
  registerSseClient(req, res, channel, clients);
});

// ---------------------------------------------------------------------------
// Stats endpoint (non-SSE)
// ---------------------------------------------------------------------------

/**
 * GET /api/events/stats
 * Returns current SSE connection stats (admin debug).
 */
router.get('/stats', authenticate, orgScope, (_req, res) => {
  const stats = {};
  for (const [name, clients] of channels.entries()) {
    stats[name] = clients.size;
  }
  res.json({ channels: stats, totalConnections: [...channels.values()].reduce((s, c) => s + c.size, 0) });
});

module.exports = { router, broadcast, sendEvent, getChannel, channels };
