// =============================================================================
// FireISP 5.0 — GraphQL Client Helper (P3.3)
// =============================================================================
// Thin wrapper around graphql-request that automatically attaches the current
// JWT access token and points at the /api/v1/graphql endpoint.
//
// Usage:
//   import { gql } from '@/api/graphql';
//   const data = await gql<{ client: Client }>(`query { client(id: $id) { name } }`, { id: '1' });
// =============================================================================

import { GraphQLClient } from 'graphql-request';
import { authedFetch } from './client';

function getClient(): GraphQLClient {
  // IMPORTANT: when a custom `fetch` is supplied, graphql-request constructs a
  // `new URL(endpoint)`, which throws on a RELATIVE path ("Invalid URL:
  // /api/v1/graphql") BEFORE any request is sent — so the query silently failed
  // and the page showed "Client not found". Use an absolute, same-origin URL.
  const endpoint = `${window.location.origin}/api/v1/graphql`;
  // Route through authedFetch so GraphQL shares the REST client's token-attach +
  // CSRF header + silent-refresh-on-401 + retry. Reading the token per-request
  // (inside authedFetch) lets a request made right after a page reload (empty
  // in-memory token) recover instead of failing.
  return new GraphQLClient(endpoint, {
    credentials: 'include',
    fetch: authedFetch,
  });
}

/**
 * Execute a GraphQL document against the FireISP API.
 * Automatically attaches the current access token.
 */
export async function gql<T = unknown>(
  document: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  return getClient().request<T>(document, variables);
}
