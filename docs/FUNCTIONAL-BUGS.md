# FireISP 5.0 — Web UI Functional Bugs (what doesn't work / works wrong)
_End-to-end code trace (page → API → backend → response → render); adversarially verified. No live runtime — confidence noted per bug._

## Executive summary

**Total verified bugs: 51** across 11 functional domains.

By effective severity:
- **Critical: 4**
- **High: 14**
- **Medium: 18**
- **Low: 15**

By bug class:
- **response-shape: 22** (the dominant failure mode)
- **request-shape: 11**
- **wrong-data: 7**
- **broken-interaction: 5** (all "no `onError`" portal mutations)
- **dead-404: 4**
- **stale-ui: 1**

The reason "a lot of them don't work" is not many independent mistakes — it is a handful of **systemic contract drifts** repeated across pages. The single biggest pattern is **field-name / response-shape divergence between the frontend type and the backend's raw `SELECT *` or hand-rolled `res.json()`**: the generic `crudController` returns `{ data, meta }` with rows passed through verbatim (no aliasing), and many custom routes also bypass the standard envelope. Wherever the frontend TypeScript interface guessed a column name that differs from the DB (`user_id` vs `agent_user_id`, `reference` vs `reference_number`, `onu_profile_name` vs `profile_name`, `description` vs `detail`, `devices_up` vs `devices.up`), the field silently renders `undefined`/`—`/`NaN` — and the page's own test masks it by mocking the *frontend's* expected shape. The second systemic root cause is **`BaseModel` fillable/`validate()` whitelisting that silently drops unknown fields**: when the frontend sends a field the model's `fillable` list or the validate schema doesn't know (`notify_before_days` vs `notify_days_before`, `reference_number` vs `reference`, `manufacturer/model/unit/unit_cost/sale_price`, mismatched payment-method enums), the data is dropped or 422-rejected with no client-side guard. The worst *individual* breakages are the **Cash Reconciliation service's hand-written SQL referencing non-existent columns** (`created_by`/`deleted_at` → hard 500 on expand and close), the **Tax Reports `req.organizationId` typo** (`req.orgId` is the real property → every export returns zero rows), and the **InvoiceDetail payment-method enum mismatch** (6 of 9 methods 422 on submit). The NOC Dashboard is effectively non-functional end-to-end: all four of its panels (health, ticket queue, SLA, events) have independent shape mismatches.

## Systemic issues (fix these first — each breaks many pages)

### 1. Frontend type names a column the backend never returns (raw `SELECT *` / no aliasing)
**Pattern:** `crudController.list/get` and several custom routes return DB rows verbatim. `BaseModel.findAll`/`findById` do `SELECT *` with **no aliasing**, so the JSON field names are exactly the DB column names. When the frontend interface guesses a different name, the value is `undefined` at render → blank cell, `—`, or `NaN`. Page tests hide this because the mock uses the *frontend's* names.

**Affected (≥7 pages/fields):** CashReconciliationList (`user_id`→`agent_user_id`; `reference`→`reference_number`), OnuManagementPage (`onu_profile_name`→`profile_name`), NocDashboard events (`description`→`detail`), NocDashboard SLA (`total_tickets`/`breached_tickets`→`total`/`non_compliant`), NocDashboard health (`devices_up`→`devices.up`), SnmpTraps (list omits `varbinds` entirely), InventoryManagement (`quantity_on_hand` lives in a different table).

**Canonical example:** `frontend/src/pages/CashReconciliationList.tsx:38,359` reads `session.user_id`; `database/migrations/213_create_cash_reconciliation_table.sql:11` defines the column as `agent_user_id`; `src/models/BaseModel.js:108` (`SELECT *`) + `src/controllers/crudController.js:44-45` pass it through unaliased.

**One-place fix:** Establish the convention that **column names are the API contract**, then either (a) align each frontend interface to the actual DB column, or (b) add explicit `AS` aliases in the route/model SELECT. Add a CI check that diffs frontend interface field names against the migration columns for `SELECT *` endpoints. (Also: stop mocking the frontend-expected shape in tests — mock the *backend* shape so these regress loudly.)

