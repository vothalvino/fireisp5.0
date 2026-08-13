// =============================================================================
// FireISP 5.0 — useWebSocket tests
// =============================================================================

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '@/api/client';
import { BROWSER_WS_PATH, useWebSocket } from '@/api/useWebSocket';

type WsHandler = ((event: { data?: string }) => void) | null;

class MockWebSocket {
  static readonly OPEN = 1;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = 0;
  onopen: WsHandler = null;
  onmessage: WsHandler = null;
  onclose: WsHandler = null;
  onerror: WsHandler = null;
  sent: string[] = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({});
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({});
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

describe('useWebSocket', () => {
  beforeEach(() => {
    tokenStore.clear();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    tokenStore.clear();
  });

  it('connects through the scoped httpOnly cookie when the memory token is empty', () => {
    const { result, unmount } = renderHook(() => useWebSocket('notifications'));
    const ws = MockWebSocket.instances[0];

    expect(ws).toBeDefined();
    expect(ws.url).toBe(`ws://${window.location.host}${BROWSER_WS_PATH}`);
    act(() => ws.open());
    expect(ws.sent).toEqual([JSON.stringify({ type: 'auth' })]);

    act(() => ws.receive({ type: 'auth_ok', orgId: 1 }));
    expect(ws.sent[1]).toBe(JSON.stringify({ type: 'subscribe', channel: 'notifications' }));
    act(() => ws.receive({ type: 'subscribed', channel: 'org:1:notifications' }));
    expect(result.current.connected).toBe(true);

    unmount();
    expect(ws.closed).toBe(true);
  });

  it('keeps explicit access-token authentication for freshly logged-in sessions', () => {
    tokenStore.setAccess('memory-access-token');
    const { unmount } = renderHook(() => useWebSocket('metrics'));
    const ws = MockWebSocket.instances[0];

    act(() => ws.open());
    expect(ws.sent).toEqual([
      JSON.stringify({ type: 'auth', token: 'memory-access-token' }),
    ]);

    unmount();
  });
});
