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
| `login` | DB user (read-only is sufficient for auth) |
| `password` | DB password |
| `radius_db` | FireISP database name |

---

## Step 3: Enable SQL in authorize and accounting sections

Edit `/etc/freeradius/3.0/sites-available/default` and ensure `sql` appears in the
`authorize {}` and `accounting {}` sections:

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
    sql          # <-- add this
    exec
    attr_filter.accounting_response
}
```

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

## RADIUS Accounting ingest (rlm_rest)

FireISP exposes a machine-to-machine endpoint that FreeRADIUS can POST accounting records to:

```
POST /api/v1/radius/accounting
```

The endpoint requires no JWT token. Authentication uses a shared secret sent in either:

- `X-Radius-Secret: <secret>` header, or
- `Authorization: Bearer <secret>` header

Set the shared secret in `RADIUS_ACCOUNTING_SECRET` (backend env var). Leave it unset to disable
authentication checks (not recommended in production).

### FreeRADIUS rlm_rest configuration

Install `rlm_rest` (bundled in FreeRADIUS ≥ 3.0). Create or edit
`/etc/freeradius/3.0/mods-available/rest`:

```apacheconf
rest {
    # Base URL of your FireISP backend
    connect_uri = "https://isp.example.com"

    accounting {
        uri = "${..connect_uri}/api/v1/radius/accounting"
        method = 'post'
        body = 'json'
        tls = ${..tls}

        header {
            X-Radius-Secret = "<RADIUS_ACCOUNTING_SECRET value>"
        }
    }

    # 2-second connect / 5-second request timeouts
    connect_timeout = 2.0
    timeout = 5.0
}
```

Enable the module:

```bash
cd /etc/freeradius/3.0/mods-enabled
ln -s ../mods-available/rest rest
```

### Accounting section

In `/etc/freeradius/3.0/sites-available/default`, add `rest` to the accounting section
(after `sql` so SQL always runs even if the REST call fails):

```apacheconf
accounting {
    detail
    unix
    sql
    rest
    -ldap
    exec
    attr_filter.accounting_response
}
```

### JSON payload format

FreeRADIUS sends attributes using their standard hyphenated names. FireISP accepts both
hyphenated (`Acct-Status-Type`) and camelCase (`AcctStatusType`) forms. The minimum required
fields for each status type are:

| Status-Type | Required attributes |
|-------------|---------------------|
| Start | `User-Name`, `NAS-IP-Address`, `Acct-Session-Id` |
| Stop | `User-Name`, `NAS-IP-Address`, `Acct-Session-Id`, `Acct-Terminate-Cause` |
| Interim-Update | `User-Name`, `NAS-IP-Address`, `Acct-Session-Id` |
| Accounting-On / Accounting-Off | (no-op — silently ignored) |

Gigawords wraparound is handled automatically:
`total_bytes = Acct-Input-Octets + Acct-Input-Gigawords × 4294967296`

### MAC move detection

When a `Start` record arrives for a username that already has an open session on a
different `Calling-Station-Id` (MAC address) or NAS, FireISP:

1. Synthesizes a `Stop` record for the old session.
2. Logs the event to the `mac_move_events` table.
3. Returns HTTP 200 and continues creating the new `Start` record.

View events in the UI under **RADIUS → MAC Move Events** or via `GET /api/v1/radius/mac-move-events`.

### CDR export

Export call-detail records with `GET /api/v1/radius/cdr`:

| Query parameter | Description |
|-----------------|-------------|
| `from` | ISO-8601 start datetime (inclusive) |
| `to` | ISO-8601 end datetime (inclusive) |
| `username` | Filter to a single subscriber |
| `format` | `json` (default) or `csv` |

CSV responses are RFC 4180-compliant with a `Content-Disposition: attachment` header.

Retention is controlled by the `RADIUS_ACCOUNTING_RETENTION_MONTHS` env var (default: 12).
The `purge_radius_accounting` scheduled task runs nightly at 03:00 and deletes records older
than the retention window in batches of 1 000 rows to avoid long table-lock events.

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `RADIUS_ACCOUNTING_SECRET` | _(unset — auth disabled)_ | Shared secret for accounting ingest |
| `RADIUS_ACCOUNTING_ORG_ID` | `0` | Organization ID to tag ingested records with |
| `RADIUS_ACCOUNTING_RETENTION_MONTHS` | `12` | Months of accounting data to retain |

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
