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

const GQL_ENDPOINT = '/api/v1/graphql';

function getClient(): GraphQLClient {
  // Route through authedFetch so GraphQL shares the REST client's token-attach +
  // silent-refresh-on-401 + retry. Reading the token per-request (inside
  // authedFetch) rather than at client-construction time is what lets a request
  // made right after a page reload (empty in-memory token) recover instead of
  // failing with "Client not found".
  return new GraphQLClient(GQL_ENDPOINT, {
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
