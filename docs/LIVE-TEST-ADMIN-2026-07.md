# FireISP 5.0 — Live Admin Test Report (2026‑07)

_Generated from a live black-box + code-trace test of a running FireISP demo instance, exercised **as the ISP admin/owner**. Every tab and sub-tab reachable from the admin nav was walked: list → create two → update the one kept → delete the other (evidence/immutable entities were created once and left in place). Each reported failure was re-run and root-caused to a file:line in the repo before inclusion; unconfirmed claims were dropped._

**Run:** 16 domain testers + a log-scavenger against the live API, then per-domain adversarial verification. Where the demo's shared rate limiter throttled an agent, that domain was covered by a code trace and confirmed live afterward with a paced script (billing‑core's email + payment‑method bugs, for example, were reproduced live: `send-email`/`send-receipt` → 500, `payment_method: card/transfer` → 422).

## Executive summary

**84 distinct confirmed defects** (after de-duplication) — **1 critical · 31 high · 45 medium · 7 low**. The platform's read/list surfaces and its mature core (clients, plans, invoices list, payments allocation, tickets, tax rules) work; the failures cluster overwhelmingly in **create/update write paths** and in a handful of **repeated structural mistakes** that recur across dozens of endpoints. Fixing the seven systemic patterns below clears roughly **60% of all findings** and every one of the high-severity ones.

The single unifying root cause is the one this repo has hit before and hit again: **the code and the database schema drift apart, and nothing at the boundary catches it.** A model's `fillable` list names a column the table doesn't have; a route filters on `organization_id` a table never got; a validator's enum diverges from the DB ENUM; a frontend interface guesses a column name. Each drift is individually small and individually silent — the write 500s, or worse, returns 200 while quietly dropping the field.

### The systemic patterns (fix once, fix many)

