# FreeRADIUS Integration Guide

FireISP is the **management plane** for an external FreeRADIUS 3.x server.
FireISP stores subscriber credentials and plan attributes in its own MySQL database
and synchronizes them into the standard FreeRADIUS SQL tables
(`radcheck`, `radreply`, `radusergroup`, `radgroupcheck`, `radgroupreply`).
FreeRADIUS reads these tables directly — no custom RADIUS proxy is required.

## Architecture overview

```
                  ┌──────────────────────────┐
  NAS / CPE ─────►  FreeRADIUS (external)    │
  (PPPoE / MAB /  │   ┌──────────────────┐   │
   802.1X / EAP)  │   │  rlm_sql module  │   │
                  │   └────────┬─────────┘   │
                  └────────────┼─────────────┘
                               │  reads
                  ┌────────────▼─────────────┐
                  │  FireISP MySQL database   │
                  │  radcheck / radreply      │
                  │  radusergroup             │
                  │  radgroupcheck            │
                  │  radgroupreply            │
                  └───────────────────────────┘
                               ▲  synced by
                  ┌────────────┴─────────────┐
                  │  FireISP management plane │
                  │  (radius_sync task)       │
                  └───────────────────────────┘
```

The `radius_sync` scheduled task (default: every 5 minutes) calls
`syncFreeradiusTables()` in `radiusService.js`, which:

1. Reads all active `radius` table rows plus their linked contract / plan.
2. Deletes and rewrites `radcheck` + `radusergroup` rows per subscriber.
3. Rebuilds `radgroupreply` rows per plan using `radiusAttributeService.generateAttributes()`.

You can also trigger an immediate sync via the API:
```
POST /api/v1/radius/sync-freeradius
Authorization: Bearer <token>
X-Org-Id: <org_id>
```

---

## Step 1: Install FreeRADIUS 3.x

```bash
# Debian / Ubuntu
sudo apt install freeradius freeradius-mysql

# RHEL / AlmaLinux
sudo dnf install freeradius freeradius-mysql
```

---

## Step 2: Configure the SQL module

Copy the template from this directory:

```bash
cp docs/freeradius/sql.conf /etc/freeradius/3.0/mods-available/sql
ln -s /etc/freeradius/3.0/mods-available/sql /etc/freeradius/3.0/mods-enabled/sql
```

Edit `/etc/freeradius/3.0/mods-available/sql` and fill in your FireISP database credentials
(the variables shown with `YOUR_*` placeholders).

The key settings are:

| Setting | Value |
|---------|-------|
| `dialect` | `mysql` |
| `server` | FireISP DB host |
| `port` | 3306 |
| `login` | DB user (`SELECT` for auth; writes on `radacct`/`radpostauth` when those feeds are enabled) |
| `password` | DB password |
| `radius_db` | FireISP database name |

---

## Step 3: Enable SQL in authorize and post-auth sections

Edit `/etc/freeradius/3.0/sites-available/default` and ensure `sql` appears in the
`authorize {}` and `post-auth {}` sections. The `accounting {}` SQL call is
optional and requires the `radacct` table described in the bundled `sql.conf`;
FireISP's Diagnostics feed itself is populated by the REST accounting module
configured later in this guide.

```
authorize {
    preprocess
    chap
    mschap
    digest
    suffix
    eap {
        ok = return
    }
    sql          # <-- add this
    expiration
    logintime
    pap
}

accounting {
    detail
    unix
    sql          # optional: only when a radacct table is installed
    exec
    attr_filter.accounting_response
}

post-auth {
    sql          # Access-Accept diagnostics

    Post-Auth-Type REJECT {
        sql      # change the stock "-sql" entry to "sql"
        attr_filter.access_reject
        eap
        remove_reply_message_if_eap
    }
}
```

