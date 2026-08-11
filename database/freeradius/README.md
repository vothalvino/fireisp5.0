# FreeRADIUS SQL Integration for FireISP 5.0

This directory contains the SQL queries that FreeRADIUS needs to authenticate
and authorize subscribers against the FireISP database.

## Overview

FireISP stores RADIUS credentials in the `radius` table and NAS definitions
in the `nas` table. FreeRADIUS reads these tables through its `rlm_sql` module.

## Prerequisites

1. FreeRADIUS 3.x installed
2. `rlm_sql` and `rlm_sql_mysql` modules enabled
3. MySQL user with SELECT access to the FireISP database

## Configuration

### 1. Create a read-only MySQL user for FreeRADIUS

> **⚠️ Important:** Replace `change-this-password` with a strong, randomly generated
> password. Never use the example password in production environments.

```sql
CREATE USER 'freeradius'@'localhost' IDENTIFIED BY 'change-this-password';
GRANT SELECT ON fireisp.radius TO 'freeradius'@'localhost';
GRANT SELECT ON fireisp.nas TO 'freeradius'@'localhost';
GRANT SELECT ON fireisp.contracts TO 'freeradius'@'localhost';
GRANT SELECT ON fireisp.plans TO 'freeradius'@'localhost';
GRANT SELECT, INSERT, UPDATE ON fireisp.connection_logs TO 'freeradius'@'localhost';
FLUSH PRIVILEGES;
```

### 2. Configure `/etc/freeradius/mods-enabled/sql`