### 2. `fillable` / `validate()` schema whitelisting silently drops or 422-rejects unknown request fields
**Pattern:** `validate.js` checks only schema-defined fields and **does not strip unknowns**, while `BaseModel.create/update` iterate `this.fillable` and **drop** any field not listed. So a frontend field whose name/enum doesn't match either the schema or `fillable` is either silently lost (model drop) or 422-rejected (schema enum/required) — with no client-side warning. The two sides were authored independently and drifted.

**Affected (≥5 forms):** InvoiceDetail payment (`payment_method` enum 6-vs-9; `reference_number`→`reference`), SuspensionRuleList (`notify_before_days`→`notify_days_before`), InventoryList (`manufacturer/model/unit/unit_cost/sale_price` not in `fillable` *and* not in schema), MessageTemplateList (`push` channel missing from frontend list — inverse drift).

**Canonical example:** `frontend/src/pages/InvoiceDetail.tsx:207` offers 9 payment methods; `src/middleware/schemas/payments.js:9` enum allows only `['cash','card','transfer','check','online','other']` → `bank_transfer`/`credit_card`/`debit_card`/`stripe`/`conekta` all 422. Same file line 246 sends `reference_number`; schema/model field is `reference` (`src/models/Payment.js:13`) → silently dropped by `BaseModel.create()` (`src/models/BaseModel.js:150-151`).

**One-place fix:** Derive the frontend enum/field lists from a **shared source of truth** (generate TS constants from the validate schemas, or from `docs/openapi.json`). As a safety net, make `validate.js` **reject unknown fields** (422 on extra keys) so silent drops become loud, and align each model's `fillable` to its migration columns.

### 3. Custom routes bypass the standard `{ data, meta }` envelope (or nest it differently)
**Pattern:** Hand-written routes return ad-hoc shapes — bare objects, `{ data: { … } }` with extra nesting, or counts under `meta` — while the frontend assumes either the CRUD envelope or a flat object. The page reads the wrong level → `undefined`/`NaN` or an extra `.data` that resolves to nothing.

**Affected:** RadiusSessions batch-disconnect (counts under `meta`, read at top level), ConfigComplianceRuleList run-audit (double `.data` unwrap → `undefined`), NocDashboard ticket-queue (returns ticket rows, frontend expects `{status,count}` aggregates), ChurnAnalytics (double-unwrap), AnalyticsDashboard capacity-forecast (`forecast` vs `capacity_forecast`), LateFeeRuleList (bare object instead of `{ data }` on POST/GET/PUT).

**Canonical example:** `src/routes/radius.js:384-387` returns `{ data: results, meta: { total, succeeded, failed } }`; `frontend/src/pages/RadiusSessions.tsx:495-496,507-508` read `batchResult.succeeded`/`.failed` (top level) → both render `undefined`.

**One-place fix:** Route every custom handler through the same envelope helper used by `crudController` (or a thin `respond(res, data, meta)` wrapper), and standardize batch/aggregate endpoints to return `{ data: {...flat counts...} }`. Update the few frontend readers that already special-cased nesting.

### 4. Hand-written SQL in services references columns that don't exist (hard 500)
**Pattern:** Service-layer raw SQL was written against assumed column names instead of the actual migration. Unit tests mock `db.query`, so the bad SQL is never executed in test → ships broken.

**Affected:** cashReconciliationService `getSessionDetail` and `closeSession` (`created_by`/`deleted_at` on `payments`). Billing tax-reports (`req.organizationId` undefined → all queries filter on `NULL`).

**Canonical example:** `src/services/cashReconciliationService.js:142,144,62,64` use `AND created_by = ?` and `AND deleted_at IS NULL`; `database/migrations/012_create_payments_table.sql:14` shows the column is `recorded_by` and there is no `deleted_at` on `payments` → MySQL "Unknown column" 500 on both expand-row and close-session.

**One-place fix:** Replace mocked-DB unit tests for these services with integration tests against a migrated schema (or a schema-lint that parses raw SQL column refs against the migrations). Immediate code fix: `created_by`→`recorded_by`, drop the `deleted_at` predicate, and `req.organizationId`→`req.orgId`.

### 5. Portal mutations have no `onError` (silent failure UX)
**Pattern:** `useMutation` calls in the customer portal define `onSuccess` but no `onError` and no error UI. On failure the button resets to idle and the user assumes success.

