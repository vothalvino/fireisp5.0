---
name: section16-regulatory-compliance
description: Section 16 Regulatory Compliance (Mexico) COMPLETE — migrations 314-322, backend, frontend, docs; 35 tests, 751 OpenAPI paths, 277 tables; next section: 17
metadata:
  type: project
---

Migrations 314-322 complete (database layer done by prior session). Backend layer completed. Frontend and final docs completed.

**Why:** Mexican ISP compliance: LFPDPPP (data subject rights), LFTR §190 (lawful interception), IFT numbering rules, USO obligations, PROFECO §16.7, data residency §16.8.

**New route files (5):**
- `src/routes/regulatoryCompliance.js` — mounted at `/regulatory-compliance`; covers subscriber_consents, dsar_requests, identity_verification_records, gov_data_requests
- `src/routes/numberingManagement.js` — mounted at `/numbering-management`; phone_number_inventory, number_portability_records, numbering_blocks
- `src/routes/universalService.js` — mounted at `/universal-service`; uso_obligations, rural_coverage_reports (note: /summary before /:id)
- `src/routes/consumerProtection.js` — mounted at `/consumer-protection`; service_modification_notices + ContractTemplateMx crudController
- `src/routes/dataResidency.js` — mounted at `/data-residency`; single-row config per org, ON DUPLICATE KEY UPDATE upsert, /check sets compliance_status

**Extended files:**
- `src/routes/auditLogs.js` — added GET /export (audit_export.view) + GET /report-access-logs (report_access_logs.view)
- `src/routes/dsar.js` — added GET /requests (convenience list from dsar_requests table)
- `src/services/taskRunner.js` — added `data_retention_compliance_check` case; `handleDataRetentionComplianceCheck` exported

**Orchestrator sweep fix:** migration 322 originally seeded the task with only `(task_name, is_enabled)` — no `cron_expression`, so it had NO schedule and would never auto-run, leaving §16.9 "retention period compliance automation" inert. Fixed to `task_type='other', cron '0 3 * * *'` (commit daa8175). LESSON: a seeded scheduled task needs a `cron_expression` (or it's a one-shot that never fires) IN ADDITION to a taskRunner case — check both, not just the case.

**Key implementation notes:**
- CURP validation: 18-char regex + weighted checksum; returns 422 `{ error: 'CURP_INVALID' }` on failure
- gov_data_requests row_hash: SHA-256 of (authority_name + authority_ref + request_type + createdAt ISO string)
- audit export logs to report_access_logs after query
- data_residency compliance_status: 'compliant' if primary_storage_country === 'MX', else 'non_compliant'

**OpenAPI:** 751 total paths (was 712 before §15, effectively grew through §15 + §16). 5 new tags. spec:check clean.

**Tests:** 35 tests in tests/section16.test.js, all passing. +2 tests in taskRunner.test.js.

**Tables used:** subscriber_consents, dsar_requests, identity_verification_records, gov_data_requests, phone_number_inventory, number_portability_records, numbering_blocks, uso_obligations, rural_coverage_reports, service_modification_notices, contract_templates_mx, data_residency_config, report_access_logs.

**Final docs completed:**
- `docs/compliance-mexico.md` — §16.1 legal framework reference (LFTR, IFT→ATDT/CRT, LFPDPPP, Codigo Penal Federal, CFDI 4.0)
- `isp-platform-features.md` §16 — all 47 checkboxes ticked
- `README.md` — 265→277 tables, 712→763 endpoints, migration 314-322 note, 12 new table rows

**Final verification (all green):**
- schema parity: 0 failures
- backend tests: 4194 passed, 2 failed (setupSecrets pre-existing Windows CRLF)
- lint: clean
- spec:check: 751 paths, 0 drift
- frontend: 414 tests passed, tsc clean, i18n 100%, build success
- migrations: 322 files
- no rollbacks in migrations/: confirmed
- FK uniqueness: only 3 pre-existing tax_rate dups
- README count == schema CREATE TABLE: both 277
- lockfile: up to date (husky prepare failure is pre-existing Windows POSIX issue, not a lockfile problem)
- mojibake: none

**Next migration:** 323 (§17 Security & Access Control or next section).

**How to apply:** §16 is fully complete. The contract_templates_mx model already existed before this section. When starting §17, begin with migration 323.
