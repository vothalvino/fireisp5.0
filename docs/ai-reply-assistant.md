# AI Reply Assistant — Step-by-Step Implementation Plan

This document is the build plan for adding an AI assistant that drafts (and
optionally auto-sends) professional answers to inbound client reports in
FireISP 5.0. The assistant is fully **topology-aware** (it knows where each
contract gets its service, including fiber and wireless backhauls) and is
constrained to a curated **phrase library** so its replies stay on-brand.

The plan is explicit about two operational requirements:

1. The administrator can **turn the chatbot on and off** — globally per
   organization, and per channel (portal, email, WhatsApp, SMS).
2. The administrator can **choose the LLM provider** (OpenAI, Azure OpenAI,
   Anthropic, Google Gemini, on-prem Ollama, …) and switch between them at
   any time without redeploying.

Each step below is intended to be a self-contained, testable PR.

---

## 0. Conventions used in this plan

- Backend code lives under `src/` and follows the existing service / model /
  route split (see `src/services`, `src/models`, `src/routes`).
- Frontend code lives under `frontend/src` (React + Vite + Vitest).
- Migrations are numbered files in `database/migrations/` — the next free
  number at the time of writing is **169** (last applied was 168 for
  PROFECO). Renumber as needed when the PR lands.
- Tests: Jest for backend (`pnpm exec jest`), Vitest for frontend
  (`pnpm --filter frontend test`).
- All new endpoints sit under `/api/v1/ai/*` and are mounted with
  `authenticate` + `orgScope` middleware, identical to the GraphQL gateway
  pattern in `src/graphql/index.js`.
- Permissions: add a new RBAC permission group `ai.*`
  (`ai.policy.read`, `ai.policy.write`, `ai.phrases.write`,
  `ai.reply.draft`, `ai.reply.send`, `ai.providers.write`).

---

## 1. Database & migrations

Create migration **`database/migrations/169_ai_assistant.sql`** that adds:

### 1.1 `ai_policies` (one row per organization)

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT PK | |
| `organization_id` | BIGINT FK | unique |
| `enabled` | TINYINT(1) | **master on/off switch for the chatbot** |
| `enabled_channels` | JSON | e.g. `{"portal":true,"email":true,"whatsapp":false,"sms":false}` |
| `mode` | ENUM('draft_only','suggest','auto_send') | default `draft_only` |
| `auto_send_confidence` | DECIMAL(3,2) | 0.00–1.00, default 0.85 |
| `default_locale` | VARCHAR(10) | e.g. `es-MX` |
| `tone` | ENUM('formal','neutral','friendly') | default `formal` |
| `redact_pii_before_llm` | TINYINT(1) | default 1 |
| `active_provider_id` | BIGINT FK → `ai_providers.id` | currently selected provider |
| `created_at`, `updated_at` | TIMESTAMP | |

### 1.2 `ai_providers` (multiple per org — admin can register many and choose one)

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT PK | |
| `organization_id` | BIGINT FK | |
| `name` | VARCHAR(100) | display name, e.g. "OpenAI prod" |
| `kind` | ENUM('openai','azure_openai','anthropic','gemini','ollama','custom') | |
| `model` | VARCHAR(100) | e.g. `gpt-4o-mini`, `claude-3-5-sonnet`, `llama3.1:8b` |
| `endpoint_url` | VARCHAR(500) NULL | for self-hosted / Azure |
| `api_key_encrypted` | TEXT NULL | encrypted via existing `Setting` encryption helper |
| `extra_config` | JSON NULL | deployment id, region, headers, … |
| `temperature` | DECIMAL(3,2) | default 0.20 |
| `max_tokens` | INT | default 800 |
| `timeout_ms` | INT | default 20000 |
| `enabled` | TINYINT(1) | provider can be disabled without deleting |
| `priority` | INT | used for fallback chain |
| `created_at`, `updated_at`, `deleted_at` | TIMESTAMP | soft-delete |

> Selecting a provider = setting `ai_policies.active_provider_id`.
> Multiple providers may exist; only one is "active" at a time, but
> `priority` allows automatic fallback when the active one errors.

