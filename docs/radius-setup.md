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

### 5. Edit the `accounting` section (for connection_logs)

```
accounting {
    sql          # Logs sessions to connection_logs
}
```

---

## Query Configuration

Create `/etc/freeradius/3.0/mods-config/sql/main/mysql/queries.conf` or modify the existing one:

### Authorization (lookup subscriber credentials)

```sql
authorize_check_query = " \
    SELECT username, password AS 'Cleartext-Password' \
    FROM radius \
    WHERE username = '%{SQL-User-Name}' \
      AND status = 'active' \
    LIMIT 1"

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
      AND upload_speed IS NOT NULL"
```

> **Note:** For non-MikroTik NAS devices, replace `Mikrotik-Rate-Limit` with the appropriate vendor-specific attribute (e.g., `WISPr-Bandwidth-Max-Down` / `WISPr-Bandwidth-Max-Up`).

### Accounting (write to connection_logs)

```sql
accounting_start_query = " \
    INSERT INTO connection_logs \
        (contract_id, client_id, username, session_id, \
         ip_address, nas_id, nas_ip_address, event_type, event_at) \
    SELECT r.contract_id, r.client_id, '%{SQL-User-Name}', \
           '%{Acct-Session-Id}', '%{Framed-IP-Address}', \
           r.nas_id, '%{NAS-IP-Address}', 'start', NOW() \
    FROM radius r \
    WHERE r.username = '%{SQL-User-Name}' \
    LIMIT 1"

accounting_stop_query = " \
    INSERT INTO connection_logs \
        (contract_id, client_id, username, session_id, \
         ip_address, nas_id, nas_ip_address, event_type, \
         bytes_in, bytes_out, packets_in, packets_out, \
         session_duration, terminate_cause, event_at) \
    SELECT r.contract_id, r.client_id, '%{SQL-User-Name}', \
           '%{Acct-Session-Id}', '%{Framed-IP-Address}', \
           r.nas_id, '%{NAS-IP-Address}', 'stop', \
           '%{Acct-Input-Octets}', '%{Acct-Output-Octets}', \
           '%{Acct-Input-Packets}', '%{Acct-Output-Packets}', \
           '%{Acct-Session-Time}', '%{Acct-Terminate-Cause}', NOW() \
    FROM radius r \
    WHERE r.username = '%{SQL-User-Name}' \
    LIMIT 1"

accounting_update_query = " \
    INSERT INTO connection_logs \
        (contract_id, client_id, username, session_id, \
         ip_address, nas_id, nas_ip_address, event_type, \
         bytes_in, bytes_out, session_duration, event_at) \
    SELECT r.contract_id, r.client_id, '%{SQL-User-Name}', \
           '%{Acct-Session-Id}', '%{Framed-IP-Address}', \
           r.nas_id, '%{NAS-IP-Address}', 'interim-update', \
           '%{Acct-Input-Octets}', '%{Acct-Output-Octets}', \
           '%{Acct-Session-Time}', NOW() \
    FROM radius r \
    WHERE r.username = '%{SQL-User-Name}' \
    LIMIT 1"
```

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

### Verify connection_logs population

```sql
SELECT * FROM connection_logs ORDER BY event_at DESC LIMIT 10;
```

---

## CoA / Disconnect Messages

FireISP sends RADIUS Change-of-Authorization (CoA) and Disconnect messages via UDP when suspending or restoring a client's service. This is handled in `src/services/suspensionService.js`.

### How it works

1. The suspension service sends a **Disconnect-Request** to the NAS when a contract is suspended
2. The NAS terminates the PPPoE session
3. On reconnection attempt, the subscriber's `status = 'suspended'` causes FreeRADIUS to reject authentication
4. When service is restored, the status is set back to `active`

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

1. **Create a dedicated MySQL user** for FreeRADIUS with minimal permissions:
   ```sql
   CREATE USER 'radius_user'@'%' IDENTIFIED BY 'strong_password';
   GRANT SELECT ON fireisp.radius TO 'radius_user'@'%';
   GRANT SELECT ON fireisp.nas TO 'radius_user'@'%';
   GRANT INSERT ON fireisp.connection_logs TO 'radius_user'@'%';
   FLUSH PRIVILEGES;
   ```

2. **Use TLS** for the MySQL connection between FreeRADIUS and the database

3. **Firewall** the RADIUS ports (1812/UDP auth, 1813/UDP acct, 3799/UDP CoA)

4. **Rotate** the RADIUS shared secret regularly