Calling `sql` in `authorize` does **not** write authentication outcomes. The
top-level `post-auth` call records successful authentication. FreeRADIUS 3.x
routes rejected requests through the nested `Post-Auth-Type REJECT` block, so
its stock fail-soft `-sql` entry must also be enabled as `sql`; otherwise the
Auth Failures tab can show accepts while silently missing rejects. Apply both
entries to `sites-available/inner-tunnel` as well when PEAP/TTLS inner
authentication is in use.

### Tenant-attributing post-auth query (required)

FireISP intentionally ignores legacy `radpostauth` rows whose tenant is NULL.
Replace the stock MySQL post-auth query in
`/etc/freeradius/3.0/mods-config/sql/main/mysql/queries.conf` with this
`INSERT ... SELECT` form so the live NAS row supplies both `organization_id`
and `nas_id`:

First set `auto_escape = yes` inside the `sql {}` block in
`/etc/freeradius/3.0/mods-available/sql` (the bundled `sql.conf` already does
this). This makes the MySQL driver escape network-derived values used by the
query below.

```apacheconf
post-auth {
    query = "\
        INSERT INTO ${..postauth_table} \
          (username, pass, reply, authdate, nas_ip_address, \
           calling_station_id, organization_id, nas_id, reason_code) \
        SELECT \
          '%{SQL-User-Name}', \
          '', \
          '%{reply:Packet-Type}', \
          NOW(), \
          n.ip_address, \
          '%{Calling-Station-Id}', \
          n.organization_id, \
          n.id, \
          NULL \
        FROM nas n \
        WHERE n.ip_address = '%{%{NAS-IP-Address}:-%{Packet-Src-IP-Address}}' \
          AND n.status = 'active' \
          AND n.deleted_at IS NULL \
          AND (SELECT COUNT(*) \
                 FROM nas n2 \
                WHERE n2.ip_address = n.ip_address \
                  AND n2.status = 'active' \
                  AND n2.deleted_at IS NULL) = 1"
}
```

This follows the SQL module's normal escaped expansions: use
`%{SQL-User-Name}` (not a raw `User-Name` substitution), and keep the NAS
address sourced from the typed `NAS-IP-Address` / `Packet-Src-IP-Address`
attributes. Do not build this query in an `exec` script or concatenate raw
request text. The password is deliberately stored as an empty string; FireISP
does not need or retain the attempted credential.

If no single live NAS matches the request address, the `SELECT` produces zero
rows. That fail-closed behavior is intentional: the event cannot be assigned to
a tenant safely, and the readiness banner remains waiting/not configured until
correct NAS addressing is in place. Ensure every NAS reaches FreeRADIUS from its
registered routable or WireGuard address.

### Organizations with isolated tenant databases

For an organization configured with database isolation, point that tenant's
FreeRADIUS SQL module (or a tenant-specific virtual server/module instance) at
the isolated database—not the FireISP primary database. This is required for
both authorization tables and tenant-owned `radpostauth` diagnostics rows.
The global `scan_auth_failures` task scans shared tenants in the primary
database and then fans out through every active isolated tenant context. Its
primary pass excludes historical rows belonging to isolated organizations, so
the same rejection cannot raise an alert from both database copies.

Use tenant-local external FreeRADIUS for authentication, then send accounting
to `POST /api/v1/radius/accounting/tenant` with an API token bound to that same
organization. FireISP routes the write into its isolated database context.
Before enabling isolation, apply the complete schema and copy the organization's
tenant-owned data; an empty schema is not a usable cutover. See
[Per-tenant database isolation](../tenant-database-isolation.md).

The embedded UDP listener and compatibility shared-secret HTTP endpoint scan
the shared primary plus active isolated database contexts and accept a NAS
address only when it has exactly one active match across the installation. This
fails closed safely, but reused RFC1918 NAS addresses make those paths
unavailable. Prefer the tenant-token endpoint; use a distinct public or
WireGuard source address if the embedded listener is required.

---

## Step 4: Configure NAS clients