### 1.3 `ai_phrase_library`

`id, organization_id, locale, category (greeting/apology/outage_update/…), text, is_required, created_at, updated_at, deleted_at`.

### 1.4 `ai_forbidden_terms`

`id, organization_id, locale, term, replacement NULL` — output validator
rejects any draft containing these.

### 1.5 `ai_reply_logs`

`id, organization_id, ticket_id, provider_id, classification, confidence,
context_snapshot JSON, prompt_hash, draft_text, final_text NULL,
action ENUM('proposed','edited','sent','auto_sent','discarded','failed'),
reviewer_user_id NULL, prompt_tokens, completion_tokens, cost_usd,
duration_ms, error TEXT NULL, created_at`.

### 1.6 `contract_topology_paths` (cache)

`id, contract_id UNIQUE, path JSON, computed_at`. JSON is the ordered list
of `{device_id, role, link_id, medium}` from CPE up to edge — populated by
`topologyContextService` and invalidated on contract / device / link change.

### 1.7 Light schema additions

- `network_links`: add `medium ENUM('fiber','wireless','copper')` and
  `role ENUM('access','distribution','backhaul','core')`.
- `devices`: add `role` with the same enum.

Add index on `(organization_id, enabled)` in `ai_policies` and on
`(organization_id, ticket_id)` in `ai_reply_logs`.

### 1.8 Quota counter

Extend `OrganizationQuota` with `ai_tokens_month` so the existing quota
middleware (see `src/services/quotaService.js`) can rate-limit AI usage
exactly like every other resource.

**Tests:** `tests/migrations/169_ai_assistant.test.js` runs the migration on
the test DB and asserts column existence + defaults.

---

## 2. Backend models

Create thin `BaseModel` subclasses mirroring the existing pattern (see
`src/models/MessageTemplate.js` as template):

- `src/models/AiPolicy.js`
- `src/models/AiProvider.js`
- `src/models/AiPhrase.js`
- `src/models/AiForbiddenTerm.js`
- `src/models/AiReplyLog.js`
- `src/models/ContractTopologyPath.js`

All use `static get hasOrgScope() { return true; }`. `AiProvider`,
`AiPhrase`, `AiForbiddenTerm` and `AiReplyLog` use soft-delete.

---

## 3. Service layer

Create the following modules in `src/services/`:

### 3.1 `topologyContextService.js`

- `buildPath(contractId)` — walks `Contract → IpAssignment → Nas/Device →
  NetworkLink graph` until it reaches a node flagged
  `role='core'` or `role='backhaul-edge'`. Stores result in
  `contract_topology_paths`. Detects loops and missing links.
- `getPath(contractId)` — returns cached path; rebuilds on miss.
- `summarize(contractId)` — returns a clean object the LLM prompt uses:
  ```
  { cpe, accessDevice, backhauls: [...], pop, activeOutages: [...] }
  ```
- `invalidate(contractId | deviceId | linkId)` — called by `Device`,
  `NetworkLink`, `Contract` hooks.

Reuses existing `Outage`, `Site`, `Device`, `NetworkLink`, `Nas` models.

### 3.2 `serviceHealthService.js`

Combines:

- Live RADIUS session (existing `radiusService.js`)
- Last `ConnectionLog`
- Recent `SnmpMetric` for each device on the path
- MikroTik queue / CoA state via existing `routerosService.js`
- Last `SpeedTest`

…into a single deterministic JSON snapshot. **No** LLM call here.

### 3.3 `phraseLibraryService.js`

CRUD + retrieval for `ai_phrase_library` and `ai_forbidden_terms`,
filtered by org + locale + category.

### 3.4 `llmProviderService.js` ★ (the pluggable provider layer)

Single abstraction with one method:

```
chat({ providerId, messages, jsonSchema, signal }) →
  { text, json, usage:{prompt_tokens, completion_tokens}, cost_usd }
```

Internally dispatches by `provider.kind`:

- `openai` → `openai` SDK
- `azure_openai` → `openai` SDK with `baseURL` + `api-version`
- `anthropic` → `@anthropic-ai/sdk`
- `gemini` → `@google/generative-ai`
- `ollama` → plain `fetch` to `endpoint_url`
- `custom` → POST to `endpoint_url` with org-defined header map

