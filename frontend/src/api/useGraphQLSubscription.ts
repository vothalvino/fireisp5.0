// =============================================================================
// FireISP 5.0 — useGraphQLSubscription hook (P3.9)
// =============================================================================
// Connects to the graphql-yoga SSE subscription endpoint via EventSource.
// Sends the subscription query as GET params, parses data events, and cleans
// up on unmount.
// =============================================================================

import { useState, useEffect, useRef } from 'react';
import { tokenStore } from '@/api/client';

const GQL_ENDPOINT = '/api/v1/graphql';

export interface GraphQLSubscriptionResult<T> {
  data: T | null;
  error: string | null;
}

export function useGraphQLSubscription<T>(
  query: string,
  variables: Record<string, unknown> = {},
): GraphQLSubscriptionResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('query', query);
    if (Object.keys(variables).length > 0) {
      params.set('variables', JSON.stringify(variables));
    }
    const token = tokenStore.getAccess();
    if (token) {
      params.set('extensions', JSON.stringify({ authorization: `Bearer ${token}` }));
    }

    const url = `${GQL_ENDPOINT}?${params.toString()}`;
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    es.addEventListener('message', (ev) => {
      try {
        const parsed = JSON.parse(ev.data as string) as { data?: T; errors?: Array<{ message: string }> };
        if (parsed.errors && parsed.errors.length > 0) {
          setError(parsed.errors[0].message);
        } else if (parsed.data !== undefined) {
          setData(parsed.data);
        }
      } catch {
        setError('Failed to parse subscription event');
      }
    });

    es.addEventListener('error', () => {
      setError('Subscription connection error');
    });

    return () => {
      es.close();
      esRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, JSON.stringify(variables)]);

  return { data, error };
}