NAS secrets are stored in the FireISP `nas` table. Generate `clients.conf` from that table:

```sql
SELECT CONCAT(
  'client ', ip_address, ' {\n',
  '  secret = ', secret, '\n',
  '  shortname = ', name, '\n',
  '}\n'
)
FROM nas
WHERE organization_id = YOUR_ORG_ID;
```

Paste the output into `/etc/freeradius/3.0/clients.conf`, or use a periodic export script.

See `docs/freeradius/clients.conf` for a commented snippet.

---

## Step 5: Test and start FreeRADIUS

```bash
# Test configuration (runs in foreground with debug output)
sudo freeradius -X

# Start service
sudo systemctl enable --now freeradius
```

Verify authentication works with `radtest`:
```bash
radtest subscriber_username cleartext_password 127.0.0.1 0 testing123
```

---

## Authentication methods

### PPPoE (default)

- `radius.auth_method = 'pppoe'`
- `radcheck` row: `Cleartext-Password := <password>` — enables PAP, CHAP, and MS-CHAPv2.
- FreeRADIUS default `pap` / `mschap` / `chap` modules handle all three.

### MAB (MAC Address Bypass)

- `radius.auth_method = 'mac'`
- Username = normalized MAC address (lowercase, no separators: `aabbccddeeff`).
- Credential behaviour controlled by org setting `mab_password_mode`:
  - `auth_type_accept` (default): `Auth-Type := Accept` — FreeRADIUS accepts without password check.
  - `cleartext`: `Cleartext-Password := <normalized MAC>` — MAC is both username and password.
- `mac_address` column must be populated on the `radius` row.

### 802.1X / dot1x

- `radius.auth_method = 'dot1x'`
- Same credential rows as PPPoE (`Cleartext-Password := <password>`).
- EAP terminates at FreeRADIUS using PEAP/MSCHAPv2 or TTLS/PAP.
- Enable the `eap` module in `mods-enabled/eap` with the desired inner method.

### EAP-TLS

- `radius.auth_method = 'eap_tls'`
- `radcheck` rows:
  - `Cleartext-Password := <password>` (fallback / inner-auth, optional)
  - `TLS-Cert-Serial == <serial_number>` — enforces certificate binding
- Client certificates are registered in the `subscriber_certificates` table (FireISP is a
  **metadata registry only** — it does NOT generate or sign certificates).
  Use an external CA (easy-rsa, step-ca, HashiCorp Vault PKI, or a commercial CA)
  to issue and revoke certificates.
- Configure the `eap` module in `mods-available/eap` with `tls { ... }` pointing to
  your CA certificate and server key/cert. See `docs/freeradius/sql.conf` for references.

---

## Subscriber certificates and expiry monitoring

The `check_certificate_expiry` scheduled task (daily at 06:00) flags certificates
expiring within 30 days via `radiusService.checkCertificateExpiry()`.
Integrate with your notification hooks to alert administrators.

---

## Vendor-specific speed attributes

Plan speed attributes are written to `radgroupreply` by `radiusAttributeService.generateAttributes()`:

| `plans.radius_vendor` | Attributes written |
|---|---|
| `null` (generic) | `WISPr-Bandwidth-Max-Down`, `WISPr-Bandwidth-Max-Up` |
| `mikrotik` | `Mikrotik-Rate-Limit` |
| `cisco` | `Cisco-AVPair` (sub-qos-policy-in, sub-qos-policy-out) |
| `juniper` | `ERX-Qos-Profile-Name`, `ERX-Input-Gigapkts` |

Set `plans.radius_vendor` in the plan editor to match your NAS vendor.

---

## Session and idle timeouts

Set `plans.session_timeout_seconds` and/or `plans.idle_timeout_seconds` in the plan editor.
When set, `syncFreeradiusTables()` writes the corresponding `radgroupreply` rows:

```
plan_7  Session-Timeout := 86400   # 24-hour max session
plan_7  Idle-Timeout    := 1800    # disconnect after 30 min idle
```

