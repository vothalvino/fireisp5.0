---
name: secret-redaction-sweep
description: crudController serialize is the established secret-redaction pattern (has_* boolean); payment-gateways + 5 sibling routes fixed on branch fix/payment-gateways-secret-redaction; 3 adjacent leaks found and flagged, NOT fixed
metadata:
  type: project
---

## The vulnerability class

`src/utils/encryption.js`'s `encrypt()`/`decrypt()` are TRANSPARENT NO-OPS when
`ENCRYPTION_KEY` is unset (dev/test/misconfigured prod). Any `*_encrypted`
column returned verbatim in an API response is therefore a live plaintext
secret leak in that mode, not just theoretical ciphertext exposure. Every
`crudController(Model)` call with NO `serialize` option, where the model's
table has a `*_encrypted` or plaintext-secret column, is this bug class.

## The established fix pattern (already used before this sweep — not invented here)

`crudController`'s `serialize` option (applied to every response path: list,
get, create, update, partialUpdate, restore — see
`src/controllers/crudController.js`) is the house convention. The
redact-function shape used everywhere: strip the secret column(s), add a
`has_<field>` boolean derived from `Boolean(rawValue)` so the UI can still
show a "configured" badge without the value. Confirmed pre-existing users of
this exact pattern before this sweep: `nas.js` (`redactNas`), `radius.js`
(`Radius.sanitize`), `users.js` (`sanitizeUser`), `OrganizationDatabaseConfig`
(`toPublic`/`has_password`), `EmailSettings` (`toPublic`/`configured`),
`sso.js` (inline destructure), `routerDrivers.js` (`sanitizeConfig`,
`has_password`/`has_api_token`). When adding a new secret-bearing
crudController route, mirror this — don't invent a new shape.

## Fixed on branch `fix/payment-gateways-secret-redaction` (commit 3b040f7)

- `paymentGateways.js`: `secret_key_encrypted`, `webhook_secret_encrypted` → `has_secret_key`/`has_webhook_secret` (the originally-reported bug)
- `devices.js` + `discoveryScans.js`: `snmp_v3_auth_key_encrypted`, `snmp_v3_priv_key_encrypted` → shared `src/utils/deviceSanitize.js`'s `redactDevice()` (mirrors `radiusSanitize.js`'s own-module convention, since discoveryScans.js's onboard-from-discovery endpoint creates a `Device` directly, bypassing devices.js's crudController entirely — needed the same redaction reachable from two files)
- `csdCertificates.js`: `key_pem_encrypted` (CFDI digital-signing private key — high severity), `passphrase_encrypted`
- `pacProviders.js`: `username_encrypted`, `password_encrypted`, `api_key_encrypted`, `token_encrypted` (the latter two aren't in the model's `fillable` but ARE real schema columns — `SELECT *` returns them regardless of fillable, which only gates writes)
- `webhooks.js`: `secret_encrypted` (genuinely plaintext by design per `Webhook.js`'s own comment — "no encryption layer applied")

**Non-obvious gotcha**: routes using crudController sometimes have CUSTOM handlers that bypass `ctrl.create`/`ctrl.update`/`ctrl.restore` entirely (calling the model directly + `res.json({data: record})`) — the `serialize` option on the `crudController(...)` call does NOT cover these. Found and fixed two in `devices.js` (custom PUT and restore handlers) and two in `discoveryScans.js` (custom POST handler + the onboard endpoint). Grep every `res.json` / `res.status(...).json` in a route file, not just the ones wired through `ctrl.*`, before declaring a route redacted.

## Sibling routes verified CLEAN (already redact correctly, no action needed)

`radius.js`, `users.js`, `nas.js`, `ai.js`, `sso.js` (`organization_sso_configs`),
`emailSettings.js` (`organization_email_settings`, via `EmailSettings.toPublic`),
`routerDrivers.js` (`router_driver_configs`), and `alerts.js`'s
`alert_notification_channels` routes (uses an explicit column allowlist,
excludes `config_encrypted`).

## Adjacent leaks found during the sweep — FLAGGED, NOT FIXED (out of scope: hand-rolled raw-SQL routes, not `crudController`)

These are the same vulnerability class but a different code shape (raw
`SELECT *` + `res.json({data: row})` in a hand-written route, not
`crudController`), so they were flagged per the task's own "ambiguous →
flag rather than guess" instruction rather than fixed in the same PR:

1. **`src/routes/onuManagement.js`** — `onu_details.loid_password_encrypted`
   and `onu_omci_configs.wifi_password_encrypted` leak verbatim via
   `SELECT * FROM onu_details WHERE id = ?` / `onu_omci_configs` followed by
   raw `res.json({ data: rows[0] })` (list + get + create + update, multiple
   endpoints in this file). These are GPON subscriber ONU registration/WiFi
   passwords — real severity.
2. **`src/routes/bandwidthTests.js`** — `bandwidth_test_servers.auth_token`
   (plaintext bearer token to an internal iperf3 server — lower severity,
   still leaked verbatim via list/get/create/update).
3. **`nas.js`'s `secret` column** (NOT `_encrypted` — a `VARCHAR NOT NULL`
   RADIUS shared secret, never passed through `encrypt()`/`decrypt()` at
   all) is returned by `GET /nas` to anyone with the broad `devices.view`
   permission, with no dedicated gate analogous to `radius.js`'s
   `radius.credentials.view`. Deliberately NOT touched — plausibly
   operationally necessary (admin needs it to configure the physical
   router's RADIUS client) and a different remediation shape (permission
   gate, not full redaction) would be needed; flagging for a product
   decision rather than guessing.

**How to apply:** if picking up a follow-up security PR, start with
onuManagement.js (highest severity of the three, straightforward
`res.json` → helper-function fix, same shape as this PR's `devices.js`/
`discoveryScans.js` fixes).
