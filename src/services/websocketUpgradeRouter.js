// =============================================================================
// FireISP 5.0 — shared WebSocket upgrade router
// =============================================================================
// Node's HTTP server broadcasts every `upgrade` event to every listener. The
// `ws` package's `{ server, path }` shortcut rejects paths it does not own,
// which makes multiple WebSocketServer instances on one HTTP server race with
// one another. Keep one listener per HTTP server, route exact paths to their
// owner, and close everything else explicitly so unknown upgrades cannot leak
// raw sockets.
// =============================================================================

/** @type {WeakMap<import('http').Server, {routes: Map<string, Function>, listener: Function}>} */
const serverRouters = new WeakMap();

function rejectUpgrade(socket) {
  if (socket.destroyed) return;
  socket.end(
    'HTTP/1.1 404 Not Found\r\n'
      + 'Connection: close\r\n'
      + 'Content-Length: 0\r\n'
      + '\r\n',
  );
}

function createRouter(httpServer) {
  const state = { routes: new Map(), listener: null };
  state.listener = (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname;
    } catch (_err) {
      rejectUpgrade(socket);
      return;
    }

    const route = state.routes.get(pathname);
    if (!route) {
      rejectUpgrade(socket);
      return;
    }

    try {
      route(req, socket, head);
    } catch (_err) {
      rejectUpgrade(socket);
    }
  };
  httpServer.on('upgrade', state.listener);
  serverRouters.set(httpServer, state);
  return state;
}

/**
 * Register one exact WebSocket path and return an idempotent unregister hook.
 *
 * @param {import('http').Server} httpServer
 * @param {string} pathname
 * @param {(req: import('http').IncomingMessage, socket: import('stream').Duplex, head: Buffer) => void} handler
 * @returns {() => void}
 */
function registerWebSocketRoute(httpServer, pathname, handler) {
  const state = serverRouters.get(httpServer) || createRouter(httpServer);
  if (state.routes.has(pathname)) {
    throw new Error(`WebSocket upgrade path already registered: ${pathname}`);
  }
  state.routes.set(pathname, handler);

  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    state.routes.delete(pathname);
    if (state.routes.size === 0) {
      httpServer.off('upgrade', state.listener);
      serverRouters.delete(httpServer);
    }
  };
}

module.exports = { registerWebSocketRoute };