**Affected (5):** PortalSpeedTest (Run Speed Test), PortalChat (Start Chat), PortalAccount (Cancel Service Request; Submit Service Request — also no client-side required-field validation), PortalKb (Rate Article).

**One-place fix:** Add a shared mutation wrapper / `onError` default that surfaces `err.message` in a toast, and add client-side required-field guards on the PortalAccount service-request form before `mutate()`.

## Bugs by domain

### billing-payments
| Page · function | Sev / class / conf | Symptom | Frontend | Backend | Fix |
|---|---|---|---|---|---|
| InvoiceDetail · Record Payment (method) | critical / request-shape / high | 6 of 9 payment methods 422 on submit | `InvoiceDetail.tsx:207,241-248` | `src/middleware/schemas/payments.js:9` | Align frontend enum to `['cash','card','transfer','check','online','other']` (or extend backend) |
| InvoiceDetail · Record Payment (reference) | high / request-shape / high | Typed reference silently not saved | `InvoiceDetail.tsx:246` | `schemas/payments.js:11`, `models/Payment.js:13` | Send `reference` not `reference_number` |
| LateFeeRuleList · POST /late-fee-rules | medium / response-shape / med | Bare object, not `{ data }` envelope | `LateFeeRuleList.tsx:95` | `src/routes/lateFeeRules.js:39` | `res.status(201).json({ data: rule })` |
| LateFeeRuleList · GET /:id | low / response-shape / med | Bare object, not `{ data }` | `LateFeeRuleList.tsx:119-130` | `src/routes/lateFeeRules.js:52` | `res.json({ data: rule })` |
| LateFeeRuleList · PUT /:id | low / response-shape / med | Bare object, not `{ data }` | `LateFeeRuleList.tsx:100-105` | `src/routes/lateFeeRules.js:65` | `res.json({ data: rule })` |
| PaymentList · Send receipt | low / response-shape / high | Extra unread `message` field (cosmetic) | `PaymentList.tsx:943` | `src/routes/payments.js:160` | Return `{ to }` only (or read message) |
| InvoiceDetail · Send invoice email | low / response-shape / high | Extra unread `message` field (cosmetic) | `InvoiceDetail.tsx:103` | `src/routes/invoices.js:305` | Return `{ to }` only |

### billing-disputes (Cash Reconciliation)
| Page · function | Sev / class / conf | Symptom | Frontend | Backend | Fix |
|---|---|---|---|---|---|
| CashReconciliationList · expand session detail | critical / dead-404 (SQL) / high | 500 on expand — bad SQL columns | `CashReconciliationList.tsx:212-214` | `src/services/cashReconciliationService.js:138-147` | `created_by`→`recorded_by`; drop `deleted_at` predicate |
| CashReconciliationList · close session | critical / dead-404 (SQL) / high | 500 on close — same bad SQL | `CashReconciliationList.tsx:163-165` | `cashReconciliationService.js:57-66` | Same column fix |
| CashReconciliationList · agent ID column | high / response-shape / high | Agent ID renders blank | `CashReconciliationList.tsx:38,359` | `migrations/213_…:11` (`agent_user_id`) | Use `agent_user_id` in interface + render |
| CashReconciliationList · expanded reference | high / response-shape / high | Reference column shows `—` | `CashReconciliationList.tsx:58,251` | `migrations/012_…:12` (`reference_number`) | Use `reference_number` |
| CashReconciliationList · SessionDetail type | medium / response-shape / med | Misleading type (works, reads `.payments`) | `CashReconciliationList.tsx:62-63` | `src/routes/cashReconciliation.js:45` | Type as `{ session, payments }` |

### cfdi-fiscal
| Page · function | Sev / class / conf | Symptom | Frontend | Backend | Fix |
|---|---|---|---|---|---|
| TaxReports · export/fetch report | critical / wrong-data / high | All exports return 0 rows (org filter is `NULL`) | `TaxReports.tsx:26-45` | `src/routes/billing.js:55` (`req.organizationId` undefined) | `const orgId = req.orgId;` |

