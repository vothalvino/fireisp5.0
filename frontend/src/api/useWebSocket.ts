// =============================================================================
// FireISP 5.0 — useWebSocket hook
// =============================================================================
// React hook that opens a WebSocket to the server's /ws hub, authenticates
// with the current access token, subscribes to a channel, and exposes the
// most-recent push event.
//
// Usage:
//   const { lastMessage, connected } = useWebSocket('notifications');
//   const { lastMessage } = useWebSocket(`ticket:${ticketId}`);
//
// The hook handles:
//   • JWT authentication via the first JSON message
//   • Channel subscription after auth
//   • Exponential-backoff reconnection (500ms → 30s ceiling)
//   • Cleanup on unmount
// =============================================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { tokenStore } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WsEvent {
  event: string;
  data: unknown;
  channel: string;
}

interface UseWebSocketResult {
  /** Most-recent event pushed by the server, or null before first event. */
  lastMessage: WsEvent | null;
  /** True when the WebSocket is open and authenticated. */
  connected: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 30_000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Open a persistent, authenticated WebSocket to /ws and subscribe to
 * `channel`.  The hook reconnects automatically with exponential backoff.
 *
 * @param channel - Relative channel name: "notifications" | "metrics" |
 *                  "outages" | "ticket:<id>"
 */
export function useWebSocket(channel: string): UseWebSocketResult {
  const [lastMessage, setLastMessage] = useState<WsEvent | null>(null);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(MIN_RECONNECT_MS);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  const connect = useCallback(() => {
    if (unmounted.current) return;

    const token = tokenStore.getAccess();
    if (!token) {
      // No access token yet — retry after minimum delay
      reconnectTimer.current = setTimeout(connect, MIN_RECONNECT_MS);
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      // Authenticate immediately on open
      ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (ev) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(ev.data as string) as Record<string, unknown>;
      } catch {
        return;
      }

      if (msg.type === 'auth_ok') {
        // Subscribe to the requested channel
        ws.send(JSON.stringify({ type: 'subscribe', channel }));
      } else if (msg.type === 'subscribed') {
        setConnected(true);
        reconnectDelay.current = MIN_RECONNECT_MS; // reset backoff on success
      } else if (msg.type === 'event') {
        setLastMessage({
          event: msg.event as string,
          data: msg.data,
          channel: msg.channel as string,
        });
      }
      // auth_fail, error, unsubscribed — silently ignore in production
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      if (!unmounted.current) {
        reconnectTimer.current = setTimeout(() => {
          reconnectDelay.current = Math.min(
            reconnectDelay.current * 2,
            MAX_RECONNECT_MS,
          );
          connect();
        }, reconnectDelay.current);
      }
    };

    ws.onerror = () => {
      // onclose fires right after onerror — reconnect logic lives there
    };
  }, [channel]);

  useEffect(() => {
    unmounted.current = false;
    connect();

    return () => {
      unmounted.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect loop on intentional unmount
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, [connect]);

  return { lastMessage, connected };
}
