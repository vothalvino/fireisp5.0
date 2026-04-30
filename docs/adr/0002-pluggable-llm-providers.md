# ADR 0002 — Pluggable LLM Provider Abstraction

**Date:** 2026-04-30  
**Status:** Accepted  
**Deciders:** FireISP core team

---

## Context

FireISP 5.0 ships an AI Reply Assistant that drafts (and optionally auto-sends)
professional answers to inbound support tickets. The assistant needs to call a
Large Language Model (LLM) for every reply it generates.

Several operational requirements shaped the design:

1. **No single-vendor lock-in.** ISPs range from large carriers with Microsoft
   Azure contracts to small operators who prefer to keep data on-premises. The
   system must accommodate all of them without code changes.
2. **Zero-downtime provider switching.** When a provider's API is degraded, or when
   the operator wants to try a cheaper model, they must be able to switch the active
   provider from the admin UI without redeploying.
3. **Instant kill switch.** The entire chatbot must be possible to turn off in
   seconds (e.g., during a compliance review or a provider outage) and be
   re-enabled just as quickly.
4. **Cost visibility.** Every LLM call has a cost. The system must track token usage
   and estimated USD cost per reply so operators can budget and set quotas.
5. **On-premises option.** Some ISPs operate in bandwidth-constrained regions or have
   strict data-residency requirements. They must be able to run an Ollama instance
   locally and point FireISP at it.
6. **Testability.** Unit tests must not call real LLM APIs. The abstraction must
   support deterministic mock implementations.

## Options Considered

### Option A — Hard-code OpenAI

Wire the OpenAI Node.js SDK directly into `aiReplyService.js`.

**Pros:** Simplest initial implementation; mature SDK.  
**Cons:** Violates requirements 1–3 and 5. Cannot be easily mocked (requires
`jest.mock('openai')`). Breaks any customer not on OpenAI.

### Option B — Strategy pattern with a provider registry table

Store provider configuration (kind, model, endpoint URL, encrypted API key, priority)
in the `ai_providers` table and resolve the active provider at runtime through a
dedicated `llmProviderService`.

**Pros:** Satisfies all six requirements. Provider switching is a database write, not
a deployment. New providers can be added without changing the service interface.  
**Cons:** More indirection; requires an extra DB round-trip per request (mitigated by
the provider record being fetched once per policy object, which is cached at the route
layer).

### Option C — Environment-variable-driven adapter

Read `LLM_PROVIDER=openai|anthropic|...` from the environment and load the matching
adapter at startup.

**Pros:** Simple, no DB dependency for provider selection.  
**Cons:** Changing the provider requires a restart (violates requirement 2). Does not
support per-organization providers (violates requirement 1 for multi-tenant
deployments). Cannot express fallback ordering across multiple registered providers.

## Decision

**Option B — Strategy pattern with a provider registry table** is adopted.

`llmProviderService.js` (`src/services/llmProviderService.js`) implements the
abstraction:

```
llmProviderService
  .chat(messages, providerId, orgId)   → { text, usage, cost_usd }
  .verify(providerId, orgId)           → { ok, latency_ms, error? }
  .embed(text, providerId, orgId)      → Float32Array   (RAG only)
```

### Provider kinds

| `kind` | SDK / transport | Notes |
|---|---|---|
| `openai` | `openai` npm package | GPT-3.5 / GPT-4 / GPT-4o families |
| `azure_openai` | `openai` npm package with `azureEndpoint` | Azure-hosted OpenAI deployments |
| `anthropic` | `@anthropic-ai/sdk` | Claude families |
| `gemini` | `@google/generative-ai` | Gemini Pro / Flash families |
| `ollama` | HTTP fetch to `endpoint_url` | On-premises; no API key required |
| `custom` | HTTP fetch to `endpoint_url` | OpenAI-compatible API (e.g., LM Studio, vLLM) |

### On/off semantics

The master on/off switch lives in `ai_policies.enabled` (one row per organization).
It is checked at the **gate** step (step 1 of 10) in `aiReplyService.js`, before any
LLM call is made. Setting `enabled = 0` costs one DB read and nothing else.

Per-channel toggles (`enabled_channels` JSON column) are checked at the same gate
step, after the master switch.

Both can be updated via:

```
PUT /api/v1/ai/policy   { "enabled": false }
```

or via the admin UI under **Settings → AI Assistant → General**.

### Fallback chain

`ai_providers` has a `priority` column. When `chat()` fails for the active provider
(after 3 internal retries), `llmProviderService` iterates the remaining enabled
providers for the org in ascending priority order and retries on the next one.
This allows operators to register a cheap Ollama instance as a fallback for API
outages.

### Cost tracking

A static cost table maps `(kind, model)` → cost per 1 000 tokens (input and output
separately). After every successful `chat()` call the service returns `cost_usd`
which is persisted in `ai_reply_logs.cost_usd`. The `aiCostRollupWorker` aggregates
daily totals into `organization_quotas` so the billing/quota engine can enforce
monthly LLM-spend caps.

### Embedding / RAG

`embed()` is implemented for OpenAI (text-embedding-3-small), Azure OpenAI, Google
Gemini (embedding-001), and Ollama (api/embed). Anthropic and custom providers throw
`LLM_EMBED_NOT_SUPPORTED` — this causes `phraseLibraryService.search()` to return an
empty array (graceful degradation) rather than failing the reply pipeline.

## Consequences

- `src/services/llmProviderService.js` is the single file to edit when adding a new
  provider kind. No changes are needed in `aiReplyService.js` or the route layer.
- API keys are stored encrypted at rest using `src/utils/encryption.js` (AES-256-GCM)
  and are **never** returned by `GET /api/v1/ai/providers` — only an `is_key_set`
  boolean is surfaced.
- Tests mock `llmProviderService.chat` at the module boundary; no real LLM calls are
  made during `pnpm test`.
- When `REDIS_URL` is not set, the BullMQ workers fall back to inline execution. The
  AI triage worker still fires; it just runs synchronously in the request handler
  rather than in a separate process.
- The ChromaDB RAG sidecar is entirely opt-in (`VECTOR_RETRIEVAL_ENABLED=true`,
  `--profile rag` in Docker Compose). When disabled, all vector store calls are
  no-ops and the reply pipeline proceeds with structured context only.