Behaviour:

- API keys decrypted from `ai_providers.api_key_encrypted` only inside
  this module — never returned to callers, never logged.
- Built-in retry (3x, exponential), timeout from `provider.timeout_ms`.
- Cost computed from a small price table per `(kind, model)`; unknown
  models default to 0 with a warning.
- **Fallback chain**: if the active provider errors, walk other
  `enabled` providers in `priority` order. Logged in `ai_reply_logs.error`.
- `verify(providerId)` does a 1-token round-trip — used by the admin UI's
  "Test connection" button.

Run **`gh-advisory-database`** before adding each SDK dependency.

### 3.5 `aiReplyService.js` (orchestrator)

Pipeline:

1. **Gate**: load `AiPolicy`. If `enabled=false` or the originating
   channel is not in `enabled_channels`, return `{skipped:true}`. This is
   the contract for the admin on/off switch.
2. **Classify** the inbound message (small prompt, JSON output:
   `{category, priority, language, confidence}`).
3. **Build context** via `topologyContextService.summarize` +
   `serviceHealthService`.
4. **Redact PII** (IP, MAC, phone, email, address) if
   `redact_pii_before_llm=true`. Keep the mapping in memory only.
5. **Render system prompt** with: tone, allowed phrases for the matched
   category, forbidden terms, structured context JSON, ticket history.
6. **Call** `llmProviderService.chat` with the active provider.
7. **Validate output**: required-phrase check, forbidden-term check,
   language match, length, no hallucinated devices/outages, no URLs
   outside the allowlist. Regenerate up to 2x on failure.
8. **Rehydrate PII** in the final text.
9. **Persist** an `AiReplyLog` row.
10. **Dispatch** based on `mode`:
    - `draft_only` → attach to ticket as internal "Suggested reply".
    - `suggest`     → same, plus notify the assigned agent.
    - `auto_send`   → if `confidence ≥ auto_send_confidence`, post as a
      `TicketComment` and send via the original channel; otherwise fall
      back to `suggest`.

### 3.6 Hooks

- Wire `Ticket` create + new `TicketComment` from a client to enqueue an
  `aiTriage` BullMQ job.
- Add invalidation hooks on `NetworkLink`, `Device`, `Contract` save to
  call `topologyContextService.invalidate`.

---

## 4. Background workers

Add to `src/workers/index.js` (alongside existing BullMQ workers):

- `aiTriageWorker` — consumes `ai-triage` jobs, runs `aiReplyService`.
- `aiBackfillEmbeddingsWorker` — re-embeds phrase library + resolved
  tickets when the library changes (only required if vector retrieval is
  enabled, see §8).
- `aiCostRollupWorker` — daily aggregation of `ai_reply_logs.cost_usd`
  into `OrganizationQuota.ai_tokens_month`.

Tests in `tests/workers/aiWorkers.test.js` mock the queue and verify
each handler's behaviour, including the "policy disabled → skipped" path.

---

## 5. REST + GraphQL surface

### 5.1 REST routes (`src/routes/ai.js`, mounted under `/api/v1/ai`)

| Verb + Path | Permission | Purpose |
|---|---|---|
| `GET /policy` | `ai.policy.read` | get current `AiPolicy` |
| `PUT /policy` | `ai.policy.write` | update — **this is where the admin flips chatbot on/off, picks the active provider, and toggles channels** |
| `GET /providers` | `ai.providers.read` | list registered providers (no keys) |
| `POST /providers` | `ai.providers.write` | register new provider, key encrypted |
| `PUT /providers/:id` | `ai.providers.write` | edit |
| `DELETE /providers/:id` | `ai.providers.write` | soft-delete |
| `POST /providers/:id/verify` | `ai.providers.write` | round-trip test |
| `GET /providers/catalog` | `ai.providers.read` | static list of supported `kind`s + recommended models (UI hint) |
| `GET /phrases` / `POST` / `PUT /:id` / `DELETE /:id` | `ai.phrases.*` | manage phrase library |
| `GET /forbidden-terms` / `POST` / `DELETE /:id` | `ai.phrases.*` | manage banned words |
| `POST /reply/draft` | `ai.reply.draft` | force-draft for a ticket (used by "Generate" button) |
| `POST /reply/send` | `ai.reply.send` | send/edit a previously generated draft |
| `GET /logs` | `ai.policy.read` | paginated audit |
| `GET /metrics` | `ai.policy.read` | drafts/day, edit-rate, auto-send-rate, cost |

