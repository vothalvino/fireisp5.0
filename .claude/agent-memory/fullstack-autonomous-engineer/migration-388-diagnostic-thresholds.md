---
name: migration-388-diagnostic-thresholds
description: Configurable RF/optical diagnostic thresholds (fiber + wireless signal + new wireless link-capacity check) — migration 388, three-tier resolution, PATCH/PUT bug found+fixed
metadata:
  type: project
---

Migration 388 (branch `feat/configurable-diagnostic-thresholds`): made
`diagnosticEngineService.js`'s hardcoded `-27 dBm` (fiber ONU RX) and
`-75 dBm` (wireless CPE signal) thresholds configurable, and added a
genuinely new check `cpe_link_capacity` (the negotiated RF link rate in
Mbps — `wireless_client_sessions.tx_rate_mbps`/`rx_rate_mbps`, e.g.
Ubiquiti "link capacity" — NOT a client-count/AP-load percentage; the
older `ap_load` check is a distinct, still-unimplemented stub, untouched).

**Schema**: `contracts.optical_min_dbm` / `wireless_signal_min_dbm` /
`wireless_link_capacity_min_mbps` (per-contract overrides);
`ap_sector_configs.signal_min_dbm` / `link_capacity_min_mbps` (per-sector
defaults). All nullable, no non-NULL default.

**Resolution** (plain JS `??` chains in `diagnosticEngineService.js`, not
SQL COALESCE): fiber = `contract.optical_min_dbm ?? -27`; wireless signal =
`contract.wireless_signal_min_dbm ?? sector.signal_min_dbm ?? -75`;
wireless capacity = `contract.wireless_link_capacity_min_mbps ??
sector.link_capacity_min_mbps ?? null` — **no global default for
capacity**; unset means the check reports `'unknown'`, never a fabricated
ok/warning. Serving sector is resolved from the SAME
`wireless_client_sessions` row `_getWirelessSignal` already fetches
(extended to also SELECT `device_id AS ap_device_id`,
`tx_rate_mbps`, `rx_rate_mbps`), joined to `ap_sector_configs` via a new
`_getApSectorThresholds` helper — soft-delete-guarded (`deleted_at IS
NULL`), same lesson as #404's contract-lookup fix.
`_getApSectorThresholds` deliberately uses `(organization_id = ? OR
organization_id IS NULL)`, NOT strict `organization_id = ?` — this
matches `wirelessService.js`'s existing convention for
`ap_sector_configs` specifically (its `organization_id` is nullable =
"single-tenant deployment" fallback per the schema comment), not the
stricter convention `_getWirelessSignal`/`_getOnuStatus` use for their
own (different) tables. A reviewer may flag this as an inconsistency —
it isn't; it's file-consistent per-table, and was specified verbatim in
the owner's brief.

**Escalation**: `cpe_link_capacity` added to `QUALITY_ESCALATE` at
`['warning']` alongside `cpe_signal` (a degraded link rate is a
per-client RF-quality fault the customer can't fix by power-cycling,
same category as low signal) — gated by the same migration-387
per-contract `escalation_enabled`/`escalate_on_disconnect` toggles. The
sector-wide `ap_load` (client-count/AP-load %) stays non-escalatable,
untouched — a herd-effect risk this file already avoids for
`channel_interference`.

**Discovered-and-fixed side bug**: `WirelessManagementPage.tsx`'s
save actions for AP sectors/channel plans/interference all called
`api.PATCH` against routes registered ONLY as `router.put(...)` in
`src/routes/wirelessManagement.js` — confirmed via the regenerated
OpenAPI schema (`patch?: never` on all three paths). Every edit on that
page silently 404'd; the `as never` cast on the path string suppressed
TypeScript from catching it. Fixed all 3 to `api.PUT`. Also fixed: the
page itself was routed (`App.tsx`) but had zero nav entry anywhere
(`Layout.tsx`) — added `/wireless` to both the generic and technician
nav groups.

**DECIMAL columns are JS strings from mysql2** (no `decimalNumbers:true`
set in `src/config/database.js`) — see [[mysql2-decimal-string-gotcha]].

**Frontend `key={id}` gotcha** on the new `RfThresholdsTab` — see
[[react-router-param-change-no-remount]].

Not fixed (flagged, out of scope): Settings → Org Config tab
(`GET /settings`) has an unrelated pre-existing response-shape bug —
untouched since migration 388's global thresholds are code constants,
not settings-table rows. A never-polled CPE has no resolvable serving
sector (same pre-existing limitation `cpe_signal` already has — no
`wireless_client_sessions` row means no AP id to join against).

Next migration number: **389**.