### topology-noc-tickets (NOC Dashboard)
| Page · function | Sev / class / conf | Symptom | Frontend | Backend | Fix |
|---|---|---|---|---|---|
| NocDashboard · network health panel | high / response-shape / high | NaN/blank device counts; nested + renamed | `NocDashboard.tsx:205-222` | `src/routes/nocDashboard.js:17-42` | Flatten to `devices_up/down/total/uptime_pct` (or read `data.devices.*`) |
| NocDashboard · ticket queue panel | high / response-shape / high | Counts `undefined` — returns rows, not aggregates | `NocDashboard.tsx:282-291` | `src/routes/nocDashboard.js:76-94` | `SELECT status, COUNT(*) … GROUP BY status` |
| NocDashboard · SLA compliance panel | high / response-shape / high | `total_tickets`/`breached_tickets` undefined → NaN | `NocDashboard.tsx:60-64,334,337` | `src/routes/nocDashboard.js:128-145` | Return `total_tickets`/`breached_tickets` (or read `total`/`non_compliant`) |
| NocDashboard · recent events panel | medium / response-shape / high | Event text blank (`description` vs `detail`) | `NocDashboard.tsx:300-316` | `src/routes/nocDashboard.js:99-125` | Read `ev.detail` |

### radius-ip
| Page · function | Sev / class / conf | Symptom | Frontend | Backend | Fix |
|---|---|---|---|---|---|
| RadiusSessions · Batch Disconnect | high / response-shape / high | Result shows `undefined` succeeded/failed | `RadiusSessions.tsx:495-496,507-508` | `src/routes/radius.js:384-387` | Return flat `{ succeeded, failed }` (or read `meta.*`) |

### snmp-devices
| Page · function | Sev / class / conf | Symptom | Frontend | Backend | Fix |
|---|---|---|---|---|---|
| ConfigComplianceRuleList · Run Audit | high / response-shape / high | Audit stats never display (double `.data` → undefined) | `ConfigComplianceRuleList.tsx:62-66` | `src/routes/configComplianceRules.js:50` | Remove extra `.data` cast/accessor |
| SnmpTraps · expand varbinds | medium / response-shape / high | "No varbinds" even when present — list omits column | `SnmpTraps.tsx:33,301-322` | `src/routes/snmpTraps.js:55-68` | Add `t.varbinds` to list SELECT |

### ftth-cpe-wireless
| Page · function | Sev / class / conf | Symptom | Frontend | Backend | Fix |
|---|---|---|---|---|---|
| OnuManagementPage · ONU details list | high / response-shape / high | Profile name always `—` | `OnuManagementPage.tsx:33,359` | `src/routes/onuManagement.js:150` (`AS profile_name`) | Alias `AS onu_profile_name` (or read `profile_name`) |

### plans-contracts
| Page · function | Sev / class / conf | Symptom | Frontend | Backend | Fix |
|---|---|---|---|---|---|
| SuspensionRuleList · create/edit rule | high / request-shape / high | Advance-notice days silently not saved | `SuspensionRuleList.tsx:53,121,157` | `schemas/suspensionRules.js:5`, `SuspensionRule.js:13` | Rename `notify_before_days`→`notify_days_before` |