All inputs validated via the existing Joi/zod pattern used in other routes.

### 5.2 GraphQL

Extend `src/graphql/typeDefs.js` with `aiPolicy`, `aiProviders`,
`aiPhrases`, `aiReplyLogs(ticketId)` queries and an `aiDraftReply` mutation
so the React ticket detail page can fetch everything in one round-trip.

### 5.3 OpenAPI

Run `pnpm spec:gen` so `docs/openapi.json` and the generated frontend
client stay in sync (see P3.11 spec-driven workflow).

---

## 6. Frontend

### 6.1 New page: `frontend/src/pages/AIAssistantSettings.tsx`

Tabbed UI under **Settings**:

- **General** tab
  - **Chatbot on/off** master toggle (binds to `policy.enabled`).
  - **Per-channel** toggles (portal / email / WhatsApp / SMS) bound to
    `policy.enabled_channels`.
  - Mode radio: Draft only / Suggest / Auto-send.
  - Auto-send confidence slider, default locale, tone selector.
  - "Redact PII before sending to provider" switch.
- **Providers** tab
  - Table of `ai_providers` with columns: name, kind, model, status,
    enabled, priority, actions.
  - "Add provider" modal with a `kind` dropdown that swaps the form
    fields (OpenAI key vs Azure endpoint+deployment vs Ollama URL …).
  - "Test connection" button → calls `POST /providers/:id/verify`.
  - Radio "Use as active" → updates `policy.active_provider_id`.
  - Drag-to-reorder for fallback `priority`.
- **Phrase library** tab — category-grouped editor with locale switcher;
  reuses existing `MessageTemplate` editor styling.
- **Forbidden terms** tab — simple list editor.
- **Audit & metrics** tab — read-only stats from `/ai/logs` + `/ai/metrics`.

### 6.2 Ticket detail panel

In `frontend/src/pages/TicketDetail.tsx` add an **AI Suggested Reply**
panel (visible only when `policy.enabled` and the agent has
`ai.reply.send`):

- Shows the latest `AiReplyLog` for the ticket (draft text, classification,
  confidence badge, provider name + cost).
- Topology breadcrumb visualising `topologyContextService.summarize`
  output: CPE → access device → backhaul (with fiber/wireless icon) →
  POP, with red dot on any node with an active outage.
- Buttons: **Send**, **Edit & send**, **Regenerate**, **Discard** — each
  records the action in `ai_reply_logs.action`.

### 6.3 i18n

Add new keys to `frontend/src/locales/{en,es,pt-BR}.json`. Run the existing
`i18n-coverage.mjs` script to verify coverage parity (P3.5).

### 6.4 Tests

- `frontend/src/__tests__/aiSettings.test.tsx` — toggling the master
  switch posts `enabled:false`; switching active provider posts the new
  `active_provider_id`; "Test connection" surfaces success/failure.
- `frontend/src/__tests__/aiSuggestedReply.test.tsx` — render, edit,
  send, regenerate flows.
- A11y: extend `a11y.test.tsx` with the new screens (P3.1).

---

## 7. Security, privacy, multi-tenancy

- Every route + worker is org-scoped. Add a property-based test in
  `multitenantIsolation.test.js` (P2.3) covering `ai_*` tables.
- API keys are encrypted at rest using the same helper as `Setting`
  values. They are never returned by `GET /providers`.
- DSAR (`src/routes/dsar.js`): include `ai_reply_logs` for the requesting
  client in the export, redact internal prompts.
- Add `ai.*` permissions to `seed_permissions.sql` and assign by default
  to the `admin` role only.
