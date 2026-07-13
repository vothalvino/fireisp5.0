---
name: org-email-settings
description: Migration 386 per-org SMTP settings + org-aware sendEmail + real bulk-email send — naming resolutions and test gotchas
metadata:
  type: project
---

Migration 386 added `organization_email_settings` (mirrors `organization_database_configs`
exactly — encrypted `smtp_password_encrypted`, `configured:boolean` in GET responses, never
the ciphertext), `email_logs.organization_id` (nullable, backfilled), and
`email_settings.view`/`email_settings.update` permissions seeded to admin+super_admin ONLY
(migration 377's credential-module carve-out — excluded from readonly/auditor's `*.view`
wildcard). `src/models/EmailSettings.js`, `src/routes/emailSettings.js` +
`src/services/emailSettingsService.js` (thin route -> service -> model, mirrors
`tenantDatabaseService.js`'s shape for the GET/PUT/test-connection trio more closely than
`invoiceSettingsService.js`, which has no "test" action). `src/services/emailTransport.js`
gained an org-aware transport cache (`getOrgTransport`/`invalidateOrgTransport`, Map keyed by
orgId) — `sendEmail({organizationId,...})` now actually uses it; ~20 pre-existing callers that
already passed `organizationId` (invoices, payments, notificationHooks,
paymentReminderService, scheduledReportService, taskRunner) activated with zero call-site
changes. `POST /bulk/email` (`src/routes/bulk.js`) replaced its `eventBus.emit` no-op (zero
listeners) with a real detached, bounded-concurrency (5) send via `emailTransport.sendEmail`
after the `{queued,not_found}` response is returned.

**Naming resolution — brief vs. its own spec disagreed, spec won:** the task brief said column
`smtp_username` and model `OrganizationEmailSettings.js`; the detailed spec it referenced used
`smtp_user` and `EmailSettings.js` consistently everywhere (DDL, model, validation schema,
emailTransport, anchors, files-touched list). Went with the spec since `smtp_user` also matches
the existing `db_user` (not `db_username`) convention in `OrganizationDatabaseConfig`. If a
future PR touches this table, `smtp_user` is the real column name.

## Test gotchas discovered here

**`emailTransport.js`'s module-level `transporter` (global relay) is a true singleton across a
whole test file** — `init()` only runs once ever (guarded by `if (!transporter)`), so every
"global transport" test in `tests/emailTransport.test.js` must share ONE `mockSendMail`
reference (declared once, queue per-test values with `mockResolvedValueOnce`/
`mockRejectedValueOnce`) rather than swapping `nodemailer.createTransport`'s return value per
test — whichever test runs first "wins" the real `init()` call and that sendMail mock sticks
for the rest of the file. Per-org transports (`getOrgTransport`, cached in a separate Map keyed
by orgId) do NOT have this constraint — fresh `mockReturnValueOnce`/distinct org ids per test
work fine there.

**Mock SQL dispatchers must not match on exact whitespace.** A template-literal SQL string like
`` `UPDATE organization_email_settings\n  SET last_test_at = ...` `` does NOT contain the
literal substring `'UPDATE organization_email_settings SET last_test_at'` (single space) — the
real string has a newline+indentation between the table name and `SET`. Match on two separate
`.includes()` checks (table name, then a column name) instead of one long literal substring.

**Real-RBAC 403 tests don't need to mock `User.getPermissions`'s SQL by hand if you mock
`../src/models/User` directly** (see `tests/rbac.test.js`'s pattern) — but to test the FULL
authenticate→orgScope→rbac chain via supertest against the real app (not the middleware in
isolation), mock `db.query` with a 3-tier dispatcher matching, in this priority order: (1) the
group-membership check (`FROM users u` + `JOIN roles g`) → `[[]]`, (2) the org-membership-role
check (`FROM organization_users ou` + `JOIN roles r`) → `[[]]`, (3) the legacy `users.role`
fallback (`FROM users u` + `r.name = u.role`) → your granted-slugs array, (4) generic
`WHERE id = ?` → the user row for `authenticate()`. Order matters — check the most specific
patterns first, generic user-lookup last. See `tests/emailSettingsPermissions.test.js`.

## Frontend

`Settings.tsx`'s four pre-existing tabs (orgConfig/alertRules/paymentGateways/quotas) do NOT
use i18next at all — the `TABS` array's `label` strings are hardcoded English, defined outside
the component (can't call `useTranslation()` there). Added the new `emailSettings` tab's own
button label the same way (hardcoded, not i18n) to stay consistent with its three siblings,
while giving the tab's actual FORM CONTENT full i18n coverage (en/es/pt-BR) per CLAUDE.md's
project-wide rule. If a future PR wants the tab bar itself translated, that's a bigger,
deliberate refactor touching all 4+ existing tabs' labels, not a one-tab patch.

**The `useEffect(() => { if (data) setForm({...}) }, [data])` reset-on-load pattern** (used by
`InvoiceSettings.tsx`, `AIAssistantSettings.tsx`, and now `EmailSettingsTab`) has a real (if
narrow) race: if a user starts typing before the initial GET resolves, the effect firing on
data-arrival wipes their in-progress edit. Pre-existing across all three call sites, not
introduced or fixed here — when writing a test for one of these tabs, wait for the loading
indicator to clear (`isLoading` false) before typing into any field, not just for an element to
exist (form inputs render unconditionally from the very first frame, before data loads).

## Deferred / flagged, not fixed here (see PR description for details)

- `GET /payment-gateways` (`src/routes/paymentGateways.js`) returns `secret_key_encrypted`/
  `webhook_secret_encrypted` verbatim via crudController's default serializer — ciphertext
  today, plaintext leak if `ENCRYPTION_KEY` is ever unset. Pre-existing, unrelated to this PR;
  recommend a `serialize` option mirroring `nas.js`'s `redactNas()`.
- `processQueue()` in `emailTransport.js` stays global-only — `email_logs` rows queued via
  `notificationService.sendNotification()` have no `organizationId` at their INSERT site
  (template_id-driven, no org threading today). Deferred, documented with a code comment.
- `auth.js`/`portal.js` password-reset and `authService.js` email-verification sends
  deliberately stay on the global relay (anti-enumeration timing / no clean org in scope at
  those call sites) — a permanent policy stance per the spec, not a gap.