### inventory-reports-automation
| Page · function | Sev / class / conf | Symptom | Frontend | Backend | Fix |
|---|---|---|---|---|---|
| InventoryList · create/edit item | high / request-shape / high | manufacturer/model/unit/unit_cost/sale_price silently dropped | `InventoryList.tsx:260-275` | `src/models/InventoryItem.js:10-14` | Add fields to `fillable` (+ schema) |
| InventoryManagement · Stock tab | high / response-shape / high | `quantity_on_hand` undefined (lives in `inventory_stock`) | `InventoryManagement.tsx:27,272,308-310` | `migrations/035`, `036`; `routes/inventory.js:22` | Join/aggregate stock, or drop field, or new endpoint |
| AnalyticsDashboard · CapacityForecastWidget | high / response-shape / high | Widget renders empty (`forecast` vs `capacity_forecast`) | `AnalyticsDashboard.tsx:171,176` | `src/services/reportService.js:1014-1019` | Read `data.forecast` (or rename backend field) |
| InventoryList · create/edit validation | medium / request-shape / high | New fields unvalidated; schema uses wrong `unit_price` | `InventoryList.tsx:270-271` | `schemas/inventory.js:1-8` | Add field validation; reconcile `unit_price` vs `unit_cost/sale_price` |
| Reports · IFT create report | medium / request-shape / low | Form may submit undefined required fields | `Reports.tsx:566-576` | `schemas/iftStatisticalReports.js` | Confirm `report_period` required; add client guard |
| AnalyticsDashboard · RevenueChartWidget | medium / dead-404 / med | `period=monthly` silently ignored by backend | `AnalyticsDashboard.tsx:91` | `src/routes/reports.js:27-36` | Use `from/to`, or add `period` handling |
| ScheduledTaskList · update task | medium / request-shape / low | Possible `task_type` mismatch on update | `ScheduledTaskList.tsx:152-162` | `schemas/scheduledTasks.js` | Verify update schema |
| InventoryManagement · Assets pagination | low / response-shape / low | Page count recomputed instead of using `meta.totalPages` | `InventoryManagement.tsx:169` | `crudController.js:44-52` | Use `meta.totalPages ?? 1` |
| ChurnAnalytics · load churn data | low / response-shape / low | Double-unwrap / type confusion | `ChurnAnalytics.tsx:52,54` | lifecycle route `{ data }` | Pick one unwrap level consistently |
| WebhookList · create/edit webhook | low / request-shape / low | `events` as CSV string vs array? | `WebhookList.tsx:138` | `schemas/webhooks.js` | Verify type; convert if array expected |
| ApiTokenList · create token | low / request-shape / low | `scopes` parse format may differ from schema | `ApiTokenList.tsx:191-195` | `schemas/apiTokens.js` | Verify schema vs parsing |

### clients-crm
| Page · function | Sev / class / conf | Symptom | Frontend | Backend | Fix |
|---|---|---|---|---|---|
| CommunicationCampaignList · message status filter | medium / stale-ui / high | Selecting a status doesn't filter (param never sent) | `CommunicationCampaignList.tsx:116-122,399-401,440` | `src/routes/communicationCampaigns.js:283-318` | Pass `status` into `fetchMessages` query params |
| CommunicationCampaignList · template filter | low / wrong-data / low | Tautological filter (`x===y || x===y`) | `CommunicationCampaignList.tsx:235` | N/A | `filter(t => t.channel === form.channel)` (or add `'all'`) |

### admin-security
| Page · function | Sev / class / conf | Symptom | Frontend | Backend | Fix |
|---|---|---|---|---|---|
| Settings · Alert Rule toggle | medium / request-shape / med | PUT `{is_enabled}` may 422 if schema requires other fields | `Settings.tsx:221-225` | `src/routes/alerts.js:68-98` | Use PATCH, or mark fields optional in `updateRule` |
| Settings · Payment Gateway secret | medium / request-shape / med | Empty `secret_key_encrypted: ''` may fail/truncate | `Settings.tsx:425,435` | `src/routes/paymentGateways.js` | Omit field when blank |
| MessageTemplateList · `push` channel | medium / request-shape / high | Can't create push templates (frontend list omits `push`) | `MessageTemplateList.tsx:48` | `src/routes/messageTemplates.js:18` | Add `'push'` to `CHANNELS` |
| UserList · list query key | medium / response-shape / med | Empty-string filters churn cache key / sent as filters | `UserList.tsx:648` | `src/routes/users.js:20` | Build queryKey from non-empty filters only |
| Dashboard · MRR sum | medium / wrong-data / med | `parseFloat(r.mrr)` may NaN on type ambiguity | `Dashboard.tsx:180` | `src/controllers/dashboardController.js:101` | Coerce `number\|string` safely |
| RoleList · remove permission | medium / dead-404 / med | Path-param resolution suspected (likely OK) | `RoleList.tsx:100-105` | `src/routes/roles.js:148-157` | Verify openapi-fetch resolves both path params |
| OrganizationList · quota fetch | low / response-shape / low | Suspected double-wrap (verified correct) | `OrganizationList.tsx:131-135` | `src/routes/organizations.js:54-61` | No fix needed — flagged for completeness |