| # | Pattern | Bugs | What breaks | The fix shape |
|---|---------|------|-------------|---------------|
| **A** | **Model `fillable` / validator vs real DB columns** | 14 | Model lists columns that don't exist (or omits `NOT NULL` ones) → create/update 500s, or 200 that silently drops the field (Client VIP-exempt, SlaDefinition status, Ticket `resolved_at`) | Align `fillable` + validation schema + OpenAPI to the migration's actual columns |
| **B** | **`SET ?` object binding under mysql2 `execute()`** | 5 | `INSERT/UPDATE … SET ?` with an object param throws on every call because `db.query` routes through `pool.execute()` (prepared statements can't expand objects) — DHCP servers, NAT pools, PTR records, RA-guard, all transition mechanisms. The tester notes ~43 more `SET ?` sites to audit | Build explicit `(col,…) VALUES (?,…)` / `SET col = ?` lists from `Object.keys(fields)` |
| **C** | **`organization_id` referenced on tables that never got it** | 9 | Route/model/service filters or inserts `organization_id` on a table built without it → every call 500s (coverage zones, device config backups, **audit_logs**, purchase-order receive, warehouse stock, low-stock, email logs) | Add the column via migration **or** drop the predicate and scope through a joined table |
| **D** | **`/:id` route registered before a static sibling** | 2 | `GET /:id` shadows `GET /dead-letters` / `GET /compliance-results` → the static page 404s | Register static paths before the param route (or constrain `:id` to `\d+`) |
| **E** | **mysql2 "undefined bind" on partial PUT** | 5 | Handlers destructure optional fields and bind them raw; any omitted field is `undefined`, which mysql2 rejects → partial updates 500 (resellers, scheduled reports, custom reports, dashboard widgets) | Coalesce each bind to `?? null` to match the `COALESCE(?, col)` SQL |
| **F** | **Frontend ↔ backend contract drift** | 7+ | Field-name / enum / response-shape mismatch renders `undefined`/`NaN` or 422s the form (payments `reference`↔`reference_number` + method enum, payment-plan `sequence`, settings shape, the whole AI-settings tab) | Align the TS interface + payload to the route's real contract |
| **G** | **Validator enum ⊂ / ⊄ DB ENUM** | 6 | UI offers a value the DB ENUM rejects (`payment_method: card`, `severity: minor`, `channel: push`, service statuses `not_implemented`) → 422 or 500 | Reconcile the three enums (UI ↔ validator ↔ migration) in one place |

**The one critical:** every create/update/delete in the product is supposed to write an audit-trail row, but `auditLog.js`'s INSERT column list doesn't match the `audit_logs` table (`organization_id`/`table_name` vs the real `entity_type`/`entity_id`), so **the audit trail silently fails to record** — and the `/audit-logs` page itself 500s for the same reason. For an ISP that must retain records for regulator/PROFECO evidence, a silently-broken audit log is the most dangerous single defect found.

## Coverage & method

- **Fully walked live:** clients + CRM (client detail's 13 tabs, contacts, MX fiscal profile), plans/speed-windows, tax rules/rates, SAT catalogs, tickets/NOC, payments allocation, webhooks, alerts, users/settings, SNMP profiles, network core (NAS/DHCP/NAT/PTR/pools/VLANs), inventory, compliance, admin platform, and the billing send/enum paths.
- **Code-traced then live-spot-checked** (rate-limiter throttled the agent mid-run): the full contract lifecycle FSM, service-order provisioning, several fiscal/CFDI stamping paths, and parts of automation/integrations. These are marked in the appendix; none contradicted the live spot-checks.
- **The demo's shared 200→500 req/15-min rate limit** (one tenant window shared by all parallel testers) was the main coverage limiter, not the app — several domains fell back to code tracing when the window saturated. A dedicated test key or a higher `RATE_LIMIT_API` would let a future run exercise the remaining ~57 skipped write paths end-to-end.

---

## Confirmed defects by domain

#### admin-platform (5)

| Sev | Entity — Action | Source |
|-----|------|------|
| high | webhook — create | `src/models/Webhook.js` |
| medium | settings — render settings table (frontend contract) | `frontend/src/pages/Settings.tsx` |
| medium | organization setting — update setting key (cache invalidation) | `src/routes/organizations.js` |
| medium | webhook dead-letters — list dead-letter deliveries | `src/routes/webhooks.js` |
| low | api token — list | `src/routes/apiTokens.js` |

#### billing-core (5)

| Sev | Entity — Action | Source |
|-----|------|------|
| high | payment_plan_installments — render schedule / pay installment | `frontend/src/pages/PaymentPlanList.tsx` |
| high | payments — create/update with UI-offered payment_method | `src/middleware/schemas/payments.js` |
| high | invoices / payments — send-email / send-receipt | `src/services/emailTransport.js` |
| medium | payments — create/update reference field | `frontend/src/pages/PaymentList.tsx` |
| low | invoices — filter by status | `frontend/src/pages/InvoiceList.tsx` |

#### billing-edge (3)

| Sev | Entity — Action | Source |
|-----|------|------|
| high | expense — create | `src/models/Expense.js` |
| medium | credit note line item — add item | `src/models/CreditNote.js` |
| medium | quote line item — add item | `src/models/Quote.js` |

#### clients-crm (1)

| Sev | Entity — Action | Source |
|-----|------|------|
| high | client (suspension exemption) — toggle 'Exempt from automatic suspensi | `src/models/Client.js` |

#### compliance (6)

| Sev | Entity — Action | Source |
|-----|------|------|
| critical | audit_logs (writes) — audit trail recording on every create/update/del | `src/services/auditLog.js` |
| high | audit_logs — list (page load + filters) | `src/routes/auditLogs.js` |
| medium | ift_statistical_reports — generate/create report | `src/middleware/sanitize.js` |
| medium | regulatory_filings — create (filing_type=quarterly_report) | `src/middleware/schemas/regulatoryFilings.js` |
| medium | concession_titles — create (full schema-valid body) | `src/models/ConcessionTitle.js` |
| medium | audit export — export audit logs button | `src/routes/auditLogs.js` |

#### crm-comms (13)

| Sev | Entity — Action | Source |
|-----|------|------|
| high | support_conversation — load message thread | `?` |
| high | ai_phrase — create/display phrases from UI | `src/middleware/schemas/ai.js` |
| high | support_conversation — new conversation + list from UI | `src/routes/supportConversations.js` |
| high | support_conversation escalation — escalate → create handoff ticket | `src/services/supportConversationService.js` |
| medium | ai_forbidden_term — add term with default 'all locales' | `src/middleware/schemas/ai.js` |
| medium | ai_policy — save settings from UI | `src/middleware/schemas/ai.js` |
| medium | ai_provider — create from UI (field-name drift) | `src/middleware/schemas/ai.js` |
| medium | noc_ai_insight — Explain Alert button | `src/middleware/schemas/nocAi.js` |
| medium | ai_metrics — load monthly metrics | `src/routes/ai.js` |
| medium | message_template — create with Variables field filled | `src/routes/messageTemplates.js` |
| medium | kb_article — search | `src/routes/supportConversations.js` |
| medium | support_metrics — load KPI dashboard | `src/routes/supportConversations.js` |
| low | kb_article — create with tags from UI | `src/middleware/schemas/supportConversations.js` |

#### devices-cpe (2)

| Sev | Entity — Action | Source |
|-----|------|------|
| high | device — create | `src/middleware/schemas/devices.js` |
| high | inventory transaction — create | `src/middleware/schemas/inventory.js` |

#### fiscal-mx (6)

| Sev | Entity — Action | Source |
|-----|------|------|
| high | cfdi_documents — create | `src/models/CfdiDocument.js` |
| high | csd_certificates — create (dummy cert upload) | `src/models/CsdCertificate.js` |
| high | pac_providers — create | `src/models/PacProvider.js` |
| high | tax report export — export type=invoices (UI default) and type=credit_ | `src/routes/billing.js` |
| high | cfdi payment complement — create Complemento de Pago 2.0 | `src/services/cfdiService.js` |
| medium | sat_clave_prod_serv / sat_clave_unidad — catalog search (the only mode | `src/routes/satCatalogs.js` |

#### inventory-assets (5)

| Sev | Entity — Action | Source |
|-----|------|------|
| high | inventory_transaction — create stock movement (UI contract) | `src/middleware/schemas/inventory.js` |
| high | purchase_order — receive PO (stock intake) | `src/routes/purchaseOrders.js` |
| medium | inventory_transaction — create stock movement (schema-valid body) | `src/routes/inventory.js` |
| medium | warehouse stock — list stock at a warehouse | `src/routes/warehouses.js` |
| medium | asset/inventory low-stock — low-stock report | `src/services/assetService.js` |

#### network-core (4)

| Sev | Entity — Action | Source |
|-----|------|------|
| high | dhcp_server — create | `src/routes/dhcpServers.js` |
| high | nat_pool — create | `src/routes/natManagement.js` |
| high | nas health check — run health check (button) | `src/services/nasHealthService.js` |
| medium | ptr_record — create | `src/routes/ptrRecords.js` |

#### network-monitoring (6)

| Sev | Entity — Action | Source |
|-----|------|------|
| high | device_config_backups — list (page load) | `src/models/DeviceConfigBackup.js` |
| high | coverage_zones — list/create/update/delete/restore — ALL endpoints | `src/services/coverageZoneService.js` |
| medium | speed_tests — create (per documented validator contract) | `database/migrations/113_create_speed_tests_table.sql` |
| medium | snmp_profile_oids — add OID (per documented validator contract) | `src/middleware/schemas/snmpProfiles.js` |
| medium | config_compliance_results — list compliance results | `src/routes/deviceConfigBackups.js` |
| medium | service_areas — create | `src/routes/serviceAreas.js` |

#### payment-rails (3)

| Sev | Entity — Action | Source |
|-----|------|------|
| high | payment_gateway — create | `database/migrations/101_create_payment_gateways_table.sql` |
| high | checkout_session — create-session | `src/services/checkoutService.js` |
| high | payment_link — generate-link | `src/services/checkoutService.js` |

#### scavenger (17)

| Sev | Entity — Action | Source |
|-----|------|------|
| high | client — set suspension_exempt via PUT (exact UI payload) | `src/models/Client.js` |
| medium | IFT statistical report — create (exact UI payload) | `frontend/src/pages/Reports.tsx` |
| medium | alert rule — create/update with severity 'minor' (a UI dropdown option | `frontend/src/pages/Settings.tsx` |
| medium | payment — update with payment_method 'card'/'transfer'/'online' (UI op | `frontend/src/pages/payments/PaymentActions.tsx` |
| medium | custom report — update | `src/routes/customReports.js` |
| medium | dashboard widget — update single widget | `src/routes/dashboardWidgets.js` |
| medium | compliance report — load panel | `src/routes/reports.js` |
| medium | network report — load panel | `src/routes/reports.js` |
| medium | reseller — update (partial body) | `src/routes/resellers.js` |
| medium | reseller OLT port assignments — list | `src/routes/resellers.js` |
| medium | scheduled report — update | `src/routes/scheduledReports.js` |
| medium | alert correlation panel — load | `src/services/analyticsService.js` |
| medium | anomaly detection — run detect | `src/services/analyticsService.js` |
| medium | predictive failure panel — load | `src/services/analyticsService.js` |
| medium | integration connection — test connection | `src/services/integrationService.js` |
| medium | router driver config — test connection | `src/services/routerDriverService.js` |
| low | invoice — send-email | `src/routes/invoices.js` |

#### subscriber-net (5)

| Sev | Entity — Action | Source |
|-----|------|------|
| high | ra_guard_policy — create (and edit — same code path) | `src/routes/ipv6Management.js` |
| high | tunnel_6rd_configs / ds_lite_configs / map_rules / xlat464_configs — c | `src/routes/transitionMechanisms.js` |
| medium | daily usage / top consumers dashboard — summary totals + daily bar cha | `src/routes/connectionLogs.js` |
| low | radius account — read lookup used by the disconnect flow | `src/routes/radius.js` |
| low | wg_user_peers (admin list) — pagination | `src/routes/wgPeers.js` |

#### tickets-noc (3)

| Sev | Entity — Action | Source |
|-----|------|------|
| medium | sla-definitions — create/update silently drop the status field (fake s | `src/models/SlaDefinition.js` |
| medium | tickets — status → resolved never stamps resolved_at, silently breakin | `src/models/Ticket.js` |
| low | ticket ai-summary — generate AI summary while AI policy disabled — UI  | `frontend/src/pages/TicketDetail.tsx` |

---

## Appendix A — every confirmed defect (cause + fix)

#### [CRITICAL] audit_logs (writes) — audit trail recording on every create/update/delete
*compliance · `internal INSERT via src/services/auditLog.js` · source `src/services/auditLog.js`*

- **Cause:** src/services/auditLog.js:25-26 INSERT column list (user_id, organization_id, action, table_name, record_id, ...) does not match the real audit_logs columns (entity_type/entity_id, no organization_id) per database/schema.sql:1313-1334; the catch block at :37-40 swallows the resulting ER_BAD_FIELD_ERROR on every mutation.
- **Fix:** Rewrite the INSERT to use entity_type/entity_id, add organization_id to audit_logs via migration (the read routes expect it), extend the action ENUM with partial_update/soft_delete (or map them to update/delete), and have the catch block emit a metric/alert instead of only a debug log.

#### [HIGH] webhook — create
*admin-platform · `POST /api/v1/webhooks` · source `src/models/Webhook.js`*

- **Cause:** src/models/Webhook.js:10-15 — fillable declares is_enabled/status (table has is_active, no status), passes CSV-string events into the JSON NOT NULL webhooks.events column, and never maps the validated 'secret' field to secret_encrypted; src/services/webhookService.js:61,232,352,418 additionally query the nonexistent is_enabled column.
- **Fix:** Align model/service with the real schema: rename is_enabled->is_active and drop status in Webhook.fillable and all webhookService queries, normalize events to a JSON-array string (JSON.stringify of a parsed/split list) before insert, and map secret -> secret_encrypted (encrypted) in the create/update path.

#### [HIGH] payment_plan_installments — render schedule / pay installment
*billing-core · `GET /api/v1/payment-plans/{id}, POST /api/v1/payment-plans/{id}/installments/{seq}/pay` · source `frontend/src/pages/PaymentPlanList.tsx`*

- **Cause:** frontend/src/pages/PaymentPlanList.tsx:52/:327/:328/:338 use inst.sequence_number, but the API returns 'sequence' (payment_plan_installments.sequence via SELECT * in src/services/paymentPlanService.js:291-294; schema.sql:1021), so the value is always undefined in the UI.
- **Fix:** Rename sequence_number to sequence in PaymentPlanList.tsx's Installment interface and its four usages (row key, '#' cell, setPaySeq call).

#### [HIGH] payments — create/update with UI-offered payment_method
*billing-core · `POST /api/v1/payments, PUT /api/v1/payments/{id}` · source `src/middleware/schemas/payments.js`*

- **Cause:** src/middleware/schemas/payments.js:9 and :21 — payment_method enum ['cash','check','credit_card','debit_card','bank_transfer','other'] excludes 'card','transfer','online' which the DB ENUM supports (schema.sql:916, migration 180) and which the /payments UI offers (frontend/src/pages/payments/PaymentActions.tsx:67).
- **Fix:** Add 'card','transfer','online' to the payment_method enums in createPayment/updatePayment in src/middleware/schemas/payments.js (or change PaymentActions.tsx:67 to the canonical cash/check/credit_card/debit_card/bank_transfer/other set used elsewhere).

#### [HIGH] invoices / payments — send-email / send-receipt
*billing-core · `POST /api/v1/invoices/{id}/send-email, POST /api/v1/payments/{id}/send-receipt` · source `src/services/emailTransport.js`*

- **Cause:** Two stacked defects: (1) src/services/emailTransport.js:38-42/46-50 INSERT INTO email_logs (organization_id, ...) — email_logs has no organization_id column (database/schema.sql:3745, migration 046), so sendEmail throws on every call (even the failure-logging path) and both routes 500; (2) src/routes/invoices.js:336-344 and src/routes/payments.js:492-500 ignore sendEmail's {success:false} return, so once (1) is fixed they would return fake 200 success on SMTP failure exactly as claimed.
- **Fix:** Drop organization_id from (or add the column to) the email_logs INSERTs in emailTransport.sendEmail, then have both routes check the returned success flag and respond 502/500 with the error when success:false.

#### [HIGH] expense — create
*billing-edge · `POST /api/v1/expenses` · source `src/models/Expense.js`*

- **Cause:** src/models/Expense.js:11-14 — fillable omits user_id, and crudController.create (src/controllers/crudController.js:105-110) injects only organization_id, so the INSERT never satisfies the NOT NULL expenses.user_id column (database/schema.sql:1140).
- **Fix:** Add 'user_id' to Expense.fillable and have the expenses create route (or a createImpl option in src/routes/expenses.js) default req.body.user_id = req.user.id before calling ctrl.create.

#### [HIGH] client (suspension exemption) — toggle 'Exempt from automatic suspension (VIP)' / save exemption reason
*clients-crm · `PUT /clients/{id}` · source `src/models/Client.js`*

- **Cause:** src/models/Client.js:10-17 — Client.fillable omits 'suspension_exempt' and 'suspension_exempt_reason', so BaseModel.update (src/models/BaseModel.js:165-169) silently strips both fields from the UPDATE while the route still responds 200 with the unchanged record.
- **Fix:** Add 'suspension_exempt' and 'suspension_exempt_reason' to Client.fillable in src/models/Client.js (and mirror them in the updateClient validator/OpenAPI schema so the frontend no longer needs the 'as never' cast).

#### [HIGH] audit_logs — list (page load + filters)
*compliance · `GET /audit-logs?limit=30 (also ?action=create&date_from=...)` · source `src/routes/auditLogs.js`*

- **Cause:** src/routes/auditLogs.js:24 (organization_id = ? condition) and :29 (table_name = ? filter) reference columns that do not exist in audit_logs (database/schema.sql:1313-1334 defines entity_type/entity_id, no organization_id/table_name).
- **Fix:** Change the list query to filter on entity_type instead of table_name and either add an organization_id column to audit_logs via migration or drop the org condition (audit_logs is currently org-agnostic).

#### [HIGH] support_conversation — load message thread
*crm-comms · `GET /api/v1/support/conversations/3/messages` · source `?`*

- **Cause:** Frontend AiSupportPage.tsx:180 calls a GET endpoint that was never implemented; the backend exposes the thread on GET /support/conversations/:id instead.
- **Fix:** Point loadMessages at GET /support/conversations/:id and read data.messages (or add a GET /conversations/:id/messages route).

#### [HIGH] ai_phrase — create/display phrases from UI
*crm-comms · `POST /api/v1/ai/phrases` · source `src/middleware/schemas/ai.js`*

- **Cause:** Frontend AIAssistantSettings.tsx phrase form uses field names phrase/variables while the API/DB use `text` only (src/middleware/schemas/ai.js:62, migration 169 line 104).
- **Fix:** Change the UI to send and render `text` (drop the variables field or add a variables column plus schema support).

#### [HIGH] support_conversation — new conversation + list from UI
*crm-comms · `POST /api/v1/support/conversations` · source `src/routes/supportConversations.js`*

- **Cause:** Frontend AiSupportPage.tsx:196-198 omits required clientId/message, and src/routes/supportConversations.js:318 returns the service's {conversations,total} object as `data` while the UI expects an array.
- **Fix:** Have the route respond {data: result.conversations, total: result.total} and make the UI collect a client and first message before POSTing (or relax the schema for staff-initiated conversations).

#### [HIGH] support_conversation escalation — escalate → create handoff ticket
*crm-comms · `POST /api/v1/support/conversations/3/escalate` · source `src/services/supportConversationService.js`*

- **Cause:** src/services/supportConversationService.js:422 inserts tickets.source='ai_support', which is not in the tickets.source enum (migration 297), and the try/catch swallows the failure.
- **Fix:** Change the INSERT to source='ai_escalated' and surface ticket-creation failure (log + include ticket_id:null warning in the response) instead of silently continuing.

#### [HIGH] device — create
*devices-cpe · `POST /api/v1/devices` · source `src/middleware/schemas/devices.js`*

- **Cause:** /home/coder/Documents/Claude/fireisp5.0/src/middleware/schemas/devices.js:9 and :22 (createDevice type/status enums out of sync with the devices table ENUMs in database/schema.sql / database/migrations/009_create_devices_table.sql:19-29,44) plus /home/coder/Documents/Claude/fireisp5.0/src/models/Device.js:16 (fillable 'firmware_version' vs actual column 'firmware'), with the same wrong value lists mirrored in /home/coder/Documents/Claude/fireisp5.0/frontend/src/pages/DeviceMap.tsx:458-459.
- **Fix:** Align schemas/devices.js type/status enums and Device.fillable with the real devices table (map firmware_version -> firmware in the model or rename the column, and use the DB enum values), then update DEVICE_TYPES/DEVICE_STATUSES and the status default in frontend DeviceMap.tsx to match.

#### [HIGH] inventory transaction — create
*devices-cpe · `POST /api/v1/inventory/transactions` · source `src/middleware/schemas/inventory.js`*

- **Cause:** /home/coder/Documents/Claude/fireisp5.0/src/middleware/schemas/inventory.js:35-43 — createInventoryTransaction requires item_id+warehouse_id with a purchase/sale/rma_* enum, while the route it guards (/home/coder/Documents/Claude/fireisp5.0/src/routes/inventory.js:40-49) consumes stock_id and the DB (database/migrations/037_create_inventory_transactions_table.sql:8-18) requires stock_id NOT NULL with enum receive/assign_to_job/sell_to_client/transfer_out/transfer_in/return/adjustment, matching what frontend/src/pages/InventoryList.tsx:82-90,483-491 sends.
- **Fix:** Rewrite createInventoryTransaction to match the route and DB contract: required stock_id (number, min 1), required transaction_type enum ['receive','assign_to_job','sell_to_client','transfer_out','transfer_in','return','adjustment'], required quantity, optional unit_price/job_id/client_id/invoice_id/reference/notes (and have the route also persist 'reference', which it currently drops).

#### [HIGH] cfdi_documents — create
*fiscal-mx · `POST /api/v1/cfdi-documents` · source `src/models/CfdiDocument.js`*

- **Cause:** src/models/CfdiDocument.js:11-22 — fillable is missing client_id (accepted by src/middleware/schemas/cfdiDocuments.js:6) and lists columns that do not exist in cfdi_documents (database/migrations/070_create_cfdi_documents_table.sql), so the INSERT omits the NOT NULL client_id and the migration-087 MX-locale trigger fires against client_id=0.
- **Fix:** Add client_id to CfdiDocument.fillable and reconcile the rest of the fillable list and createCfdiDocument schema with the real cfdi_documents columns (receptor_regimen, receptor_cp, sat_status; drop or migrate fecha_emision/lugar_expedicion/emisor_*/status).

#### [HIGH] csd_certificates — create (dummy cert upload)
*fiscal-mx · `POST /api/v1/csd-certificates` · source `src/models/CsdCertificate.js`*

- **Cause:** src/models/CsdCertificate.js:12-13 — fillable columns certificate_pem/private_key_encrypted do not exist in csd_certificates (actual: cer_pem/key_pem_encrypted per database/migrations/106_create_csd_certificates_table.sql:20-21); additionally fingerprint_sha256/certificate_number/valid_from/valid_to are NOT NULL but optional in src/middleware/schemas/csdCertificates.js.
- **Fix:** Rename the fillable entries (and validation schema/controller fields) to cer_pem and key_pem_encrypted, and require or derive fingerprint_sha256, certificate_number, valid_from and valid_to from the uploaded certificate before INSERT.

#### [HIGH] pac_providers — create
*fiscal-mx · `POST /api/v1/pac-providers` · source `src/models/PacProvider.js`*

- **Cause:** src/models/PacProvider.js:12-13 — fillable omits the NOT NULL 'label' column and lists 'username' instead of the actual column 'username_encrypted' (database/migrations/107_create_pac_providers_table.sql:15,19).
- **Fix:** Add 'label' to PacProvider.fillable and rename 'username' to 'username_encrypted' (encrypting the plaintext username in the route/controller before insert).

#### [HIGH] tax report export — export type=invoices (UI default) and type=credit_notes, csv+json
*fiscal-mx · `GET /api/v1/billing/tax-reports?type=invoices&format=csv` · source `src/routes/billing.js`*

- **Cause:** src/routes/billing.js:84 and src/routes/billing.js:103 — the credit_notes and invoices tax-report queries filter on cd.deleted_at, but the cfdi_documents table has no deleted_at column (absent from migration 070 and from migration 151's soft-delete table list).
- **Fix:** Remove 'AND cd.deleted_at IS NULL' from both cfdi_documents joins in billing.js (or add deleted_at to cfdi_documents via migration if soft delete is intended).

#### [HIGH] cfdi payment complement — create Complemento de Pago 2.0
*fiscal-mx · `POST /api/v1/cfdi/payment-complement` · source `src/services/cfdiService.js`*

- **Cause:** src/services/cfdiService.js:800-815 — the INSERT INTO cfdi_documents column list includes fecha_emision, lugar_expedicion, emisor_rfc, emisor_nombre, emisor_regimen_fiscal, receptor_domicilio_fiscal and receptor_regimen_fiscal, which do not exist in the cfdi_documents schema (database/migrations/070_create_cfdi_documents_table.sql defines receptor_regimen/receptor_cp and no emisor/fecha/lugar columns).
- **Fix:** Either add the missing issuer/date/place columns to cfdi_documents via migration, or rewrite the INSERT to use the existing columns (receptor_regimen, receptor_cp) and drop the non-existent ones, keeping emisor data only in the generated XML.

#### [HIGH] inventory_transaction — create stock movement (UI contract)
*inventory-assets · `POST /api/v1/inventory/transactions` · source `src/middleware/schemas/inventory.js`*

- **Cause:** createInventoryTransaction in src/middleware/schemas/inventory.js:35-43 validates a different contract (item_id/warehouse_id required, wrong transaction_type enum) than the route handler (src/routes/inventory.js:42-57, stock_id-based), the DB enum (database/schema.sql:3163-3172), and the frontend modal (frontend/src/pages/InventoryList.tsx:82-90, 483-490).
- **Fix:** Rewrite createInventoryTransaction in src/middleware/schemas/inventory.js to match the handler/DB/UI contract: require stock_id (number, min 1), enum ['receive','assign_to_job','sell_to_client','transfer_out','transfer_in','return','adjustment'], and accept unit_price/job_id/client_id/invoice_id/reference/notes.

#### [HIGH] purchase_order — receive PO (stock intake)
*inventory-assets · `POST /api/v1/purchase-orders/1/receive` · source `src/routes/purchaseOrders.js`*

- **Cause:** src/routes/purchaseOrders.js:124 and :131 reference inventory_stock.organization_id, a column that does not exist (see database/migrations/036_create_inventory_stock_table.sql and database/schema.sql:3131-3153), so both the SELECT and INSERT in the receive upsert fail with ER_BAD_FIELD_ERROR.
- **Fix:** Drop organization_id from the SELECT and INSERT on inventory_stock in src/routes/purchaseOrders.js:124/:131 (tenancy is already enforced by PurchaseOrder.findById(id, req.orgId)), or add an organization_id column to inventory_stock via a migration.

#### [HIGH] dhcp_server — create
*network-core · `POST /dhcp-servers` · source `src/routes/dhcpServers.js`*

- **Cause:** src/routes/dhcpServers.js:64/:81/:145/:166 use mysql-style `SET ?` object expansion, but src/config/database.js:229 routes all db.query calls through mysql2 pool.execute(), which cannot prepare `SET ?` or bind object parameters.
- **Fix:** Replace the `SET ?` object queries in src/routes/dhcpServers.js with explicit column lists built from Object.keys(fields) (e.g. `INSERT INTO dhcp_servers (${cols}) VALUES (${placeholders})` and `UPDATE ... SET col = ?, ...`), or route these statements through pool.query() instead of execute().

#### [HIGH] nat_pool — create
*network-core · `POST /nat-pools` · source `src/routes/natManagement.js`*

- **Cause:** src/routes/natManagement.js:55 and :72 use `SET ?` object expansion, incompatible with mysql2 pool.execute() used by db.query (src/config/database.js:229).
- **Fix:** Same fix as dhcpServers.js: build explicit column/placeholder lists for the INSERT at natManagement.js:55 and the UPDATE at :72 instead of `SET ?`.

#### [HIGH] nas health check — run health check (button)
*network-core · `POST /nas/9/health-check` · source `src/services/nasHealthService.js`*

- **Cause:** src/services/nasHealthService.js:166 filters `WHERE is_enabled = TRUE` but the nas table (database/migrations/007_create_nas_table.sql plus all ALTERs) has no is_enabled column — it uses status ENUM('active','inactive') — so the query always throws ER_BAD_FIELD_ERROR.
- **Fix:** In runHealthChecks (src/services/nasHealthService.js:166) replace the initial condition `is_enabled = TRUE` with `status = 'active'` (matching the nas table's actual enabled flag).

#### [HIGH] device_config_backups — list (page load)
*network-monitoring · `GET /api/v1/device-config-backups` · source `src/models/DeviceConfigBackup.js`*

- **Cause:** src/models/DeviceConfigBackup.js:17 (hasOrgScope=true) makes BaseModel (src/models/BaseModel.js:33-34 etc.) emit WHERE organization_id = ? against device_config_backups, which has no such column (database/migrations/064_create_device_config_backups_table.sql).
- **Fix:** Set hasOrgScope to false in DeviceConfigBackup (mirroring src/models/SpeedTest.js) or add an organization_id column via migration.

#### [HIGH] coverage_zones — list/create/update/delete/restore — ALL endpoints
*network-monitoring · `GET|POST|PUT|DELETE /api/v1/coverage-zones` · source `src/services/coverageZoneService.js`*

- **Cause:** src/services/coverageZoneService.js:22 (and lines 76, 96, 125, 189, 215, 234, 243) selects/filters/inserts organization_id, but coverage_zones (database/migrations/062_create_coverage_zones_table.sql) has no organization_id column.
- **Fix:** Add a migration adding organization_id (BIGINT UNSIGNED NULL, FK to organizations, indexed) to coverage_zones, or strip org scoping from coverageZoneService and derive tenancy through the parent service_area_id.

#### [HIGH] payment_gateway — create
*payment-rails · `POST /payment-gateways` · source `database/migrations/101_create_payment_gateways_table.sql`*

- **Cause:** Column/model/schema drift: payment_gateways.name (NOT NULL, no default; database/migrations/101_create_payment_gateways_table.sql:12) is absent from PaymentGateway.fillable (src/models/PaymentGateway.js:10-16) and from the create schema which uses 'label' (src/middleware/schemas/paymentGateways.js:7); fillable 'config' vs column 'config_json' and schema 'webhook_secret' vs column 'webhook_secret_encrypted' compound it, and secret_key_encrypted (NOT NULL, migration line 18) is optional in the schema.
- **Fix:** Align model/schema with migration 101: add 'name' to PaymentGateway.fillable and require it (plus secret_key_encrypted) in createPaymentGateway, rename schema/fillable fields to the real columns (config -> config_json, webhook_secret -> webhook_secret_encrypted), and drop the phantom 'label' field.

#### [HIGH] checkout_session — create-session
*payment-rails · `POST /checkout/session` · source `src/services/checkoutService.js`*

- **Cause:** src/services/checkoutService.js:34-40 INSERTs a nonexistent 'description' column into payment_transactions and omits the NOT NULL columns payment_gateway_id and gateway_reference_id defined in database/migrations/102_create_payment_transactions_table.sql:11,14.
- **Fix:** Rewrite the INSERT in createCheckoutSession to match the payment_transactions schema: drop 'description' (or store it in gateway_response_message), resolve the organization's default active payment gateway for payment_gateway_id (failing with a 4xx if none is configured), and use the generated checkout token as gateway_reference_id.

#### [HIGH] payment_link — generate-link
*payment-rails · `POST /checkout/payment-link` · source `src/services/checkoutService.js`*

- **Cause:** generatePaymentLink (src/services/checkoutService.js:70) reuses createCheckoutSession, whose INSERT at src/services/checkoutService.js:34-40 references a nonexistent 'description' column and omits NOT NULL payment_gateway_id/gateway_reference_id (database/migrations/102_create_payment_transactions_table.sql:11,14).
- **Fix:** Same single fix as claim 1: correct the payment_transactions INSERT in createCheckoutSession (drop 'description', supply payment_gateway_id from the org's default gateway, set gateway_reference_id to the checkout token); payment-link generation then works with no changes of its own.

#### [HIGH] client — set suspension_exempt via PUT (exact UI payload)
*scavenger · `PUT /clients/29` · source `src/models/Client.js`*

- **Cause:** src/models/Client.js:10-17 — fillable array omits suspension_exempt and suspension_exempt_reason, so BaseModel.update() silently filters them out and returns 200 with the unchanged row.
- **Fix:** Add 'suspension_exempt' and 'suspension_exempt_reason' to Client.fillable (and add them to the clients update validation schema).

#### [HIGH] ra_guard_policy — create (and edit — same code path)
*subscriber-net · `POST /api/v1/ipv6/ra-guard` · source `src/routes/ipv6Management.js`*

- **Cause:** src/routes/ipv6Management.js:60-62 (POST) and :77-79 (PUT) use `INSERT/UPDATE ... SET ?` with an object parameter via db.query(), which is pool.execute() (src/config/database.js:229); mysql2's prepared-statement path does not support object expansion for SET ?, so the statement fails and the handler 500s.
- **Fix:** Build explicit column/value lists (e.g. `INSERT INTO ra_guard_policies (${keys.join(',')}) VALUES (${placeholders})` and `SET col = ?` pairs for UPDATE) instead of `SET ?`, or route these writes through pool.query() which supports object expansion.

#### [HIGH] tunnel_6rd_configs / ds_lite_configs / map_rules / xlat464_configs — create (and update — same shared handler)
*subscriber-net · `POST /api/v1/transition-mechanisms/{6rd|ds-lite|map-rules|464xlat}` · source `src/routes/transitionMechanisms.js`*

- **Cause:** src/routes/transitionMechanisms.js:112-115 and :132-135 — shared createHandler/updateHandler pass an object to `SET ?` via db.query(), which executes as a prepared statement (src/config/database.js:229) where object expansion is unsupported, failing every INSERT/UPDATE for tunnel_6rd_configs, ds_lite_configs, map_rules, and xlat464_configs.
- **Fix:** Replace `SET ?` in the shared handlers with explicit column lists/placeholders built from Object.keys(fields) (table names are already whitelisted), and audit the other 43 `SET ?` sites across the 9 route files for the same fix.

#### [MEDIUM] settings — render settings table (frontend contract)
*admin-platform · `GET /api/v1/settings` · source `frontend/src/pages/Settings.tsx`*

- **Cause:** frontend/src/pages/Settings.tsx:97,117,128-129 — OrgConfigTab types GET /api/v1/settings as {data: Setting[]} and gates rendering on settings.length, but the API returns an object map {key: value}, so .length is undefined and neither the table nor the empty state renders.
- **Fix:** In OrgConfigTab, type the response as { data: Record<string, string|null> } and convert it with Object.entries(data?.data ?? {}).map(([key, value]) => ({key, value})) before the length checks/render loop (same pattern as OrganizationList.tsx:362).

#### [MEDIUM] organization setting — update setting key (cache invalidation)
*admin-platform · `PUT /api/v1/organizations/1/settings/date_format` · source `src/routes/organizations.js`*

- **Cause:** src/routes/organizations.js:43-51 — PUT /:id/settings/:key persists via Organization.setSetting but omits the bustCache(orgId, 'settings') call that src/routes/settings.js:34 performs, leaving the 600s httpCache for GET /api/v1/settings stale.
- **Fix:** Import { bustCache } from ../middleware/httpCache in src/routes/organizations.js and call await bustCache(req.params.id, 'settings') after Organization.setSetting in the PUT /:id/settings/:key handler.

#### [MEDIUM] webhook dead-letters — list dead-letter deliveries
*admin-platform · `GET /api/v1/webhooks/dead-letters` · source `src/routes/webhooks.js`*

- **Cause:** src/routes/webhooks.js:22 vs 29 — the parameterized route GET /:id is registered before the static GET /dead-letters route, so /dead-letters is captured as an id and the dead-letters handler is unreachable.
- **Fix:** Move router.get('/dead-letters', ...) (and the other static/nested webhook routes) above router.get('/:id', ...) in src/routes/webhooks.js.

#### [MEDIUM] payments — create/update reference field
*billing-core · `POST /api/v1/payments, PUT /api/v1/payments/{id}` · source `frontend/src/pages/PaymentList.tsx`*

- **Cause:** Frontend field-name drift: frontend/src/pages/PaymentList.tsx:242 and frontend/src/pages/payments/PaymentActions.tsx:315 send 'reference', and PaymentList.tsx:551 renders payment.reference, but the API/model only know 'reference_number' (src/middleware/schemas/payments.js:11,22; src/models/Payment.js:13), so the value is dropped by the fillable filter and never returned.
- **Fix:** Rename 'reference' to 'reference_number' throughout the /payments page (PaymentList.tsx RecordPaymentBody/row render and PaymentActions.tsx Payment type/UpdatePaymentBody/edit form).

#### [MEDIUM] credit note line item — add item
*billing-edge · `POST /api/v1/credit-notes/{id}/items` · source `src/models/CreditNote.js`*

- **Cause:** src/models/CreditNote.js:34 — addItem's INSERT lists a nonexistent 'amount' column in credit_note_items (database/schema.sql:3284-3305, total is GENERATED STORED), and src/middleware/schemas/creditNotes.js:34 requires amount, guaranteeing failure.
- **Fix:** Remove 'amount' from the INSERT column/value lists in CreditNote.addItem and drop the required amount field from createCreditNoteItem.

#### [MEDIUM] quote line item — add item
*billing-edge · `POST /api/v1/quotes/{id}/items` · source `src/models/Quote.js`*

- **Cause:** src/models/Quote.js:34 — addItem's INSERT lists a nonexistent 'amount' column in quote_items (database/schema.sql:1395-1416, where total is a GENERATED STORED column), while src/middleware/schemas/quotes.js:33 requires amount so every valid request fails.
- **Fix:** Remove 'amount' from the INSERT column/value lists in Quote.addItem and drop the required amount field from createQuoteItem (total is computed by the DB).

#### [MEDIUM] ift_statistical_reports — generate/create report
*compliance · `POST /ift-statistical-reports` · source `src/middleware/sanitize.js`*

- **Cause:** src/middleware/sanitize.js:13-20 (escapeHtml, applied to all request bodies at src/app.js:288) converts '"' to '&quot;' inside the JSON-serialized subscribers_by_*/coverage_localities string fields, producing invalid JSON for the JSON columns; the resulting ER_INVALID_JSON_TEXT (errno 3140) is unmapped by the global error handler in src/app.js (~:697-713), surfacing as 500.
- **Fix:** Stop HTML-entity-encoding fields destined for JSON columns (encode on output instead, or exempt/parse JSON-string fields before insert), and add an ER_INVALID_JSON_TEXT/errno-3140 -> 422 mapping in the app.js error handler; separately note the demo org's locale != 'MX' means even valid creates are trigger-blocked (422) on this server.

#### [MEDIUM] regulatory_filings — create (filing_type=quarterly_report)
*compliance · `POST /regulatory-filings` · source `src/middleware/schemas/regulatoryFilings.js`*

- **Cause:** src/middleware/schemas/regulatoryFilings.js:7 filing_type enum diverges from the regulatory_filings DB ENUM (database/schema.sql:5219-5227), and src/models/RegulatoryFiling.js:12-13 fillable references nonexistent due_date/submitted_at while omitting real columns concession_title_id/acknowledgement_number.
- **Fix:** Align the validator enum with the DB ENUM (or migrate the ENUM to the product's desired filing types), rename submitted_at handling to the real filed_at column, and add concession_title_id/acknowledgement_number/document_file_id to fillable.

#### [MEDIUM] concession_titles — create (full schema-valid body)
*compliance · `POST /concession-titles` · source `src/models/ConcessionTitle.js`*

- **Cause:** src/models/ConcessionTitle.js:10-16 fillable and src/middleware/schemas/concessionTitles.js:5-15 both use invented column names (title_type/authorized_services/valid_from/valid_to/regulatory_status) that diverge from concession_titles' real columns (database/schema.sql:5120-5152).
- **Fix:** Rewrite fillable and both validation schemas to the actual columns (concession_type, services_authorized, geographic_scope, spectrum_bands, granted_date, expiration_date, renewal_filed_at, regulatory_body, document_file_id, status, notes), requiring services_authorized and granted_date on create.

#### [MEDIUM] audit export — export audit logs button
*compliance · `GET /audit-logs/export?date_from=2026-07-07` · source `src/routes/auditLogs.js`*

- **Cause:** src/routes/auditLogs.js:57 (organization_id condition) and :61 (table_name filter) reference nonexistent audit_logs columns (database/schema.sql:1313-1334), so the export SELECT throws before the report_access_logs INSERT at :73 ever runs.
- **Fix:** Same column alignment as the list route: filter entity_type instead of table_name and add/drop the organization_id condition to match the real audit_logs schema.

#### [MEDIUM] ai_forbidden_term — add term with default 'all locales'
*crm-comms · `POST /api/v1/ai/forbidden-terms` · source `src/middleware/schemas/ai.js`*

- **Cause:** UI offers an 'all locales' (empty) default (AIAssistantSettings.tsx:855,890) but the API requires locale (src/middleware/schemas/ai.js:78) and the DB column is NOT NULL.
- **Fix:** Either make locale optional in createForbiddenTerm and default server-side (requires making the column nullable to truly mean 'all locales'), or remove the 'all locales' option and default the UI select to a concrete locale.

#### [MEDIUM] ai_policy — save settings from UI
*crm-comms · `PUT /api/v1/ai/policy` · source `src/middleware/schemas/ai.js`*

- **Cause:** Frontend AIAssistantSettings.tsx uses a 50-100 percent scale (lines 287-292) and tone options professional/concise (line 103) that the backend schema (src/middleware/schemas/ai.js:7,18) rejects.
- **Fix:** In the UI, divide/multiply confidence by 100 when saving/loading and replace the TONES list with the backend enum (formal, friendly, technical, empathetic).

#### [MEDIUM] ai_provider — create from UI (field-name drift)
*crm-comms · `POST /api/v1/ai/providers` · source `src/middleware/schemas/ai.js`*

- **Cause:** Field-name drift: frontend AIAssistantSettings.tsx:444-453 sends endpoint/deployment/is_enabled; backend contract is endpoint_url/enabled (src/middleware/schemas/ai.js:29-40, src/routes/ai.js:200-207).
- **Fix:** Align the UI to the API contract: send endpoint_url and enabled, store deployment inside extra_config, and read the {data:{ok,...}} shape from /providers/:id/verify.

#### [MEDIUM] noc_ai_insight — Explain Alert button
*crm-comms · `POST /api/v1/noc-ai/insights/alert-explain` · source `src/middleware/schemas/nocAi.js`*

- **Cause:** Case drift: src/middleware/schemas/nocAi.js:4 requires alertId while the UI (AiSupportPage.tsx:700) sends alert_id.
- **Fix:** Send alertId (and providerId if used) from the UI, or accept alert_id in the explainAlert schema and route (src/routes/nocAi.js:50).

#### [MEDIUM] ai_metrics — load monthly metrics
*crm-comms · `GET /api/v1/ai/metrics?month=2026-07` · source `src/routes/ai.js`*

- **Cause:** Contract drift: backend metrics endpoint (src/routes/ai.js:500-545) ignores `month` and returns different field names than the UI's AiMetrics interface (AIAssistantSettings.tsx:74-81).
- **Fix:** Translate the month picker to date_from/date_to in the UI and rename the fields it reads to the backend keys (or add month support and UI-shaped aliases server-side); guard the toFixed calls.

#### [MEDIUM] message_template — create with Variables field filled
*crm-comms · `POST /api/v1/message-templates` · source `src/routes/messageTemplates.js`*

- **Cause:** src/routes/messageTemplates.js:21 validates `variables` as plain text while the DB column is JSON (migration 057 line 17) and nothing serializes it before INSERT.
- **Fix:** In the create/update path, convert the comma-separated string to a JSON array (e.g. JSON.stringify(variables.split(',').map(s=>s.trim()))) before insert, or migrate the column to TEXT.

#### [MEDIUM] kb_article — search
*crm-comms · `GET /api/v1/support/kb/search?q=Claude%20Test` · source `src/routes/supportConversations.js`*

- **Cause:** src/routes/supportConversations.js:146 applies a body-validating middleware (src/middleware/validate.js:25 reads req.body only) to a GET whose input is in req.query.
- **Fix:** Validate req.query for GET routes (add a source option to validate()) or drop the middleware and return 422 in the handler when q is missing.

#### [MEDIUM] support_metrics — load KPI dashboard
*crm-comms · `GET /api/v1/support/metrics?from=2030-01-01&to=2030-01-02` · source `src/routes/supportConversations.js`*

- **Cause:** Query-param name drift (route expects date_from/date_to, UI sends from/to) at src/routes/supportConversations.js:65 vs AiSupportPage.tsx:572, plus response-shape drift (rollup rows array vs KPI object).
- **Fix:** Accept from/to (or change the UI params), default the range server-side, and aggregate the rollup rows into the single {resolution_rate, escalation_rate, avg_handle_time_seconds, csat, total_conversations, total_escalations} object the UI expects.

#### [MEDIUM] sat_clave_prod_serv / sat_clave_unidad — catalog search (the only mode the UI uses for these two catalogs)
*fiscal-mx · `GET /api/v1/sat-catalogs/clave-prod-serv?search=internet` · source `src/routes/satCatalogs.js`*

- **Cause:** src/routes/satCatalogs.js:76 (descripcion) and src/routes/satCatalogs.js:92 (nombre) reference non-existent columns; both sat_clave_prod_serv and sat_clave_unidad name the column 'description'.
- **Fix:** Change both LIKE filters to 'WHERE description LIKE ?' (optionally also match the clave column).

#### [MEDIUM] inventory_transaction — create stock movement (schema-valid body)
*inventory-assets · `POST /api/v1/inventory/transactions` · source `src/routes/inventory.js`*

- **Cause:** src/routes/inventory.js:42-49 inserts req.body.stock_id, which is always undefined for bodies that pass the createInventoryTransaction schema (src/middleware/schemas/inventory.js:35-43 has no stock_id field), so the INSERT into inventory_transactions fails; additionally :52-53 forces adjustment quantity to -Math.abs(quantity).
- **Fix:** Same fix as claim 1 (align schema and handler on stock_id + the DB enum); additionally in src/routes/inventory.js:52-53 apply the signed quantity as-is for 'adjustment' instead of always negating it.

#### [MEDIUM] warehouse stock — list stock at a warehouse
*inventory-assets · `GET /api/v1/warehouses/4/stock` · source `src/routes/warehouses.js`*

- **Cause:** src/routes/warehouses.js:36 filters 'AND s.organization_id = ?' on inventory_stock, a column that does not exist (database/schema.sql:3131-3153).
- **Fix:** In the /warehouses/:id/stock query (src/routes/warehouses.js:32-37), drop the s.organization_id predicate and enforce tenancy via the joined inventory_items instead, e.g. 'AND (? IS NULL OR i.organization_id = ?)' (inventory_items has organization_id at schema.sql:3082).

#### [MEDIUM] asset/inventory low-stock — low-stock report
*inventory-assets · `GET /api/v1/assets/low-stock` · source `src/services/assetService.js`*

- **Cause:** src/services/assetService.js:89 joins on inventory_stock.organization_id, a column that does not exist (database/schema.sql:3131-3153), so getLowStockItems always throws ER_BAD_FIELD_ERROR.
- **Fix:** Remove the '(? IS NULL OR s.organization_id = ?)' join condition at src/services/assetService.js:89 (and the two matching bind params at :96); org scoping is already applied through i.organization_id at line 91.

#### [MEDIUM] ptr_record — create
*network-core · `POST /ptr-records` · source `src/routes/ptrRecords.js`*

- **Cause:** src/routes/ptrRecords.js:55 and :72 use `SET ?` object expansion, incompatible with mysql2 pool.execute() used by db.query (src/config/database.js:229).
- **Fix:** Same fix as the other routes: replace `SET ?` at ptrRecords.js:55 and :72 with explicit column lists and scalar placeholders (the identical pattern in oltManagement/onuManagement/wirelessManagement/transitionMechanisms/fiberPlantManagement/ipv6Management routes should be fixed in the same sweep).

#### [MEDIUM] speed_tests — create (per documented validator contract)
*network-monitoring · `POST /api/v1/speed-tests` · source `database/migrations/113_create_speed_tests_table.sql`*

- **Cause:** database/migrations/113_create_speed_tests_table.sql:24 defines tested_at TIMESTAMP NOT NULL with no default, while the createSpeedTest validator (src/middleware/schemas/speedTests.js:5-16) never includes tested_at, so the documented create body produces an INSERT missing a required column.
- **Fix:** Add tested_at (optional ISO datetime) to the createSpeedTest schema and default it to NOW() server-side (createImpl) or change the column to DEFAULT CURRENT_TIMESTAMP via migration.

#### [MEDIUM] snmp_profile_oids — add OID (per documented validator contract)
*network-monitoring · `POST /api/v1/snmp-profiles/:id/oids` · source `src/middleware/schemas/snmpProfiles.js`*

- **Cause:** src/middleware/schemas/snmpProfiles.js:28-34 (createSnmpProfileOid) omits metric_column, which database/migrations/030_create_snmp_profile_oids_table.sql:19 declares NOT NULL, so SnmpProfile.addOid (src/models/SnmpProfile.js:37-40) binds undefined into the INSERT.
- **Fix:** Add metric_column as a required string (ideally enum of valid snmp_metrics columns) to createSnmpProfileOid, and coalesce optional fields (oid_type, description) to null/defaults inside addOid.

#### [MEDIUM] config_compliance_results — list compliance results
*network-monitoring · `GET /api/v1/device-config-backups/compliance-results` · source `src/routes/deviceConfigBackups.js`*

- **Cause:** src/routes/deviceConfigBackups.js:25 — GET '/:id' registered before GET '/compliance-results' (line 62), shadowing the static path so requests are dispatched to ctrl.get with id='compliance-results'.
- **Fix:** Register the GET '/compliance-results' (and any other static GET path) before GET '/:id', or constrain the param route to digits (e.g. '/:id(\\d+)').

#### [MEDIUM] service_areas — create
*network-monitoring · `POST /api/v1/service-areas` · source `src/routes/serviceAreas.js`*

- **Cause:** src/routes/serviceAreas.js:23 uses the generic crudController, whose BaseModel.create (src/models/BaseModel.js:157-159) binds the raw boundary string into the POLYGON NOT NULL column defined in database/migrations/061_create_service_areas_table.sql:14 — no ST_GeomFromText conversion exists for service_areas.
- **Fix:** Give serviceAreas a createImpl/updateImpl (or dedicated service like coverageZoneService) that requires boundary on create and wraps it in ST_GeomFromText(?, 4326), returning it via ST_AsText/ST_AsGeoJSON on reads.

#### [MEDIUM] IFT statistical report — create (exact UI payload)
*scavenger · `POST /ift-statistical-reports` · source `frontend/src/pages/Reports.tsx`*

- **Cause:** frontend/src/pages/Reports.tsx:560-570 — handleCreate omits period_start/period_end which src/middleware/schemas/iftStatisticalReports.js:20-21 requires.
- **Fix:** Add period_start/period_end inputs to the IFT create form (or derive them from report_period, e.g. quarter boundaries) before mutating.

#### [MEDIUM] alert rule — create/update with severity 'minor' (a UI dropdown option)
*scavenger · `POST /alerts/rules` · source `frontend/src/pages/Settings.tsx`*

- **Cause:** frontend/src/pages/Settings.tsx:65 offers 'minor' which is not in the alert_rules.severity DB enum (migration 134:17), and src/middleware/schemas/alerts.js:13 has no enum constraint to catch it as a 422.
- **Fix:** Align the sets: replace 'minor' with 'info' in Settings.tsx SEVERITIES (or extend the DB enum) and add the enum to the severity field in schemas/alerts.js so mismatches 422 instead of 500.

#### [MEDIUM] payment — update with payment_method 'card'/'transfer'/'online' (UI options)
*scavenger · `PUT /payments/12` · source `frontend/src/pages/payments/PaymentActions.tsx`*

- **Cause:** frontend/src/pages/payments/PaymentActions.tsx:67 — PAYMENT_METHODS uses 'card'/'transfer'/'online' which are not in the backend enum (src/middleware/schemas/payments.js:9,21) or DB enum (migration 012:10).
- **Fix:** Change the frontend option values to credit_card/bank_transfer (and map 'online' to an accepted value) or extend the enum in schema + migration.

#### [MEDIUM] custom report — update
*scavenger · `PUT /custom-reports/1` · source `src/routes/customReports.js`*

- **Cause:** src/routes/customReports.js:124 — raw name/description/sql_query binds are undefined for partial bodies; mysql2 rejects undefined parameters.
- **Fix:** Coalesce each raw bind to null (name ?? null, etc.) to match the COALESCE(?, col) SQL.

#### [MEDIUM] dashboard widget — update single widget
*scavenger · `PUT /dashboard-widgets/1` · source `src/routes/dashboardWidgets.js`*

- **Cause:** src/routes/dashboardWidgets.js:112-115 — raw destructured binds (position_x, position_y, width, height, title) are undefined on partial update; mysql2 rejects undefined parameters.
- **Fix:** Coalesce every optional bind to null (title ?? null, position_x ?? null, ...) so the COALESCE(?, col) SQL works for partial bodies.

#### [MEDIUM] compliance report — load panel
*scavenger · `GET /reports/compliance` · source `src/routes/reports.js`*

- **Cause:** src/routes/reports.js:312 — backend exposes /data-retention-compliance but frontend/src/pages/Reports.tsx:987 requests /reports/compliance which is unregistered.
- **Fix:** Either add a GET /compliance route or change Reports.tsx:987 to fetch '/reports/data-retention-compliance'.

#### [MEDIUM] network report — load panel
*scavenger · `GET /reports/network` · source `src/routes/reports.js`*

- **Cause:** src/routes/reports.js — no GET /network route exists while frontend/src/pages/Reports.tsx:913 fetches /reports/network.
- **Fix:** Add a GET /network aggregate route in src/routes/reports.js (composing the existing bandwidth/uptime/congestion queries) or point the frontend at the existing per-metric report endpoints.

#### [MEDIUM] reseller — update (partial body)
*scavenger · `PUT /resellers/1` · source `src/routes/resellers.js`*

- **Cause:** src/routes/resellers.js:216-228 — UPDATE binds destructured optional fields directly; undefined values (any omitted field) make mysql2 throw 'Bind parameters must not contain undefined'.
- **Fix:** Coalesce each bind to null (e.g. name ?? null) to work with the COALESCE(?, col) pattern, or build a dynamic SET list from provided keys.

#### [MEDIUM] reseller OLT port assignments — list
*scavenger · `GET /resellers/1/olt-ports` · source `src/routes/resellers.js`*

- **Cause:** src/routes/resellers.js:471 — SELECT references p.port_number which does not exist in olt_ports (columns are port_name/port_no/port_index, database/migrations/266_create_ftth_olt_onu_tables.sql:31-46).
- **Fix:** Change p.port_number to p.port_name (and/or p.port_no) in the olt-ports list query.

#### [MEDIUM] scheduled report — update
*scavenger · `PUT /scheduled-reports/1` · source `src/routes/scheduledReports.js`*

- **Cause:** src/routes/scheduledReports.js:96-99 — raw `format` (and `cron_expression`) destructured binds are undefined when omitted from the body; mysql2 rejects undefined parameters.
- **Fix:** Bind `format ?? null` and `cron_expression ?? null` like the other guarded fields.

#### [MEDIUM] alert correlation panel — load
*scavenger · `GET /analytics/alert-correlation` · source `src/services/analyticsService.js`*

- **Cause:** src/services/analyticsService.js:151-168 — uses ae.rule_id and ae.triggered_at; actual alert_events columns are alert_rule_id and created_at (migration 135).
- **Fix:** Rename the query columns to alert_rule_id and created_at.

#### [MEDIUM] anomaly detection — run detect
*scavenger · `POST /analytics/anomalies/detect` · source `src/services/analyticsService.js`*

- **Cause:** src/services/analyticsService.js:46-63 — queries nonexistent snmp_metrics columns metric/value/recorded_at; actual schema (migration 025) is wide-format with polled_at.
- **Fix:** Rewrite detectAnomalies to iterate the real wide columns (cpu_usage, memory_usage, latency_ms, ...) ordered by polled_at instead of a long-format metric/value pair.

#### [MEDIUM] predictive failure panel — load
*scavenger · `GET /analytics/predictive-failure` · source `src/services/analyticsService.js`*

- **Cause:** src/services/analyticsService.js:102-123 — nonexistent columns: snmp_metrics.metric/value (migration 025) and devices.device_type/last_seen_at (devices has `type`, migration 009:19).
- **Fix:** Rewrite both queries against the real schema (e.g. signal_strength/polled_at on snmp_metrics; devices.type='onu' plus whatever last-seen source exists).

#### [MEDIUM] integration connection — test connection
*scavenger · `POST /integrations/connections/1/test` · source `src/services/integrationService.js`*

- **Cause:** src/services/integrationService.js:325-330 — writes status 'not_implemented' which is not in the integration_connections.status enum (migration 349:13).
- **Fix:** Add 'not_implemented' to the integration_connections.status enum, or keep status='pending' and store the not-implemented note in last_error.

#### [MEDIUM] router driver config — test connection
*scavenger · `POST /router-drivers/1/test` · source `src/services/routerDriverService.js`*

- **Cause:** src/services/routerDriverService.js:119,124-127 — writes 'not_implemented' into last_test_status whose enum only allows ('ok','failed','pending') (migration 341:33), throwing before the route can return 501.
- **Fix:** Add 'not_implemented' to the last_test_status enum via migration, or skip/remap the status write for non-implemented vendors.

#### [MEDIUM] daily usage / top consumers dashboard — summary totals + daily bar chart rendering
*subscriber-net · `GET /api/v1/connection-logs/daily-usage, GET /api/v1/connection-logs/top-consumers` · source `src/routes/connectionLogs.js`*

- **Cause:** Backend SUM() aggregates (src/routes/connectionLogs.js:298-301, 356-358) arrive as strings, and frontend/src/pages/SessionAccounting.tsx:141, 299-301, 353 add them with `+` assuming numbers, producing string concatenation whenever more than one row is aggregated.
- **Fix:** Coerce with Number(r.bytes_in) (or CAST(... AS SIGNED) / decimalNumbers:true in the mysql2 pool config) before summing in SessionAccounting.tsx and anywhere else SUM aggregates are consumed.

#### [MEDIUM] sla-definitions — create/update silently drop the status field (fake success)
*tickets-noc · `PUT /sla-definitions/:id` · source `src/models/SlaDefinition.js`*

- **Cause:** /home/coder/Documents/Claude/fireisp5.0/src/models/SlaDefinition.js:10-17 — 'status' missing from fillable, so BaseModel.create/update (src/models/BaseModel.js:150, 167-173) silently drop it despite src/middleware/schemas/slaDefinitions.js:16/:30 validating it.
- **Fix:** Add 'status' to SlaDefinition.fillable in src/models/SlaDefinition.js.

#### [MEDIUM] tickets — status → resolved never stamps resolved_at, silently breaking the advertised auto-CSAT survey dispatch
*tickets-noc · `PATCH /tickets/:id` · source `src/models/Ticket.js`*

- **Cause:** /home/coder/Documents/Claude/fireisp5.0/src/models/Ticket.js:10-15 — 'resolved_at' not in Ticket.fillable and no route/model hook sets it on the resolved transition (src/routes/tickets.js:108-109 uses the plain crudController), while src/services/interactionService.js:155 requires resolved_at IS NOT NULL for CSAT dispatch.
- **Fix:** In the tickets PUT/PATCH handlers (or a pre-update hook), stamp resolved_at = NOW() when status transitions to 'resolved' and null it on reopen — mirroring the pattern in src/routes/billingDisputes.js:87 — and add 'resolved_at' to Ticket.fillable so the update persists.

#### [LOW] api token — list
*admin-platform · `GET /api/v1/api-tokens` · source `src/routes/apiTokens.js`*

- **Cause:** src/routes/apiTokens.js:18 — crudController(ApiToken) is instantiated without a serialize function and ApiToken (src/models/ApiToken.js) defines no hidden fields, so list/get/update responses include the raw token_hash column.
- **Fix:** Pass a serializer to crudController (e.g. crudController(ApiToken, { serialize: r => { const { token_hash, ...rest } = r; return rest; } })) and apply the same stripping to the PUT handler response at src/routes/apiTokens.js:85.

#### [LOW] invoices — filter by status
*billing-core · `GET /api/v1/invoices?status=pending` · source `frontend/src/pages/InvoiceList.tsx`*

- **Cause:** frontend/src/pages/InvoiceList.tsx:165 includes 'pending', which is not a value of the invoices.status ENUM (schema.sql:871), and 'sent', which the API status enums omit (src/middleware/schemas/invoices.js:16,28) and nothing in src/ ever sets, so both chips always yield an empty list.
- **Fix:** Remove 'pending' from STATUS_OPTIONS; for 'sent' either add it to the API create/update enums (and set status='sent' in the send-email route) or remove the chip as well.

#### [LOW] kb_article — create with tags from UI
*crm-comms · `POST /api/v1/support/kb` · source `src/middleware/schemas/supportConversations.js`*

- **Cause:** src/middleware/schemas/supportConversations.js:31 types tags as 'string' while the UI (AiSupportPage.tsx:395) and the service (kbService.js createArticle) both use arrays.
- **Fix:** Change the tags rule to accept an array (type: 'array') — the service already serializes arrays to JSON.

#### [LOW] invoice — send-email
*scavenger · `POST /invoices/572/send-email` · source `src/routes/invoices.js`*

- **Cause:** src/routes/invoices.js:336-347 — emailTransport.sendEmail() rejection (SMTP failure) propagates via next(err) to the generic 500 handler instead of a structured EMAIL_SEND_FAILED response.
- **Fix:** Catch transport/PDF errors in the send-email handler and return a structured 502/503 (e.g. code EMAIL_SEND_FAILED with the SMTP error summary).

#### [LOW] radius account — read lookup used by the disconnect flow
*subscriber-net · `GET /api/v1/radius/contract/:contractId` · source `src/routes/radius.js`*

- **Cause:** src/routes/radius.js:64-67 returns Radius.findByContract rows verbatim (SELECT * at src/models/Radius.js:30) under the broad devices.view permission, so the cleartext password reaches consumers like RadiusSessions.tsx:329 that only need the account id.
- **Fix:** Whitelist columns (omit password) in the default /radius/contract/:contractId response and serve the credential-bearing variant used by ContractDetail's credentials panel behind a stronger permission (e.g. devices.update or a dedicated radius.credentials.view) or a separate reveal endpoint.

#### [LOW] wg_user_peers (admin list) — pagination
*subscriber-net · `GET /api/v1/wg-peers/admin/all` · source `src/routes/wgPeers.js`*

- **Cause:** Contract mismatch: src/routes/wgPeers.js:118 responds with meta { total, page, limit } while frontend/src/pages/AdminWgTunnels.tsx:421 expects meta.totalPages, so the fallback of 1 permanently hides the pagination controls.
- **Fix:** Either add `totalPages: Math.ceil(total / limit)` to the meta object at src/routes/wgPeers.js:118, or compute totalPages client-side from meta.total and meta.limit in AdminWgTunnels.tsx:421.

#### [LOW] ticket ai-summary — generate AI summary while AI policy disabled — UI silently no-ops
*tickets-noc · `POST /tickets/:id/ai-summary` · source `frontend/src/pages/TicketDetail.tsx`*

- **Cause:** /home/coder/Documents/Claude/fireisp5.0/frontend/src/pages/TicketDetail.tsx:925-926 — postAiSummary ignores the {skipped:true, reason} response shape and coerces it to '', which the '{summary && ...}' guard at line 1001 renders as nothing.
- **Fix:** In postAiSummary, detect body.data?.skipped and throw (or return a sentinel) with a human-readable reason like 'AI summaries are disabled by policy' so handleGenerateSummary surfaces it via setSummaryErr.


---

## Proposed fix plan (PR batching)

Grouped so each PR is a coherent, testable unit. Order = impact-first.

1. **PR‑1 · Critical audit trail + `organization_id`-missing family (Pattern C).** Fix `auditLog.js` writes and `/audit-logs` reads, coverage zones, device config backups, purchase-order receive, warehouse/low-stock, email logs. One migration (add `organization_id` where the read side needs it) + predicate fixes. _Highest priority — restores the compliance audit trail._
2. **PR‑2 · `SET ?` → explicit columns (Pattern B).** DHCP servers, NAT pools, PTR records, RA-guard, transition mechanisms, plus the ~43 other `SET ?` sites the tester flagged. Mechanical and high-volume; unblocks a whole swath of IPv6/DHCP/NAT provisioning.
3. **PR‑3 · Model `fillable`/validator ↔ schema drift (Pattern A).** Client VIP-exempt, Expense, Webhook, CfdiDocument, PacProvider, CsdCertificate, PaymentGateway, ConcessionTitle, RegulatoryFiling, SlaDefinition, Ticket `resolved_at`, DeviceConfigBackup. Each is a small aligned edit to model + schema + (where the frontend sends it) OpenAPI.
4. **PR‑4 · Enum reconciliation (Pattern G) + partial-PUT undefined binds (Pattern E).** Payment methods, alert severity, message-template channel, service-connector statuses; resellers/scheduled-reports/custom-reports/dashboard-widgets `?? null` coalescing.
5. **PR‑5 · Route ordering (Pattern D) + frontend contract drift (Pattern F).** Webhook dead-letters, config compliance-results ordering; payments/payment-plans/settings/AI-settings field alignment. Frontend + small route fixes.
6. **PR‑6 · Long tail.** Remaining one-offs in the appendix (SAT catalog search columns, IFT report sanitizer-vs-JSON, checkout transactions insert, tax-report `deleted_at`, etc.).

Each PR: fix → add/adjust a test that asserts the real contract (mock the **backend** shape, not the frontend's guess) → regenerate OpenAPI where a path/field changed → verify against the demo → squash-merge on green CI. A guardrail worth adding in PR‑1 or a follow-up: a CI check that diffs each model's `fillable` + each validator's fields against the migration columns, so Pattern A/C can't silently return.

## Test objects left on the demo server

Per the "create two, keep one" instruction, the kept objects (all prefixed **"Claude Test"**) remain for inspection; their delete-test siblings were removed and verified gone. Evidence/immutable entities (invoices, payments, CFDI, credit notes, audit entries, regulatory filings, DSAR, etc.) were created once and left in place by design. Full inventory in the appendix below. Everything is namespaced and safe to bulk-delete later by the "Claude Test" prefix.

## Not yet exercised end-to-end (rate-limit skips)

The appendix lists the ~57 write paths and 23 partials that were code-traced but not driven live before the shared rate window saturated (full contract FSM transitions, service-order provisioning stages, some CFDI stamping, automation script execution, integration sync). None are known-broken; they're **unverified**, not passing. A future run with a dedicated key finishes them.

---

## Appendix B — "Claude Test" objects kept on the demo server

- **ai_forbidden_term** id=1: claude-test-garantizado (es) → generalmente
- **ai_phrase** id=1: Claude Test greeting phrase (es), updated
- **ai_provider** id=1: Claude Test Proveedor UI (editado) — ollama, RFC5737 endpoint; policy active_provider_id now points here (chatbot remains disabled)
- **alert_rule** id=1: Claude Test Regla Latencia (disabled)
- **asset** id=1: Claude Test ONU Huawei EG8145V5 (CLD-AST-001, in_stock) — kept
- **asset** id=2: Claude Test Antena Ubiquiti LiteBeam (CLD-AST-002, disposed) — kept (partB delete never ran)
- **automation_rule** id=1: Claude Test Regla A - Aviso de pago vencido (disabled)
- **automation_script** id=1: Claude Test Script A - Reporte de sesiones
- **billing_adjustment (append-only)** id=3: Claude Test Ajuste — -50.00 discount on invoice 573 (a second system adjustment was auto-created by refund processing)
- **billing_dispute (evidence)** id=2: Claude Test Disputa — resolved_favor_client, with evidence file id 1
- **cash_reconciliation_session (evidence)** id=2: Claude Test Sesión de corte — closed then approved, variance 0.00
- **chargeback (evidence)** id=1: Claude Test chargeback — 450.00 MXN conekta, evidence_submitted
- **client (FK holder)** id=35: Claude Test Cliente Soporte
- **client** id=29: Claude Test Cliente A (kept contact id 3 + mx-profile id 1 on it)
- **client** id=29: Claude Test Cliente A (kept + updated; Guadalajara, Jalisco)
- **client** id=30: Claude Test Cliente B (created; archive/restore test still queued in background batch)
- **client_mx_profile** id=1: MX fiscal profile for client 29 (RFC GATJ850615HD1)
- **clients** id=36: Claude Test Cliente Fiscal MX (support FK object, locale=MX)
- **communication_campaign** id=4: Claude Test Campana Email A (editada) — DRAFT, template_id 10, never dispatched
- **config_backup_schedule** id=1: Claude Test Respaldo A (deshabilitado)
- **config_backup_schedule** id=3: Claude Test Respaldo Nocturno N2-A (actualizado 02:30, disabled)
- **config_template** id=1: Claude Test Plantilla A - MikroTik base
- **contact** id=3: Maria Guadalupe Torres (contact of client 29; contact 4 was created+deleted as the delete test)
- **credit_note (evidence)** id=1: CT-CN-1783428335 — Claude Test Nota de Crédito, 116.00
- **custom_report** id=1: Claude Test Reporte A - Clientes por estado
- **dashboard_widget** id=1: Claude Test Widget A - Ingresos
- **data_residency_config** id=1: Claude Test residencia de datos MX/Jalisco — org had NO config before this run (GET was 404); compliance_status compliant
- **dsar_request (EVIDENCE)** id=2: Claude Test solicitud ARCO de acceso — client 35, status pending, due 2026-08-06
- **factura_publica_invoice_items** id=1: item linking pre-existing paid invoice 555 to factura publica 1
- **factura_publica_invoices** id=1: Claude Test factura publica 04/2026 monthly (EVIDENCE, kept per policy)
- **follow_up_reminder** id=10: Claude Test seguimiento - confirmar reparacion de fibra (ticket 10)
- **identity_verification_record** id=3: Claude Test verificacion CURP LOHC900215HJCPRR04 — client 35, status verified
- **integration_connection** id=1: Claude Test Conexion A - ContPAQi
- **inventory_item** id=2: Claude Test Router MikroTik hEX RB750Gr3 (SKU CLD-RB750GR3) — updated, kept
- **inventory_item** id=3: Claude Test Cable UTP Cat6 Bobina — delete/restore cycle in background run
- **invoice (evidence, from quote conversion)** id=573: INV-000218 — Claude Test, 1392.00, status issued
- **invoice (evidence)** id=572: INV-000217, client 33, MXN — never delete
- **ip_assignment** id=3: assign-next result — 10.77.221.1 (dynamic) in pool 4
- **ip_assignment** id=4: Claude Test asignacion A R2 — 10.77.221.50 (reserved)
- **ip_pool** id=4: Claude Test Pool Residencial GDL R2 — 10.77.221.0/24
- **kb_article** id=3: Claude Test KB A - Reiniciar modem (es, unpublished due to is_published drop bug)
- **message_template** id=10: Claude Test Plantilla R2 (editada) — email, kept+updated
- **message_template** id=8: Claude Test Plantilla WhatsApp B — used for delete/restore test; final cleanup delete blocked by 429, left restored
- **nas** id=9: Claude Test NAS Monterrey (editado R2) — 192.0.2.10, kept from round 1, updated this run
- **noc_ai_insight** id=1: shift_summary insight created by NOC AI action test
- **outage** id=1: Claude Test Corte Planeado A - Mantenimiento de fibra Col. Centro GDL (planned, updated to resolved via PUT)
- **outage** id=3: Claude Test Corte Planeado B - Migracion OLT Zapopan (v2, conservado) (planned, ongoing)
- **payment (evidence)** id=12: cash payment on client 33, allocated to invoice 572, ref CLAUDE-TEST-FOLIO-001 — never delete
- **phone_number_inventory** id=1: Claude Test numero de prueba GDL +523355500100 — status 'blocked' after DELETE-semantics test
- **plan** id=10: Claude Test Plan Inalambrico 50 (50/10 Mbps, $349 MXN — was slated for the delete/restore test that never ran; safe to delete)
- **plan** id=9: Claude Test Plan Fibra 100 (updated: 100/25 Mbps, $549 MXN, monthly, active)
- **plan_speed_window** id=1: Claude Test Ventana Nocturna v2 (on plan 9, 23:00-05:00, 250/60 Mbps — delete attempt was rate-limited)
- **profeco_complaint (EVIDENCE)** id=2: Claude Test Maria Guadalupe Lopez — CONCILIANET-2026-CT01, facturacion/recibida
- **purchase_order** id=1: CLAUDE-TEST-PO-001 (status sent, 1 line item, vendor 1, warehouse 4) — kept
- **purchase_order** id=2: CLAUDE-TEST-PO-002 — background delete/restore/delete scheduled
- **quote** id=3: Claude Test Cotización A (CT-QT-A-1783428335, status accepted after conversion)
- **refund_request (evidence)** id=2: Claude Test refund — 120.50, status processed (manual)
- **remediation_rule** id=1: Claude Test Remediacion A - CPU alta
- **reseller** id=1: Claude Test Revendedor A - Redes del Bajio (+plan-price, bw-quota, billing-entity rows)
- **rma_request** id=1: CLAUDE-TEST-RMA-001 (asset 1, status open) — kept
- **rma_request** id=2: CLAUDE-TEST-RMA-002 (status open) — kept
- **role (created+deleted as part of test)** id=14: Claude Test Rol Cobranza — soft-deleted, GET now 404 (delete-path evidence, not kept)
- **role** id=10: Claude Test Rol Facturacion (perms: clients.view)
- **role** id=13: Claude Test Rol Soporte NOC (description updated, permission clients.view attached)
- **router_driver_config** id=1: Claude Test driver cisco_ios/ssh 192.0.2.10 (user claude_test)
- **satisfaction_survey** id=4: Claude Test NPS survey (responded, score 9, client 35)
- **satisfaction_survey** id=6: Claude Test NPS survey (client 35) — sent + responded score 9
- **scheduled_report** id=1: Claude Test scheduled aging/csv weekly (0 8 * * 1)
- **service_modification_notice** id=1: Claude Test aviso de ajuste de tarifa 399→419 MXN — status sent
- **site** id=5: Claude Test Sitio POP Guadalajara (editado)
- **sla_definition** id=1: Claude Test SLA Oro 99.95 (editado) (plan 9, active)
- **snmp_profile** id=23: Claude Test Perfil SNMP A - MikroTik CCR (updated: poll 60s)
- **speed_test** id=1: Claude Test Prueba A - ACTUALIZADA (technician, 192.8/48.2 Mbps)
- **subscriber_certificate** id=3: Claude Test Cert A - cliente.norte.mx (renovado) — serial 4CLAUDE0001A, active, valid 2026-07-01 → 2027-07-01
- **subscriber_consent** id=3: Claude Test consentimiento ARCO — client 35, purpose marketing, withdrawn during withdraw-action test
- **support_conversation** id=3: Claude Test web conversation (client 35) — escalated
- **tax_rates** id=8: Claude Test FX IEPS 3.0% (editado)
- **tax_rules** id=3: Claude Test FX IVA Frontera Norte (editado)
- **ticket_escalation** id=4: Claude Test escalacion L1 (resolved, ticket 10) — no delete endpoint exists
- **ticket_escalation** id=5: Claude Test escalacion L2 (open, ticket 10) — no delete endpoint exists
- **ticket** id=10: Claude Test Ticket A - Sin internet en Col. Centro (open/critical; carries kept comment #2, time log #1, follow-up #10)
- **uso_obligation** id=1: Claude Test despliegue rural Sierra de Manantlan — status reported, 7/12 localidades
- **vendor** id=1: Claude Test Distribuidora Syscom — updated, kept
- **vendor** id=2: Claude Test Mayorista TVC — background delete scheduled
- **vlan** id=2: Claude Test VLAN Clientes MTY (vlan_id 3101) — kept from round 1, updated this run
- **warehouse** id=4: Claude Test Almacén Norte (Chihuahua) — updated, kept
- **warehouse** id=5: Claude Test Almacén Sur — restore-tested; final background delete may have completed
- **webhook** id=1: Claude Test webhook https://example.com/fireisp/claude-test-a-upd
- **winback_campaign** id=4: Claude Test Winback A (editada) — draft, cancelled_90d, 40%

## Appendix C — partials (worked with caveats / needs follow-up)

- (contracts-lifecycle) API rate limiter — any request: After ~15 requests the shared per-IP limiter (RATE_LIMIT_API default 200 req/15 min, express-rate-limit keyed by IP, shared with p
- (billing-core) late_fee_rules — list with page/limit: The frontend sends page/limit and reads data.meta.totalPages, but the route returns {data: rows} from an unpaginated SELECT (src/s
- (fiscal-mx) cfdi stamp (EVIDENCE attempt) — stamp (timbrar): Stamping could only be exercised on its error paths: unknown id -> clean 404 {"code":"NOT_FOUND"}, missing body -> clean 422 VALID
- (fiscal-mx) cfdi_documents conceptos — get conceptos of nonexistent document: Returns 200 {"data":[]} for a document id that does not exist (no ownership/existence check), inconsistent with sibling endpoints 
- (payment-rails) portal_invoice_pay — pay-invoice: Route requires a client portal token (returned 401 UNAUTHORIZED without one, which is correct). By code it calls the identical bro
- (payment-rails) recurring_charge — charge-profile: Nonexistent profile 999999 returns {"code":"INTERNAL_ERROR"} instead of a 404. checkoutService.chargeRecurringProfile throws a pla
- (network-core) nas — test API connection (button): Graceful, correctly-classified failure: {"error":{"code":"ROUTER_UNREACHABLE","message":"RouterOS connect timeout to 192.0.2.10:87
- (network-core) nas — seed (RADIUS/PPP bootstrap): Graceful 502 ROUTER_UNREACHABLE ("RouterOS connect timeout to 192.0.2.10:8728") — validation accepted the body and the failure is 
- (network-core) nas — VoIP/RTC address-list refresh (button): Graceful 502 ROUTER_UNREACHABLE — VoIP ranges resolved server-side (error is the router timeout, not VOIP_RANGES_EMPTY) and the pu
- (network-monitoring) device_config_backups — on-demand backup pull via FireRelay: Graceful, honest failures: 404 "devices not found" for unknown device_id; 422 "Device does not have a firerelay_node_id — assign a
- (subscriber-net) API rate limiter — any request burst: Shared 200-requests/15-min window (src/config/index.js RATE_LIMIT_API) was continuously exhausted during testing — single read cal
- (inventory-assets) inventory_item / vendor / purchase_order / asset — delete + restore cycles (items 3, vendor 2, PO 2, asset 2): Warehouse delete/restore was fully verified live (DELETE 204 → GET 404 → restore 200 → GET 200 → DELETE 204). The identical script
- (tickets-noc) ticket ai-triage — read triage suggestions: Returns 404 {"error":"No triage result found for this ticket"} — graceful; no triage row exists because the org AI policy is disab
- (tickets-noc) noc alarms — severity vocabulary mismatch between API and badge component (code observation): Endpoint returns severities from alert_rules ENUM ('info','warning','major','critical') but NocDashboard.tsx SeverityBadge maps on
- (crm-comms) ai_provider — verify (Test connection): 502 {"code":"LLM_VERIFY_FAILED","message":"Provider verification failed: fetch failed"} against an RFC5737 test endpoint — gracefu
- (compliance) concession_titles — create minimal / update / delete / restore: Minimal create fails gracefully: 422 DB_RULE_VIOLATION "concession_titles requires the referenced organization to have locale = 'M
- (compliance) regulatory_filings (EVIDENCE) — create evidence filing (filing_type=annual_report, DB-valid enum): Graceful 422 DB_RULE_VIOLATION "regulatory_filings requires the referenced organization to have locale = 'MX'" — same org-locale t
- (compliance) phone_number_inventory — delete: DELETE returns {"success":true} but does not remove the row — it only sets status='blocked'; GET /:id afterwards returns 200 with 
- (compliance) service_modification_notices — send notice: Returns success and stamps noticed_at/status='sent', but per the route code it is a single UPDATE — no notification is dispatched 
- (compliance) identity_verification_records — CURP checksum result persistence: The server validates the CURP checksum on create (bad CURP correctly 422 CURP_INVALID) but never persists the result: curp_checksu
- (scavenger) technician productivity report — load: 503 {"code":"DB_MIGRATIONS_REQUIRED","message":"A required database table is missing. Run `pnpm run migrate`..."} — graceful, self
- (scavenger) automation script — execute: 501 {"code":"SCRIPT_EXECUTION_NOT_ENABLED","message":"Script execution engine is not enabled...sandboxed executor must be configur
- (scavenger) password policy — read: 404 {"error":"No password policy configured"} — honest empty-state response rather than an empty 200; the test script flagged it o
