---
name: section18-automation-scripting
description: §18 Automation & Scripting — migrations 336-343 complete; 14 new tables (303 total), 30 perms, 7 route files + 7-tab frontend page; next migration: 344
metadata:
  type: project
---

Migrations 336–343 complete on branch `18-of-isp-platform-feature.md`.

**Tables added (14, total now 303):**
- 336: automation_rules, automation_rule_executions
- 337: batch_jobs, batch_job_items
- 338: provisioning_pipelines, provisioning_pipeline_stages
- 339: remediation_rules, remediation_executions
- 340: automation_scripts, script_executions
- 341: router_driver_configs, device_command_executions
- 342: analytics_anomalies, churn_scores
- 343: seed 30 permissions (modules: automation, network, analytics) + 3 scheduled tasks

**Scheduled tasks seeded (taskRunner.js cases added):**
- `anomaly_detection` (*/15 * * * *)
- `churn_score_computation` (0 2 * * *)
- `remediation_evaluation` (*/5 * * * *)

**Orchestrator sweep fix to migration 343 scheduled-task seeds (would have broken migration-runner CI — caught offline, no local MySQL):**
- `task_type` was `'system'` — NOT a valid scheduled_tasks enum value (valid: auto_suspend, generate_invoice, radius_sync, snmp_poll, usage_rollup, cleanup, notification, backup, maintenance, webhook_retry, other). Changed all 3 to `'other'`. MySQL 8 strict mode REJECTS invalid enum inserts.
- `priority` was numeric (60/40/70) — but priority is `ENUM('low','normal','high','critical')`; numerics are invalid. Changed to 'normal'/'low'/'high'.
- The seeds used `SELECT ... WHERE NOT EXISTS` WITHOUT `FROM DUAL` — MySQL requires `FROM DUAL` for a WHERE with no table (syntax error otherwise). Added `FROM DUAL`.
- LESSON: scheduled_tasks (and ANY) idempotent seeds must (1) use only valid ENUM literals for task_type AND priority, (2) use `FROM DUAL WHERE NOT EXISTS`. schema-parity-check does NOT validate enum values or this syntax — only CI's real MySQL does, so eyeball every seed's enum columns + FROM DUAL.

**Services:**
- automationService.js: evaluateAutomationRules, createBatchJob, runProvisioningPipeline, evaluateRemediationRules
- scriptingService.js: SECURITY — NO child_process anywhere; execute() creates 'queued' record only
- routerDriverService.js: MikroTik live via routerosService.js; Cisco/Juniper/ZTE/Huawei/REST STUBBED
- analyticsService.js: z-score anomaly detection, predictive failure thresholds, alert correlation (§6 reuse), bandwidth forecast (§15 reuse), churn scoring (rule-based)

**Routes (7 new files):**
automationRules.js, batchJobs.js, provisioningPipelines.js, remediationRules.js, automationScripts.js (admin-only IP allowlist), routerDrivers.js, analyticsAI.js
- Static routes defined BEFORE param routes to prevent "evaluate"/"executions" being matched as `:id`
- automationScripts mounted with `adminIpAllowlist` middleware in app.js

**Frontend:** AutomationPage.tsx (7 tabs); route `/automation`; nav.automation i18n key in all 3 locales.

**Test patterns:**
- jest.mock('../src/services/reportService') needed for bandwidth-forecast test (capacityForecast makes its own db.query)
- Provisioning pipeline mock count with contract_id=null: 1 INSERT + 4×3 stage queries (no contracts UPDATE) + 1 final UPDATE + 1 SELECT = 16 total
- Provisioning pipeline mock count with contract_id=5: 1 INSERT + 3×3 + 1×4 (activate_contract has extra UPDATE contracts) + 1 final UPDATE + 1 SELECT = 16 total (same!)
- Logger mock bleed: if a test uses logger.info.mockImplementationOnce() but not all queued impls are consumed, they leak into subsequent tests. Fix: add logger.info.mockReset() in top-level beforeEach (not just db.query.mockReset())
- scriptingService MUST be tested in a separate file from routes that mock it (section18Services.test.js vs section18Extended.test.js)
- applyBatchOperation calls logger.info ONCE — to test catch block (lines 168-170), set logger.info.mockImplementationOnce(() => { throw new Error(...) }) with just ONE implementation (not 3)
- Pipeline stage failure (lines 271-274): use db.query.mockRejectedValueOnce() at the position of the UPDATE contracts call
- routerosService 3/4/5-byte prefix: test with hand-crafted Buffer bytes; 4/5-byte tested via readWord only (encodeWord 4-byte needs 2MB word — skip)
- parseSentences is exported but NOT used internally (RouterOSClient has its own inline parsing in _onData); test directly via exported function
- RouterOSClient line 281 ("login unexpected response") is dead code: _sendSentence only resolves on !done/!trap/!fatal so response[0][0] is always one of those

**Coverage achieved (commit 13b264b on branch 18-of-isp-platform-feature.md):**
- Global: 70.42% → 72.01% (17007/23616 lines)
- automationService: 94.5%, routerosService: 91.5%, analyticsService: 100%, scriptingService: 100%
- 4661 total tests; 2 pre-existing setupSecrets CRLF failures only

**Security:**
- No child_process/exec/spawn/eval in any §18 file
- Script body stored only; execution records created as 'queued'; real sandboxed executor not included

**Why:** Next migration is 344 (§19 or later sections).

**How to apply:** Next section starts from migration 344. Current state: 303 tables, migrations 001–343.