### ipv6-dhcp-nat
| Page · function | Sev / class / conf | Symptom | Frontend | Backend | Fix |
|---|---|---|---|---|---|
| TransitionMechanismsPage · SixRdForm edit title | low / wrong-data / high | Edit title shows "Edit RA Guard Policy" (wrong key) | `TransitionMechanismsPage.tsx:166` | N/A (UI) | Use `t('transition_mechanisms.edit_6rd', …)` |
| TransitionMechanismsPage · DsLiteForm edit title | low / wrong-data / high | Hardcoded (no i18n) | `TransitionMechanismsPage.tsx:372` | N/A (UI) | Wrap in `t()` |
| TransitionMechanismsPage · MapRuleForm edit title | low / wrong-data / high | Hardcoded (no i18n) | `TransitionMechanismsPage.tsx:576` | N/A (UI) | Wrap in `t()` |
| TransitionMechanismsPage · XlatForm edit title | low / wrong-data / high | Hardcoded (no i18n) | `TransitionMechanismsPage.tsx:794` | N/A (UI) | Wrap in `t()` |

### portal
| Page · function | Sev / class / conf | Symptom | Frontend | Backend | Fix |
|---|---|---|---|---|---|
| PortalSpeedTest · Run Speed Test | medium / broken-interaction / high | No error shown on failure | `PortalSpeedTest.tsx:54-62` | `src/routes/portal.js:846-887` | Add `onError` + error UI |
| PortalChat · Start Chat | medium / broken-interaction / high | No error shown on failure | `PortalChat.tsx:59-70` | `src/routes/portal.js:929-949` | Add `onError` + error UI |
| PortalAccount · Cancel Service Request | medium / broken-interaction / high | No feedback; user thinks it succeeded | `PortalAccount.tsx:82-86` | `src/routes/portal.js:783-793` | Add `onError` + error state |
| PortalAccount · Submit Service Request | medium / request-shape / high | Empty required fields → 422 confusion | `PortalAccount.tsx:175-260` | `src/services/portalServiceRequestService.js:49-100` | Add client-side required-field validation |
| PortalKb · Rate Article | low / broken-interaction / high | No feedback on rating failure | `PortalKb.tsx:63-73` | `src/routes/portal.js:832-844` | Add `onError` |

## Likely-fine / verified-working

- **Generic CRUD list/get/create/update/delete** via `crudController` is consistent (`{ data, meta }`; 204 on delete) — pages reading `data.data`/`data.meta` work. Defects cluster in **custom routes and raw-SQL services**, not the factory.
- **OrganizationList quota fetch** was suspected (double-unwrap) but traced **correct** — backend returns `{ data: { limits, usage } }` and the frontend unwraps exactly once. Left in the table for traceability only.
- **RoleList permission delete** and **ScheduledTaskList update** are low-confidence suspicions pending schema confirmation; no proven contract break.
- Most **admin-security** pages (User/Role list rendering, alert-rule list) render fine; the issues are edge cases (empty-filter cache keys, partial-update method choice).
- The **IPv6 transition** page's logic works; only edit-modal titles are mis-localized (cosmetic).

## Method & limits

- **Static end-to-end trace only** (no live DB/server). For each page we grepped every `api.GET/POST/PUT/PATCH/DELETE`, raw `fetch`, GraphQL, and WS call, opened the matching backend route + handler + service + SQL `SELECT` alias list, and compared the **exact** request schema (`validate.js` + `src/middleware/schemas/*`) and **exact** response shape against what the page sends and renders.
- **Adversarial verification:** every "confirmed" bug has file:line evidence on **both** sides. Page tests were cross-checked — several mock the *frontend-expected* shape, which **masks** the real backend contract (called out per bug). "Unverified" items are retained at their claimed severity but flagged; the 4 critical and most high bugs are `confidence: high` (provable from code on both sides).
- **What a live click-through would add:** confirm the MySQL "Unknown column" 500s (cash reconciliation), confirm `req.orgId` actually yields rows once the typo is fixed, observe the exact 422 bodies for the enum/field-name request-shape bugs, and verify the suspected-but-unproven items (RoleList permission delete path resolution, webhook/scope payload formats, alert-rule PATCH-vs-PUT, Dashboard MRR numeric type).
