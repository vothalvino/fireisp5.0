// =============================================================================
// FireISP 5.0 — useGraphQLSubscription hook tests (P3.9)
// =============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGraphQLSubscription } from '@/api/useGraphQLSubscription';

// ---------------------------------------------------------------------------
// Mock tokenStore
// ---------------------------------------------------------------------------

vi.mock('@/api/client', () => ({
  tokenStore: {
    getAccess: () => 'test-token',
    setAccess: vi.fn(),
    getRefresh: () => null,
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// EventSource mock
// ---------------------------------------------------------------------------

type ESHandler = (ev: { data: string }) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  private handlers: Record<string, ESHandler[]> = {};
  readyState = 0;
  closed = false;

  constructor(url: string, _opts?: unknown) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: ESHandler) {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(handler);
  }

  emit(type: string, data: string) {
    (this.handlers[type] ?? []).forEach((h) => h({ data }));
  }

  close() {
    this.closed = true;
    MockEventSource.instances = MockEventSource.instances.filter((es) => es !== this);
  }
}

vi.stubGlobal('EventSource', MockEventSource);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useGraphQLSubscription', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
  });

  afterEach(() => {
    MockEventSource.instances.forEach((es) => es.close());
    MockEventSource.instances = [];
  });

  it('returns { data: null, error: null } initially', () => {
    const { result } = renderHook(() =>
      useGraphQLSubscription('subscription { test }', {}),
    );
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('processes a data event correctly', async () => {
    const { result } = renderHook(() =>
      useGraphQLSubscription<{ ticketCommentAdded: { id: number } }>(
        'subscription($ticketId: ID!) { ticketCommentAdded(ticketId: $ticketId) { id } }',
        { ticketId: '1' },
      ),
    );

    const es = MockEventSource.instances[0];
    expect(es).toBeDefined();

    await act(async () => {
      es.emit('message', JSON.stringify({ data: { ticketCommentAdded: { id: 42 } } }));
    });

    expect(result.current.data).toEqual({ ticketCommentAdded: { id: 42 } });
    expect(result.current.error).toBeNull();
  });

  it('cleans up EventSource on unmount', () => {
    const { unmount } = renderHook(() =>
      useGraphQLSubscription('subscription { test }', {}),
    );
    const es = MockEventSource.instances[0];
    expect(es).toBeDefined();
    unmount();
    expect(es.closed).toBe(true);
  });

  it('sets error on EventSource error event', async () => {
    const { result } = renderHook(() =>
      useGraphQLSubscription('subscription { test }', {}),
    );

    const es = MockEventSource.instances[0];

    await act(async () => {
      es.emit('error', '');
    });

    expect(result.current.error).toBe('Subscription connection error');
  });
});
