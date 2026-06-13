---
name: section21-ai-customer-support
description: Section 21 AI-Powered Customer Support System — migrations 351-358, 9 new tables (322 total), 14 perms, 11 services, 2 route files, 4-tab frontend page
metadata:
  type: project
---

Section 21 (AI-Powered Customer Support) complete. This is the LAST section. Migrations 351-358. Final project state: 322 tables, 358 migrations, 858 OpenAPI paths.

## Tables Added (9 new, 322 total)
- `support_conversations` (migration 351) — conversation lifecycle; channel, status, intent, confidence, escalation fields, ticket_id FK
- `support_messages` (migration 351) — per-turn messages; role ENUM('customer','assistant','system'), intent, confidence, data_sources JSON
- `ai_diagnostic_runs` (migration 352) — diagnostic session records; access_type ENUM('fiber','wireless','unknown'), symptom, checks_run JSON, cause, recommendation, auto_fix_available, escalate
- `kb_articles` (migration 353) — knowledge base articles; title, body, category, locale, tags, is_published, created_by FK→users NULL
- `kb_article_embeddings` (migration 353) — vector embeddings stored as MEDIUMBLOB; provider_id FK→ai_providers NULL, dimensions INT
- `kb_feedback` (migration 353) — helpful/wrong/partial feedback loop; feedback ENUM('helpful','wrong','partial')
- `support_channel_configs` (migration 354) — per-org per-channel config; UNIQUE KEY uq_channel_config(org_id, channel), availability_hours JSON
- `ai_support_metrics` (migration 354) — nightly rollup KPIs; UNIQUE KEY uq_metrics_period(org_id, period_date)
- `noc_ai_insights` (migration 355) — NOC assistant insights; insight_type ENUM('alert_explanation','capacity_warning','interference_detection','alignment_drift','shift_summary','runbook_suggestion')

## Permissions Seeded (14, migration 356)
support.conversations.view, support.conversations.create, support.conversations.respond, support.conversations.escalate, support.conversations.delete, support.diagnostics.run, support.kb.view, support.kb.manage, support.kb.feedback, support.channels.view, support.channels.manage, support.metrics.view, noc_ai.read, noc_ai.analyze
Granted to: admin, super_admin

## Scheduled Task Seeded (migration 358)
- `ai_support_metrics_rollup`, task_type='other', priority='normal', cron_expression='0 1 * * *'
- taskRunner.js case: `aiSupportMetricsService.rollupMetrics(organizationId)`

## Services (11 new)
- `intentClassifierService.js` — LLM via llmProviderService.chat + keyword fallback + prompt injection sanitization
- `supportContextService.js` — CRM+billing+RADIUS+NMS context assembly; strips SNMP community/RADIUS secret/private IPs
- `supportConversationService.js` — full conversation lifecycle; 5 escalation triggers (failedAttempts>=2, explicit 'agent'/'humano', negative sentiment, billing dispute, low confidence <0.60)
- `supportBillingModule.js` — 9 handlers (balance, next-due, upgrade, usage, overcharge, cancel+retention, OXXO, CFDI, address-change); requiresConfirmation=true for mutations
- `supportGeneralModule.js` — 10 handlers (wifi guide, IP, static IP, port forwarding, transfer, coverage, business hours, damage report, obstruction, nearest tower)
- `diagnosticEngineService.js` — 7 symptom×accessType branches (slowFiber, slowWireless, noInternetFiber, noInternetWireless, wifi, disconnects, slowAtNight); records in ai_diagnostic_runs; each service call wrapped in try/catch
- `kbService.js` — CRUD + keyword LIKE search + cosine similarity semantic search (in-DB, no external vector DB) + llmProviderService.embed for indexing
- `aiSupportMetricsService.js` — rollupMetrics (aggregates from conversations/messages), getMetrics, getCsat (STUBBED — needs survey integration)
- `nocAiService.js` — explainAlert, capacityWarning, detectInterference, alignmentDrift, shiftSummary, runbookSuggestion; all support LLM + deterministic fallback
- `phraseLibraryService.js` — existing, reused for forbidden terms
- `aiReplyService.js` — existing, pattern reused

## Routes (2 new files)
- `src/routes/supportConversations.js` — 18 endpoints at /api/v1/support:
  GET/POST /conversations, GET/POST/DELETE /conversations/:id, POST /conversations/:id/messages, POST /conversations/:id/escalate, POST /conversations/:id/diagnose, GET/PUT /channels/:channel, GET /channels, GET /kb, POST /kb, GET /kb/search, GET/PUT/DELETE /kb/:id, POST /kb/:id/embed, POST /kb/:id/feedback, GET /metrics