FreeRADIUS enforces these via its `expiration` and `logintime` modules already enabled in Step 3.

---

## Simultaneous session limits

Set `plans.simultaneous_use` (default 1) for a plan-wide limit.
Override per account with `radius.simultaneous_use`.

The sync writes a `radcheck` row:
```
username  Simultaneous-Use := 2
```

FreeRADIUS enforces this via the `radutmp` or `sql-session-log` module. Enable `radutmp` in the
`authorize {}` and `session {}` sections of your `sites-available/default`.

The `kick_duplicate_sessions` scheduled task (every 5 minutes) also enforces limits at the
FireISP layer by sending Disconnect-Request for the oldest excess sessions.

---

## Time-based access restriction (Login-Time)

Create `plan_access_windows` entries for a plan. The sync builds a `radgroupcheck` row:

```
plan_7  Login-Time := Wk0800-1800,Sa0900-1300
```

Day codes: `Su Mo Tu We Th Fr Sa`, shorthand `Wk` (Mon-Fri), `Al` (all days).
FreeRADIUS enforces this via the `logintime` module — already included in Step 3's `authorize {}`.

---

## VLAN assignment via RADIUS

Set `radius.vlan_id` (and optionally `radius.inner_vlan_id` for QinQ) on the subscriber account.
The sync writes per-user `radreply` rows:

```
username  Tunnel-Type           := VLAN
username  Tunnel-Medium-Type    := IEEE-802
username  Tunnel-Private-Group-Id := 100       # outer VLAN

# QinQ: inner tag uses FreeRADIUS tag notation
username  Tunnel-Private-Group-Id:1 := 200     # inner VLAN
```

On MikroTik RouterOS the NAS must be configured to apply VLAN tags based on these AVPs.
On Cisco IOS-XE use `tunnel-type` / `tunnel-medium-type` / `tunnel-private-group-id` under the
subscriber interface template.

---

## Walled garden for unpaid subscribers

FireISP supports placing unpaid subscribers into a walled garden (captive portal) as an alternative
to full suspension.

### How it works

1. A `suspension_rules` row with `action = 'walled_garden'` triggers `walledGardenSuspendContract()`.
2. The function sends a RADIUS CoA with `Mikrotik-Address-List := <address_list_name>` to the NAS.
3. A `suspension_logs` row is written (`action = 'walled_garden'`).
4. `syncFreeradiusTables()` is immediately triggered so that any NAS-initiated re-auth also gets
   the address-list attribute.
5. When the subscriber pays, `walledGardenReconnect()` clears the `suspension_logs.restored_at`,
   sends a CoA to remove the restriction, and re-syncs.

Configure the walled garden in **Settings → Walled Garden** (requires `walled_garden.update` permission):

| Field | Purpose |
|-------|---------|
| **Enable** | Toggle walled garden enforcement for this org |
| **Redirect URL** | Captive portal / payment page URL for NAS redirect rules |
| **Address List Name** | MikroTik address-list name (default: `walled_garden`) |
| **Allowed Destinations** | Hosts/CIDRs reachable from the walled garden (reference only — configure on NAS) |

### NAS-side configuration

**MikroTik** — add a firewall rule to redirect walled garden clients:

```routeros
/ip firewall mangle
add chain=prerouting src-address-list=walled_garden action=mark-connection \
    new-connection-mark=walled passthrough=yes

/ip firewall nat
add chain=dstnat connection-mark=walled action=redirect to-ports=80 \
    comment="Walled garden HTTP redirect"
```

Replace with your captive portal IP / redirect URL as appropriate.

**Cisco** — use url-redirect VSA (Cisco-AVPair) approach instead of Mikrotik-Address-List:

```
Cisco-AVPair = "url-redirect=https://portal.isp.example.com/pay"
Cisco-AVPair = "url-redirect-acl=WALLED_GARDEN_ACL"
```

