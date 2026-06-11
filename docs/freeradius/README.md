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