```
sql {
    driver = "rlm_sql_mysql"
    dialect = "mysql"

    server   = "localhost"
    port     = 3306
    login    = "freeradius"
    password = "change-this-password"

    radius_db = "fireisp"

    read_clients = yes

    # --- Authorization queries ---
    authorize_check_query = "\
        SELECT r.username, 'Cleartext-Password' AS Attribute, \
               r.password AS Value, ':=' AS op \
        FROM radius r \
        JOIN contracts c ON c.id = r.contract_id \
        WHERE r.username = '%{SQL-User-Name}' \
          AND r.status = 'active' \
          AND (c.status = 'active' \
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

    authorize_reply_query = "\
        SELECT r.username, 'Framed-IP-Address' AS Attribute, \
               r.ip_address AS Value, ':=' AS op \
        FROM radius r \
        WHERE r.username = '%{SQL-User-Name}' \
          AND r.ip_address IS NOT NULL \
        UNION ALL \
        SELECT r.username, 'Framed-IPv6-Address' AS Attribute, \
               r.ipv6_address AS Value, ':=' AS op \
        FROM radius r \
        WHERE r.username = '%{SQL-User-Name}' \
          AND r.ipv6_address IS NOT NULL \
        UNION ALL \
        SELECT r.username, 'Delegated-IPv6-Prefix' AS Attribute, \
               CONCAT(r.ipv6_delegated_prefix, '/', r.ipv6_prefix_len) AS Value, ':=' AS op \
        FROM radius r \
        WHERE r.username = '%{SQL-User-Name}' \
          AND r.ipv6_delegated_prefix IS NOT NULL \
        UNION ALL \
        SELECT r.username, 'Session-Timeout' AS Attribute, \
               CAST(GREATEST(TIMESTAMPDIFF(SECOND, NOW(), c.test_window_expires_at), 1) AS CHAR) AS Value, ':=' AS op \
        FROM radius r \
        JOIN contracts c ON c.id = r.contract_id \
        WHERE r.username = '%{SQL-User-Name}' \
          AND r.status = 'active' \
          AND c.status = 'pending' \
          AND c.test_window_cleanup_pending = 0 \
          AND c.test_window_expires_at > NOW()"

    # --- NAS / Client queries ---
    client_query = "\
        SELECT n.ip_address AS nasname, \
               n.secret AS secret, \
               n.name AS shortname, \
               n.type AS type \
        FROM nas n \
        WHERE n.status = 'active'"

    # --- Accounting queries ---
    # nas_id is resolved from the packet's NAS-IP-Address (the SERVING NAS),
    # NOT copied from radius.nas_id (the home NAS): auth is NAS-agnostic, so a
    # subscriber may be online through any registered NAS, and FireISP's
    # CoA/Disconnect targeting reads these rows to find the router the
    # session actually lives on.
    accounting_start_query = "\
        INSERT INTO connection_logs \
          (contract_id, client_id, username, session_id, \
           ip_address, nas_id, nas_ip_address, \
           event_type, event_at) \
        SELECT r.contract_id, c.client_id, '%{SQL-User-Name}', '%{Acct-Session-Id}', \
               '%{Framed-IP-Address}', (SELECT n2.id FROM nas n2 WHERE n2.ip_address = '%{NAS-IP-Address}' AND n2.deleted_at IS NULL LIMIT 1), '%{NAS-IP-Address}', \
               'start', NOW() \
        FROM radius r \
        JOIN contracts c ON c.id = r.contract_id \
        WHERE r.username = '%{SQL-User-Name}' \
        LIMIT 1"

    accounting_stop_query = "\
        INSERT INTO connection_logs \
          (contract_id, client_id, username, session_id, \
           ip_address, nas_id, nas_ip_address, \
           event_type, bytes_in, bytes_out, \
           packets_in, packets_out, session_duration, \
           terminate_cause, event_at) \
        SELECT r.contract_id, c.client_id, '%{SQL-User-Name}', '%{Acct-Session-Id}', \
               '%{Framed-IP-Address}', (SELECT n2.id FROM nas n2 WHERE n2.ip_address = '%{NAS-IP-Address}' AND n2.deleted_at IS NULL LIMIT 1), '%{NAS-IP-Address}', \
               'stop', '%{Acct-Input-Octets}', '%{Acct-Output-Octets}', \
               '%{Acct-Input-Packets}', '%{Acct-Output-Packets}', '%{Acct-Session-Time}', \
               '%{Acct-Terminate-Cause}', NOW() \
        FROM radius r \
        JOIN contracts c ON c.id = r.contract_id \
        WHERE r.username = '%{SQL-User-Name}' \
        LIMIT 1"

    accounting_update_query = "\
        INSERT INTO connection_logs \
          (contract_id, client_id, username, session_id, \
           ip_address, nas_id, nas_ip_address, \
           event_type, bytes_in, bytes_out, \
           packets_in, packets_out, session_duration, event_at) \
        SELECT r.contract_id, c.client_id, '%{SQL-User-Name}', '%{Acct-Session-Id}', \
               '%{Framed-IP-Address}', (SELECT n2.id FROM nas n2 WHERE n2.ip_address = '%{NAS-IP-Address}' AND n2.deleted_at IS NULL LIMIT 1), '%{NAS-IP-Address}', \
               'interim-update', '%{Acct-Input-Octets}', '%{Acct-Output-Octets}', \
               '%{Acct-Input-Packets}', '%{Acct-Output-Packets}', '%{Acct-Session-Time}', \
               NOW() \
        FROM radius r \
        JOIN contracts c ON c.id = r.contract_id \
        WHERE r.username = '%{SQL-User-Name}' \
        LIMIT 1"
}
```

### 3. CoA (Change of Authorization) Support

FireISP automatically sends RADIUS CoA packets when:
- A contract is **suspended** → Disconnect-Request (Code 40)
- A contract is **reconnected** → CoA-Request (Code 43)

Configure CoA port in FireISP `.env`:
```
RADIUS_COA_PORT=3799
```

The NAS `coa_port` column in the `nas` table can override this per-device.

CoA/Disconnect packets are roaming-aware: they are sent to every registered
NAS that has an open session for the subscriber in `connection_logs`, plus
the home NAS (`radius.nas_id`) as a safety net — not just the home NAS. A
packet for a username with no session on that NAS is answered with a
harmless NAK.

### 4. Testing

```bash
# Test authentication
radtest testuser testpassword localhost 0 testing123

# Check accounting
radacct -h localhost -s testing123
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Auth rejected | Check `radius.status = 'active'` and either `contracts.status = 'active'` or a pending contract has a future `test_window_expires_at` with no cleanup pending |
| No IP assigned | Ensure `radius.ip_address` is populated or use IP pools |
| CoA timeout | Verify NAS firewall allows UDP port 3799 inbound |
| Accounting not logged | Check FreeRADIUS SQL user has INSERT on `connection_logs` |
