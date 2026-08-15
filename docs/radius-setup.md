# FreeRADIUS Integration Guide

FireISP 5.0 uses the `radius` database table as the authentication and authorization source for FreeRADIUS. This guide explains how to connect FreeRADIUS to the FireISP database.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [FreeRADIUS SQL Module Configuration](#freeradius-sql-module-configuration)
4. [Query Configuration](#query-configuration)
5. [NAS / clients.conf](#nas--clientsconf)
6. [Testing](#testing)
7. [CoA / Disconnect Messages](#coa--disconnect-messages)

---

## Overview

FireISP manages RADIUS subscriber accounts in the `radius` table. Each row represents a PPPoE subscriber with:

| Column | Purpose |
|--------|---------|
| `username` | RADIUS username (User-Name attribute) |
| `password` | Plain or NT-Password for authentication |
| `ip_address` | Static IPv4 address (Framed-IP-Address reply) |
| `ipv6_address` | Static IPv6 address (Framed-IPv6-Address reply) |
| `ipv6_delegated_prefix` | Delegated prefix (Delegated-IPv6-Prefix reply) |
| `ipv4_pool_id` / `ipv6_pool_id` | Dynamic pool assignment (Framed-Pool reply) |
| `nas_id` | NAS the subscriber authenticates against |
| `download_speed` / `upload_speed` | Bandwidth limits (Mikrotik-Rate-Limit or standard attributes) |
| `status` | `active`, `suspended`, `disabled` — controls auth acceptance |

> **Automatic provisioning.** When a contract is created with a PPPoE connection
> type (`pppoe` or `pppoe_dual`), FireISP automatically generates a `username`
> and a recoverable cleartext `password`, inserts the matching `radius` row, and
> returns the credentials in the create response (`data.provisioning.pppoe`).
> The password is stored in cleartext — required for PAP/CHAP `Cleartext-Password`
> lookups — so it stays visible for future reference via `GET /api/radius`.
> Upgrading a contract from an IPv4-only type to a dual-stack type
> (`pppoe` → `pppoe_dual`, or `static` → `dual`) enables a new IPv6 line by
> attaching an active IPv6 pool to the subscriber's RADIUS account. Static IP
> addresses on contracts and IP assignments are validated against existing
> records to prevent duplicate use.

---

## Prerequisites

- FreeRADIUS 3.x installed (`apt install freeradius freeradius-mysql`)
- MySQL 8.4+ with the FireISP `radius` table populated
- Network connectivity between FreeRADIUS and the MySQL server

---

## FreeRADIUS SQL Module Configuration

### 1. Enable the SQL module

```bash
cd /etc/freeradius/3.0/mods-enabled/
ln -s ../mods-available/sql sql
```

### 2. Edit `/etc/freeradius/3.0/mods-available/sql`

```
sql {
    driver = "rlm_sql_mysql"
    dialect = "mysql"

    server   = "127.0.0.1"      # FireISP DB host
    port     = 3306
    login    = "radius_user"     # Dedicated read-only DB user recommended
    password = "radius_password"

    radius_db = "fireisp"        # FireISP database name

    # Connection pooling
    pool {
        start    = 5
        min      = 3
        max      = 20
        spare    = 3
        uses     = 0
        lifetime = 0
        idle_timeout = 60
    }

    # Use custom queries (see next section)
    read_clients = yes
    client_table = "nas"

    # Group queries are not used — FireISP handles groups via contracts/plans
    group_attribute = ""
}
```

### 3. Edit the `authorize` section in `/etc/freeradius/3.0/sites-enabled/default`

```
authorize {
    preprocess
    sql          # Add this line
    pap
}
```

### 4. Edit the `authenticate` section

```
authenticate {
    Auth-Type PAP {
        pap
    }
}
```

### 5. Send accounting through the tenant API

```
accounting {
    rest         # Sends Start / Interim-Update / Stop to FireISP
}
```

Configure the FreeRADIUS `rest` module to call
`POST /api/v1/radius/accounting/tenant` with an organization API token in the
`X-API-Key` header. The token must belong to the same organization as the NAS,
carry the dedicated `connection_logs:ingest` scope, and be owned by a role with
`connection_logs.ingest`. The token must contain exactly that single scope;
JWTs, wildcard/write scopes, additional scopes, and a combined
session/CGNAT-collector token are rejected. If privacy-minimal CGNAT attribution
is separately approved, its external binding normalizer uses a different token
whose only scope is `cgnat_attribution:ingest`; it is not part of FreeRADIUS.

This tenant-explicit path is recommended for every deployment and is required
when the organization uses an isolated database. A shared-primary deployment
currently requires active NAS addresses and RADIUS usernames to remain unique
installation-wide because the embedded/source-only listeners and stock
FreeRADIUS `radcheck`/`radreply` tables are not tenant-keyed. Physically isolated
tenant databases may reuse those values safely through their tenant-bound
token. The legacy shared-secret endpoint,
`POST /api/v1/radius/accounting`, remains available only when
`NAS-IP-Address` identifies exactly one active NAS across the installation.
See the complete [`rlm_rest` example](freeradius/README.md#radius-accounting-ingest-rlm_rest).

---

## Query Configuration

Create `/etc/freeradius/3.0/mods-config/sql/main/mysql/queries.conf` or modify the existing one:

### Authorization (lookup subscriber credentials)

```sql
authorize_check_query = " \
    SELECT r.username, 'Cleartext-Password' AS Attribute, \
           r.password AS Value, ':=' AS op \
    FROM radius r \
    LEFT JOIN contracts c ON c.id = r.contract_id \
    WHERE r.username = '%{SQL-User-Name}' \
      AND r.status = 'active' \
      AND (c.id IS NULL \
           OR c.status = 'active' \
           OR (c.status = 'pending' \
               AND c.test_window_cleanup_pending = 0 \
               AND c.test_window_expires_at > NOW())) \
    UNION ALL \
    SELECT r.username, 'Expiration' AS Attribute, \
           CONCAT(DAY(c.test_window_expires_at), ' ', \
                  ELT(MONTH(c.test_window_expires_at), 'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'), ' ', \
                  DATE_FORMAT(c.test_window_expires_at, '%Y %H:%i:%s')) AS Value, ':=' AS op \
    FROM radius r \
    JOIN contracts c ON c.id = r.contract_id \
    WHERE r.username = '%{SQL-User-Name}' \
      AND r.status = 'active' \
      AND c.status = 'pending' \
      AND c.test_window_cleanup_pending = 0 \
      AND c.test_window_expires_at > NOW()"

authorize_reply_query = " \
    SELECT \
        CASE WHEN ip_address IS NOT NULL \
             THEN 'Framed-IP-Address' END AS name, \
        ip_address AS value, \
        '=' AS op \
    FROM radius \
    WHERE username = '%{SQL-User-Name}' AND ip_address IS NOT NULL \
    UNION ALL \
    SELECT 'Framed-IP-Netmask', '255.255.255.255', '=' \
    FROM radius \
    WHERE username = '%{SQL-User-Name}' AND ip_address IS NOT NULL \
    UNION ALL \
    SELECT 'Mikrotik-Rate-Limit', \
           CONCAT(upload_speed, 'k/', download_speed, 'k'), '=' \
    FROM radius \
    WHERE username = '%{SQL-User-Name}' \
      AND download_speed IS NOT NULL \
      AND upload_speed IS NOT NULL \
    UNION ALL \
    SELECT 'Session-Timeout', \
           CAST(GREATEST(TIMESTAMPDIFF(SECOND, NOW(), c.test_window_expires_at), 1) AS CHAR), ':=' \
    FROM radius r \
    JOIN contracts c ON c.id = r.contract_id \
    WHERE r.username = '%{SQL-User-Name}' \
      AND r.status = 'active' \
      AND c.status = 'pending' \
      AND c.test_window_cleanup_pending = 0 \
      AND c.test_window_expires_at > NOW()"
```

> **Note:** For non-MikroTik NAS devices, replace `Mikrotik-Rate-Limit` with the appropriate vendor-specific attribute (e.g., `WISPr-Bandwidth-Max-Down` / `WISPr-Bandwidth-Max-Up`).

### Accounting (do not write `connection_logs` directly)

The older version of this guide installed three direct SQL `INSERT` queries.
Do not use those queries for a new installation. They cannot safely choose a
tenant across isolated databases that reuse private NAS addresses, represent one session as
several unrelated rows, and bypass the application's replay handling and
separate lifecycle-milestone evidence (Start, first Interim transition, and
Stop). Routine Interim heartbeats update the current-session projection and
receipt time without creating an evidence row for every heartbeat. Direct SQL
also does not populate `radius_accounting_usage_daily`, so it cannot support the
new operational usage-delta reports or their completeness/anomaly checks.

Use the tenant API described above. FireISP resolves the serving NAS inside the
token's organization, records one mutable session projection plus separate
selected Start/first-Interim/Stop evidence, combines Gigawords counters, updates
the UTC usage-delta rollup, and handles retransmitted packets idempotently.
The subscriber response includes `session_instance_id`, the canonical UUID for
that tenant access-session lifecycle. Any approved CGNAT normalizer must capture
that returned UUID and include it unchanged on every allocate/release record;
username, NAS, `Acct-Session-Id`, and private IP are not substitutes.
Existing direct-SQL writers remain a rollout compatibility path only; migrate
them to `rlm_rest` before relying on the Connections page, usage reports, or
exports. The normalized milestone evidence is not every raw RADIUS packet,
tamper-proof storage, or an automatically complete statutory vault.

### NAS Client Lookup

```sql
client_query = " \
    SELECT id, name AS shortname, ip_address AS nasname, \
           secret, 'other' AS type \
    FROM nas \
    WHERE status = 'active'"
```

---

## NAS / clients.conf

If you prefer static NAS definitions instead of SQL `read_clients`:

```
# /etc/freeradius/3.0/clients.conf
client mikrotik-main {
    ipaddr    = 10.0.0.1
    secret    = your-radius-secret
    shortname = MK-Main
}
```

---

## Testing

### Test authentication

```bash
# Install radtest (included with freeradius-utils)
radtest testuser testpassword 127.0.0.1 0 testing123
```

### Check FreeRADIUS logs

```bash
# Run in debug mode
freeradius -X

# Check for SQL errors
grep -i "sql" /var/log/freeradius/radius.log
```

### Verify session, evidence, and usage population

```sql
SELECT organization_id, session_instance_id, username, acct_session_id,
       event_type, event_at, last_accounting_at, last_accounting_received_at,
       bytes_in, bytes_out, usage_accounting_complete, usage_anomaly_count
FROM connection_logs
WHERE organization_id = YOUR_ORG_ID
ORDER BY last_accounting_received_at DESC
LIMIT 10;

SELECT organization_id, session_instance_id, status_type, event_at,
       observed_at, dedupe_key, integrity_hash
FROM radius_accounting_events
WHERE organization_id = YOUR_ORG_ID
ORDER BY observed_at DESC
LIMIT 10;

SELECT organization_id, usage_date, session_instance_id,
       bytes_in_delta, bytes_out_delta, is_complete,
       anomaly_count, anomaly_reason
FROM radius_accounting_usage_daily
WHERE organization_id = YOUR_ORG_ID
ORDER BY usage_date DESC
LIMIT 10;
```

One supported Start/Interim/Stop lifecycle should leave one projection, three
milestone rows, and monotonic usage deltas. Routine Interim heartbeats should
not create additional evidence milestones; replays must not double-count usage.
Review any incomplete/anomalous usage row instead of treating it as exact.

---

## CoA / Disconnect Messages

FireISP sends RADIUS Change-of-Authorization (CoA) and Disconnect messages via UDP when suspending or restoring a client's service. This is handled in `src/services/suspensionService.js`.

### How it works

1. The suspension service sends a **Disconnect-Request** when a contract is suspended
2. The NAS terminates the PPPoE session
3. On reconnection attempt, the subscriber's `status = 'suspended'` causes FreeRADIUS to reject authentication
4. When service is restored, the status is set back to `active`

### NAS targeting (roaming-aware)

Authentication is NAS-agnostic — any NAS registered in the `nas` table can
authenticate any RADIUS account, so a subscriber may be online through a
different router than the "home" NAS stored in `radius.nas_id`. CoA and
Disconnect packets are therefore sent to **every NAS with an open session for
the subscriber** (resolved from `connection_logs`), plus the home NAS as a
safety net for deployments where accounting is disabled or lagging. A
Disconnect/CoA for a username with no session on that NAS is answered with a
harmless NAK. Per-session operations (duplicate-session kick, batch
force-disconnect) additionally include an `Acct-Session-Id` attribute so only
the targeted session is terminated.

### Environment variables

```env
RADIUS_SECRET=your-shared-secret
RADIUS_HOST=127.0.0.1
RADIUS_COA_PORT=3799
```

### MikroTik CoA Configuration

On MikroTik RouterOS, ensure the RADIUS incoming feature is enabled:

```
/radius incoming
set accept=yes port=3799
```

---

## Security Recommendations

1. **Create a dedicated MySQL user** for FreeRADIUS with minimal permissions.
   It needs read access for authentication, but no direct write access to
   `connection_logs` when accounting uses the recommended tenant API:
   ```sql
   CREATE USER 'radius_user'@'%' IDENTIFIED BY 'strong_password';
   GRANT SELECT ON fireisp.radius TO 'radius_user'@'%';
   GRANT SELECT ON fireisp.nas TO 'radius_user'@'%';
   FLUSH PRIVILEGES;
   ```

2. **Use TLS** for the MySQL connection between FreeRADIUS and the database

3. **Firewall** the RADIUS ports (1812/UDP auth, 1813/UDP acct, 3799/UDP CoA)

4. **Rotate** the RADIUS shared secret regularly