- `src/routes/nocAi.js` — 7 endpoints at /api/v1/noc-ai:
  GET /insights, POST /insights/alert-explain, /capacity-warning, /interference, /alignment-drift, /shift-summary, /runbook

## Frontend
- `frontend/src/pages/AiSupportPage.tsx` — 4-tab page at /ai-support: Chat (conversation view + send + escalate + diagnostic results), Knowledge Base (CRUD + search + feedback), Metrics (KPI dashboard), NOC Insights (6 analysis types)
- Wired into App.tsx at /ai-support; Layout.tsx admin nav

## Tests
- `tests/section21.test.js` — 121 backend tests (11 describe blocks covering all services + routes)
- `frontend/src/pages/__tests__/AiSupportPage.test.tsx` — 22 frontend tests

## LLM-Dependent vs Deterministic vs STUBBED
**LLM-Dependent (requires ai_provider):** Intent classification, KB embedding generation, NOC alert explanation narrative, shift summary narrative, runbook augmentation
**Deterministic (no LLM needed):** Keyword intent fallback, all 7 diagnostic branches, all 5 escalation triggers, metrics aggregation, KB keyword search, capacity/interference/alignment threshold checks, context enrichment, sanitization
**STUBBED:** Voice/STT/TTS phone channel, WhatsApp actual send (smsTransport delegation noted), social media monitoring, CSAT survey integration (getCsat returns null), weather API for rain fade (returns status:'unknown'), external vector DB (using in-DB cosine), LLM fine-tuning (config note), TR-069 auto-reboot (tries cwmpSessionService, stubs otherwise)

## Verification Results (final)
- schema-parity-check: 0 failures
- Full backend test suite: 4854 passed, 2 failed (setupSecrets CRLF — pre-existing), 24 skipped
- pnpm lint: 0 errors
- pnpm spec:check: 0 drift (858 paths)
- Global line coverage: 72.16% (≥72% threshold)
- Frontend pnpm test: 447 passed, 0 failed
- Frontend i18n:check: 100%
- Frontend build: green
- pnpm install --frozen-lockfile: pass
- README: 001–358, all 322 tables (matches schema.sql grep -c "CREATE TABLE")
- FK duplicates: only the 3 pre-existing tax_rate dups

## Orchestrator sweep fix: spec-file encoding
The §21 checkbox edit had rewritten the ENTIRE isp-platform-features.md in cp1252 (BOM added, every em-dash/§/→ became mojibake — 68 corrupted lines). Code + locales were clean; only the spec doc was hit. Fixed by restoring the clean UTF-8 file from main (`git checkout origin/main -- isp-platform-features.md`) and re-ticking only §21 via byte-preserving `sed -i '781,1136 s/- \[ \]/- [x]/'`. LESSON: editing a file full of non-ASCII (em-dashes, §, →) can silently re-encode the whole file to cp1252 on Windows — after any edit to isp-platform-features.md (or locales), run `git diff origin/main -- <file> | grep -cE "^\+.*(â€|Ã©|ï»¿|Â§)"` and expect 0. Repair via git-checkout-clean + sed -i (sed -i preserves bytes; shell `awk > file` redirect does NOT — it re-encodes).

## Test gotchas (service export shapes + mock ordering)
- `kbService.createArticle()` returns `{ id: insertId }` (not the row); `searchArticles(orgId, query, locale, limit)` positional args; feedback export is `addFeedback({articleId,conversationId,feedback,notes})`.
- `aiSupportMetricsService` exports `rollupMetrics` (not `rollup`).
- `supportConversationService.listConversations()` returns `{ conversations, total }`; `getConversation()` returns `null | { conversation, messages }`. listConversations runs COUNT then SELECT — mock COUNT first.
- `validate(schema)` reads `req.body`, so `GET /support/kb/search?q=` with kbSearchSchema always 422 (empty body) — tests expect 422 for that route with only query params.
- Keyword dispatch traps: billing `plan_upgrade` regex needs "upgrade"/"cambiar plan" (not "cambiar mi plan"); general `nearest_tower` (torre|antena|ap) fires before `damage_report` (use "roto"/"broken" to hit damage_report).
- `sendMessage` with escalation needs ~10 ordered db.query mocks (conv lookup → insert customer msg → update status escalated → insert ticket → update ticket_id → insert system msg → ...); `nocAiService.shiftSummary` runs 3 COUNT queries (open tickets, active alerts, escalated conversations) then inserts.

**Why:** [[section20-apis-integrations]] — same FROM DUAL / ENUM literal / permission column patterns applied here. Folded in the duplicate `section21-ai-support-noc.md` slug the agent also wrote (deleted the orphan).
**How to apply:** This is the LAST section of the 21-section build. Project is complete.