- Update `docs/privacy.md`: explicit notice that prompts may be sent to
  the configured external LLM unless `redact_pii_before_llm=true` and/or
  an on-prem provider (Ollama) is selected.
- Update `docs/secrets-management.md` with a section on rotating provider
  API keys.

---

## 8. Optional: Retrieval-Augmented Generation (RAG)

Phase-3 enhancement, not required for v1:

- Add `pgvector`-equivalent or a sidecar (e.g. `chromadb` in
  `docker-compose.yml` behind a profile) and store embeddings of phrase
  library + resolved tickets.
- `phraseLibraryService.search(query, k)` returns top-k chunks for the
  prompt. Embedding model is also selected per provider.

Skip in the first PR set — structured context alone (§3.1) is enough to
prove the design.

---

## 9. Testing & CI

- New Jest suites: `aiPolicy.test.js`, `aiProvider.test.js`,
  `llmProviderService.test.js` (with a deterministic mock provider),
  `aiReplyService.test.js` (covers: disabled-policy short-circuit,
  forbidden-term rejection, hallucination rejection, PII round-trip,
  auto-send threshold, fallback to next provider on error),
  `topologyContextService.test.js` (graph traversal + loop detection),
  `phraseLibraryService.test.js`.
- New Vitest suites as listed in §6.4.
- `pnpm spec:check` must pass (no OpenAPI drift).
- DAST (P2.2) automatically picks up the new endpoints.

Aim: leave the project at **0 Jest failures** and **0 Vitest failures**
after each PR — matches the project's existing standard.

---

## 10. Documentation

- This file (`docs/ai-reply-assistant.md`).
- Add a short "AI Assistant" section to `README.md` and `docs/runbook.md`
  (how to switch off the chatbot in an emergency: `PUT /api/v1/ai/policy`
  `{enabled:false}` or untick the master switch in Settings).
- Add an entry to `ROADMAP.md` and to the changelog panel (P3.8).
- Add an ADR in `docs/adr/` titled
  `ADR-00XX-pluggable-llm-providers.md` documenting the provider
  abstraction and the on/off semantics.

---

## 11. Phased rollout (suggested PR breakdown)

Each phase = one PR, each PR keeps the test suite green.

| Phase | Scope | Visible to user? |
|---|---|---|
| **P1** Migrations + models + topology cache | §1, §2, §3.1, §3.2 | No (data only) |
| **P2** Provider registry + admin UI | §3.4 (no chat yet, just `verify`), §5.1 (`/providers`, `/policy`), §6.1 General + Providers tabs | Admin can register providers and flip the master toggle (no replies generated yet) |
| **P3** Phrase library + forbidden terms | §3.3, §5.1 (phrases), §6.1 Phrase tab | Admin manages library |
| **P4** Reply orchestrator (draft only) | §3.5, §3.6, §4 (`aiTriageWorker`), §5.1 (`/reply/*`), §6.2 Suggested reply panel | Agents see drafts |
| **P5** Auto-send + metrics + RBAC + DSAR | mode=auto_send, `/metrics`, audit tab, `ai_cost_rollup` worker, privacy doc | Full feature |
| **P6** (optional) RAG | §8 | Quality bump |

---

## 12. Acceptance checklist

A PR series is "done" when:

- [x] An admin can open **Settings → AI Assistant** and toggle the
      chatbot **off**; within one request, no further AI drafts are
      generated for that org (verified by integration test).
- [x] An admin can register an OpenAI, Azure OpenAI, Anthropic, Gemini
      and Ollama provider, click **Test connection**, and the call
      succeeds end-to-end.
- [x] Switching the **active provider** in the UI causes the next ticket
      draft to be produced by the new provider (verified by inspecting
      `ai_reply_logs.provider_id`).
- [x] If the active provider returns an error, the next provider in
      `priority` order is used and the failure is recorded.
- [x] A draft generated for a ticket includes references to the
      contract's actual access device and backhaul medium (fiber /
      wireless), pulled from `topologyContextService`.
- [x] No draft is ever sent that contains a forbidden term or that
      omits a required phrase.
- [x] Backend test suite passes with 0 failures; frontend test suite
      passes with 0 failures; OpenAPI spec is in sync.