Modify `walledGardenSuspendContract()` in `radiusService.js` if Cisco url-redirect AVPairs are
preferred over the MikroTik address-list approach.

---

## PPPoE RouterOS event diagnostics

The **Network → PPPoE Diagnostics → Event Log** source is collected
automatically. The seeded `poll_pppoe_events` task normally runs every five
minutes and polls each active `type=mikrotik` NAS that has RouterOS API
credentials. It issues the read-only `/log/print` command, asks RouterOS for
only `.id,time,topics,message`, and parses recognized PADI/PADS/LCP/IPCP/AUTH/
PADT messages locally.

Polling is deliberately conservative:

- An install-scoped MySQL advisory mutex covers cron, queue-worker, and manual
  triggers. If a previous fleet sweep is still running, the next trigger is
  skipped; a crashed worker releases the mutex with its database connection.
- NAS devices are contacted sequentially, so a scheduler tick does not open a
  burst of API connections across the fleet.
- Only the newest `PPPOE_EVENT_POLL_LIMIT` returned log records per NAS are
  considered (default 500; clamped to 50–1,000).
- Every event is fingerprinted from NAS id + RouterOS log id/time/topics/message
  with SHA-256. `INSERT IGNORE` makes repeated polls idempotent.
- One unreachable/misconfigured NAS is reported in the task summary and does
  not stop other NAS devices from being collected. Every opened API connection
  is closed after its poll.
- A NAS in **maintenance mode** remains active for RADIUS and manual management,
  but is excluded from automatic PPPoE event polling and readiness coverage.
  Toggle maintenance mode from the NAS edit form; the readiness banner reports
  maintained devices separately from the eligible polling total.
- A NATed NAS is polled only when its non-deleted WireGuard tunnel is in an
  active/manual state and the server-side peer has been synced.

Give the RouterOS API user read access only; this collector never changes router
configuration. Prefer API-SSL or a WireGuard management path.

### Optional raw/structured event ingest

A syslog connector can also send events to:

```text
POST /api/v1/pppoe/events
X-Pppoe-Secret: <PPPOE_EVENTS_SECRET>
Content-Type: application/json
```

Use a dedicated `PPPOE_EVENTS_SECRET`; when absent, FireISP falls back to
`RADIUS_ACCOUNTING_SECRET`. The endpoint fails closed when neither is set.

Raw-line payload (FireISP parses stage/severity/reason and derives username/MAC
when present):

```json
{
  "nas_id": 12,
  "line": "<alice@example.net>: LCP negotiation failed",
  "logged_at": "2026-08-14T12:34:56Z"
}
```

Structured payload:

```json
{
  "nas_id": 12,
  "message": "subscriber peer stopped responding",
  "stage": "PADT",
  "severity": "warning",
  "reason_code": "peer_timeout",
  "username": "alice@example.net",
  "mac": "AA:BB:CC:DD:EE:FF"
}
```

`nas_id` is required. The server loads that NAS and stamps its
`organization_id`; callers cannot supply tenant ownership. Payload shapes are
strict, timestamps/enums/MACs are validated, and an omitted timestamp uses the
database's `CURRENT_TIMESTAMP` default.

`GET /api/v1/pppoe/diagnostics/readiness` drives the readiness banner. It reports
tenant-safe last-received/count data for authentication, RouterOS events, and
accounting, plus configured RouterOS NAS coverage. An empty diagnostic list is
trustworthy only when its source is `ready`; `waiting`/`not_configured` means
the feed may be incomplete. The global RouterOS collector fans out through
isolated tenant database contexts, as does the scheduled authentication-failure
alert scan. The optional shared-secret `/pppoe/events` endpoint still resolves
NAS IDs only in the primary database and is not an isolated-tenant ingest path;
RADIUS accounting instead has the organization-token endpoint described below.

---

## RADIUS Accounting ingest (rlm_rest)

