---
name: section10-qos-bandwidth
description: §10 QoS & Bandwidth complete — migrations 286-294, 13 tables, 44 perms, 6-tab frontend page; next migration: 295
metadata:
  type: project
---

Migrations 286-294 complete on branch `10-of-isp-platform-feature.md` (worktree `fireisp-wt-sec10`). All §10.1-§10.4 items done.

**Tables added (§10.1-§10.2, migrations 286-289, 4 tables):**
- `quality_classes`, `queue_tree_nodes`, `rate_limit_templates`, `protocol_shaping_rules`

**Tables added (§10.3 FUP/Data Caps, migrations 290-291, 4 tables):**
- `data_rollover_balances` — monthly carry-forward ledger, UNIQUE on contract_id+billing_month
- `data_packs` — add-on data packages (name, data_gb, price, validity_days)
- `data_pack_purchases` — subscriber purchase records (RESTRICT FK to data_packs)
- `fup_usage_notifications` — 80/90/100% threshold alert audit log, UNIQUE on contract_id+billing_month+threshold_pct

**Tables added (§10.4 Traffic Engineering, migrations 292-293, 5 tables):**
- `interface_qos_policies` — per-interface HTB/CBQ/HFSC/PCQ with parent_policy_id self-FK
- `mpls_vlan_prioritization_rules` — MPLS/VLAN 802.1p/q priority mapping
- `dscp_marking_policies` — DSCP mark/remark rules (4 defaults seeded: EF/46, AF41/34, CS3/24, BE/0)
- `bandwidth_test_servers` — iperf3/speedtest endpoint registry
- `subscriber_speed_test_jobs` — test job queue

**queue_tree_nodes extended (migration 292):** queue_type ENUM extended to add cbq/hfsc/pcq; vendor_platform ENUM column added. Schema.sql updated in CREATE TABLE directly (no ALTER needed for fresh schema apply).

**Permissions seeded:**
- Migration 287: 9 QoS perms; Migration 289: 8 rate-limiting perms
- Migration 291: 8 FUP perms (module='fup'): data_packs.*/4, data_pack_purchases.view/create, data_rollover.view/manage
- Migration 294: 19 traffic engineering perms (module='qos'): interface_qos_policies.*/4, mpls_vlan_prioritization.*/4, dscp_marking_policies.*/4, bandwidth_test_servers.*/4, subscriber_speed_tests.view/create/update/3

**New services (§10.3):** `rolloverService.js` (accrueRollover, getRolloverBalance, consumeRollover), `dataPackService.js` (full CRUD + purchasePack + getEffectiveAllowance), `fupNotificationService.js` (checkAndNotifyThresholds, listNotifications)

**New routes:** `/data-packs`, `/contracts/:id/data-packs`, `/rollover/*`, `/fup/*` (dataManagement.js); `/interface-qos-policies`, `/dscp-marking-policies`, `/mpls-vlan-prioritization` (trafficEngineering.js); `/bandwidth-test-servers`, `/subscriber-speed-test-jobs` (bandwidthTests.js)

**Portal routes added (portal.js):** GET /data-packs, POST /data-packs/:packId/purchase, GET /data-packs/my-purchases, GET /usage/allowance — uses `req.client.organizationId` (camelCase)

**qosService.js extended:** `exportDscpConfig(organizationId, format)` generating MikroTik mangle rules

**Frontend:** `QosBandwidthPage.tsx` extended to 6 tabs — Tab 5 'FUP & Data Caps' (data packs CRUD + FUP notifications table), Tab 6 'Traffic Engineering' (interface QoS, DSCP + export, MPLS/VLAN, bandwidth test servers). modalStyles uses `backdrop` and `panel` (NOT `overlay`/`modal`). 1996 i18n keys en/es/pt-BR at 100%. 81 frontend test files green.

**Schema validation schemas pattern:** All validation schemas use plain object format `{ fieldName: { type, required, min, max, enum } }` — NOT Joi. Joi is NOT installed in this project.

**Integration test pattern:** When requiring app.js, mock rbac must include BOTH `requirePermission` and `requireRole` (firerelay.js uses requireRole at route registration time, not request time).

**Pre-existing test failures (do not investigate):** `setupSecrets.test.js` (CRLF), `firerelay.test.js` (1 test: 401 vs 404), `app.test.js` (2 tests: auth vs 404 ordering).

**Database table count:** 237 tables total (schema.sql updated). Migration range: 001-294.

**Next migration number: 295**

**Why:** §10 of isp-platform-features.md. FUP (Fair Use Policy) allows ISPs to set monthly data caps with rollover, add-on data packs, and threshold notifications. Traffic Engineering enables fine-grained per-interface QoS policies beyond basic rate limiting.

**How to apply:** Next section starts at migration 295. The schema.sql ALTER TABLE issue for queue_tree_nodes was resolved by updating the CREATE TABLE definition directly (added vendor_platform column and extended queue_type ENUM).