The recommended machine-to-machine endpoint is organization-bound before any
NAS or subscriber lookup:

```http
POST /api/v1/radius/accounting/tenant
X-API-Key: <organization API token>
```

Create a dedicated token owned by an active principal in the same organization
as the NAS. Its one and only API scope must be `connection_logs:ingest`, and the
owner must have the `connection_logs.ingest` RBAC permission. A JWT, wildcard or
write scope, additional scope, and a token shared with the CGNAT binding
collector are rejected.

For a subscriber Start/Interim/Stop lifecycle, the JSON response includes
`session_instance_id`, FireISP's canonical UUID for that exact tenant access
session. A CGNAT normalizer must capture and preserve this returned value: every
allocate and release record requires it. Do not reconstruct the UUID or guess a
session from username, `Acct-Session-Id`, NAS address, or a reused private IP.

The tenant endpoint resolves `NAS-IP-Address` only inside the token's
organization. Session IDs and subscriber-assigned private addresses may be
reused safely between shared-primary organizations. Active NAS addresses and
RADIUS usernames must remain installation-wide unique inside one shared
database because source-only listeners and the stock FreeRADIUS compatibility
tables are not tenant-keyed. Those values may be reused across physically
isolated tenant databases, where this token fixes the database context.

### Compatibility shared-secret endpoint

`POST /api/v1/radius/accounting` remains available for staged upgrades. It uses
`X-Radius-Secret` or `Authorization: Bearer` with
`RADIUS_ACCOUNTING_SECRET`, and is disabled with HTTP 503 when that setting is
unset. The caller cannot name an organization: FireISP scans shared and active
isolated database contexts and accepts the request only when
`NAS-IP-Address` identifies exactly one active NAS installation-wide. Unknown
or ambiguous addresses fail closed. Do not use this path where private NAS
addresses may be reused.

### FreeRADIUS rlm_rest configuration

Install `rlm_rest` (bundled in FreeRADIUS ≥ 3.0). Create or edit
`/etc/freeradius/3.0/mods-available/rest`:

```apacheconf
rest {
    connect_uri = "https://isp.example.com"

    accounting {
        uri = "${..connect_uri}/api/v1/radius/accounting/tenant"
        method = 'post'
        body = 'json'
        # FireISP returns an acknowledgement object, not RADIUS attributes.
        force_to = 'plain'
        do_xlat = no
        tls = ${..tls}

        header {
            X-API-Key = "<dedicated organization API token>"
        }
    }

    connect_timeout = 2.0
    timeout = 5.0
}
```

Enable the module:

```bash
cd /etc/freeradius/3.0/mods-enabled
ln -s ../mods-available/rest rest
```

In `/etc/freeradius/3.0/sites-available/default`, add `rest` to the accounting
section. `sql` is optional and needs a separate `radacct` table; it is not a
replacement for the FireISP REST projection/evidence path.

```apacheconf
accounting {
    detail
    unix
    sql     # optional: requires radacct
    rest
    -ldap
    exec
    attr_filter.accounting_response
}
```

### JSON payload and stored datasets

With `body = 'json'`, FreeRADIUS 3's `rlm_rest` module sends each standard
hyphenated attribute in an envelope such as
`"User-Name":{"type":"string","value":["alice"]}`. FireISP consumes that
native format directly. It also accepts flat hyphenated
(`"Acct-Status-Type":"Start"`) and camelCase (`"acctStatusType":"Start"`)
forms for custom shippers.

| Status-Type | Required attributes |
|-------------|---------------------|
| Start / Stop / Interim-Update | `User-Name`, `NAS-IP-Address`, `Acct-Session-Id` |
| Accounting-On / Accounting-Off | Status only; acknowledged as a no-op |

Gigawords wraparound is handled automatically:
`total_bytes = Acct-Input-Octets + Acct-Input-Gigawords × 4294967296`.

Supported application ingest maintains one mutable `connection_logs` row per
session lifecycle. It separately records selected normalized milestones in
`radius_accounting_events` (Start, first Interim transition, Stop, and a later
corrected final Stop when applicable) and monotonic counter deltas in
`radius_accounting_usage_daily`. Routine Interim heartbeats are not preserved
as evidence rows. The milestone table is neither a raw-packet archive nor
tamper-proof/automatically complete statutory storage.

The UTC usage rollup flags non-zero baselines, counter resets/late fields, and
cross-midnight estimates. Inspect its completeness/anomaly fields before using
it for billing or FUP. Direct SQL writes to `connection_logs` do not populate
the rollup and are not a supported usage source.

### MAC move detection

When a `Start` record arrives for a username that already has an open session on
a different `Calling-Station-Id` or NAS, FireISP closes the old projection,
records `mac_move_events`, and continues the new lifecycle. View the event under
**RADIUS → MAC Move Events** or `GET /api/v1/radius/mac-move-events`.

### CDR export and retention

`GET /api/v1/radius/cdr` accepts ISO-8601 `from`, `to`, optional `username`, and
`format=json|csv`. It requires authenticated export permissions and records the
access. Use bounded periods; oversized exports fail explicitly.

`RADIUS_ACCOUNTING_RETENTION_MONTHS` defaults to 24 calendar months for session
projections, lifecycle evidence, and the UTC usage rollup. The
`purge_radius_accounting` task deletes expired records in batches of 1,000
across the primary and active isolated database contexts.

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `RADIUS_ACCOUNTING_SECRET` | _(unset)_ | Enables only the compatibility shared-secret endpoint |
| `RADIUS_ACCOUNTING_RETENTION_MONTHS` | `24` | Calendar months for projections, lifecycle evidence, and usage rollups |
| `RADIUS_ACCOUNTING_REQUESTS_PER_MINUTE` | `6000` | Tenant-endpoint requests per token/minute; clamped to 1–60,000 |
| `RADIUS_ACCOUNTING_MAX_CLOCK_SKEW_SECONDS` | `300` | Accepted future Event-Timestamp skew; capped at 3,600 seconds |
| `PPPOE_EVENTS_SECRET` | falls back to `RADIUS_ACCOUNTING_SECRET` | Shared secret for optional PPPoE event ingest |
| `PPPOE_EVENT_POLL_LIMIT` | `500` | Newest RouterOS log records considered per NAS poll (clamped 50–1,000) |
| `RETENTION_RADPOSTAUTH_DAYS` | `90` | Days to retain post-authentication diagnostics (`radpostauth.authdate`) |
| `RETENTION_PPPOE_EVENT_LOGS_DAYS` | `90` | Days to retain RouterOS/ingested PPPoE events (`pppoe_event_logs.logged_at`) |

Collector endpoints are rate-limited before parsing and accept JSON bodies up
to 2 MiB; ordinary API routes retain the general 10 MiB ceiling. Request-rate
settings are safety ceilings, not capacity promises; load-test the actual
Interim interval and database latency. Privacy-minimal CGNAT binding ingest is a
separate pipeline with its own exact `cgnat_attribution:ingest` token and
operator-controlled external normalizer. It contains source translation,
port/protocol/time and correlation evidence only—no destination or content
fields—and is not part of FreeRADIUS accounting. RADIUS supplies the access
session to which an accepted binding may be correlated; it cannot infer the NAT
translation itself.

---

## Per-session route injection (Framed-Route)

Add entries in the **RADIUS Account → Routes** editor (requires `radius_account_routes.create`).
Each route generates one `radreply` row:

```
username  Framed-Route += 192.168.10.0/24 10.0.0.1 1
username  Framed-Route += 10.20.0.0/16
```

Format: `<destination> [<gateway>] [<metric>]` (RFC 2865 §5.22).
FreeRADIUS returns all `Framed-Route +=` rows to the NAS; the NAS installs them as static routes
for the subscriber's session.
