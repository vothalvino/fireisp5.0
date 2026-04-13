# FireISP 5.0 — Operational Runbook

Common operational scenarios and troubleshooting guides.

## Table of Contents

- [Suspension Troubleshooting](#suspension-troubleshooting)
- [RADIUS Debugging](#radius-debugging)
- [CFDI Error Handling](#cfdi-error-handling)
- [Database Maintenance](#database-maintenance)
- [Alert System](#alert-system)
- [2FA / TOTP Issues](#2fa--totp-issues)

---

## Suspension Troubleshooting

### Client reports they are suspended but already paid

1. **Check suspension logs:**
   ```sql
   SELECT * FROM suspension_logs
   WHERE contract_id = <contract_id>
   ORDER BY created_at DESC LIMIT 5;
   ```

2. **Check invoice status:**
   ```sql
   SELECT id, invoice_number, total, status, balance_due
   FROM invoices WHERE contract_id = <contract_id>
   ORDER BY due_date DESC;
   ```

3. **Check if payment was applied:**
   ```sql
   SELECT * FROM client_balance_ledger
   WHERE client_id = <client_id>
   ORDER BY created_at DESC LIMIT 10;
   ```

4. **Manual reconnect** (if payment is confirmed):
   ```bash
   # Via API
   curl -X POST http://localhost:3000/api/v1/suspension/reconnect \
     -H "Authorization: Bearer <token>" \
     -H "X-Org-Id: <org_id>" \
     -H "Content-Type: application/json" \
     -d '{"contract_id": <contract_id>}'
   ```

### Suspension rules not firing

- Check that `suspension_rules.is_enabled = TRUE` for the organization
- Check `scheduled_tasks` table to verify the suspension task is active
- Review logs: `grep "suspension" /var/log/fireisp/*.log`

---

## RADIUS Debugging

### CoA / Disconnect not reaching NAS

1. **Verify NAS configuration:**
   ```sql
   SELECT id, ip_address, coa_port, secret FROM nas WHERE id = <nas_id>;
   ```

2. **Check if the RADIUS account exists:**
   ```sql
   SELECT * FROM radius WHERE contract_id = <contract_id>;
   ```

3. **Test UDP connectivity** from the FireISP server to the NAS:
   ```bash
   nc -u -z <nas_ip> <coa_port>
   ```

4. **Check suspension_logs for CoA response:**
   ```sql
   SELECT coa_sent, coa_response FROM suspension_logs
   WHERE contract_id = <contract_id>
   ORDER BY created_at DESC LIMIT 1;
   ```

### Common CoA responses

| Response | Meaning | Action |
|----------|---------|--------|
| `Disconnect-ACK` | Success — client disconnected | Normal |
| `Disconnect-NAK` | NAS rejected — session not found | Check if client is actually connected |
| `Timeout` | No response from NAS | Check network, firewall, NAS CoA port |
| `Socket error` | UDP send failed | Check server network configuration |

---

## CFDI Error Handling

### PAC stamping fails

1. **Check PAC provider credentials** in `.env`:
   ```
   PAC_PROVIDER=finkok
   PAC_USER=your-user
   PAC_PASSWORD=your-password
   PAC_URL=https://demo-facturacion.finkok.com
   ```

2. **Check CFDI document status:**
   ```sql
   SELECT id, invoice_id, status, pac_response, error_message
   FROM cfdi_documents WHERE invoice_id = <invoice_id>;
   ```

3. **Retry stamping:**
   ```bash
   curl -X POST http://localhost:3000/api/v1/cfdi/stamp/<cfdi_document_id> \
     -H "Authorization: Bearer <token>" \
     -H "X-Org-Id: <org_id>"
   ```

### Common CFDI errors

| Error | Cause | Fix |
|-------|-------|-----|
| `CSD401` | CSD certificate expired | Upload new CSD via `/api/v1/csd-certificates` |
| `RFC invalid` | Client RFC format error | Verify RFC in client record |
| `Uso CFDI invalid` | Wrong uso_cfdi for regimen | Check SAT catalog compatibility |
| `Duplicate UUID` | Already stamped | Check if CFDI was already generated |

---

## Database Maintenance

### Run migrations

```bash
npm run migrate
# Or in Docker:
docker exec fireisp-app node src/scripts/migrate.js
```

### Check migration status

```bash
npm run admin -- migration-status
```

### Database health check

```bash
npm run admin -- db-health
# Or via API:
curl http://localhost:3000/health?detail=true
```

### Manual backup

```bash
npm run backup
# Backs up to storage/backups/
```

---

## Alert System

### Alert rules not triggering

1. **Verify rules are enabled:**
   ```sql
   SELECT * FROM alert_rules WHERE organization_id = <org_id> AND is_enabled = TRUE;
   ```

2. **Check for recent SNMP data:**
   ```sql
   SELECT device_id, cpu_usage, memory_usage, polled_at
   FROM snmp_metrics
   WHERE polled_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)
   ORDER BY polled_at DESC LIMIT 10;
   ```

3. **Check alert evaluation task:**
   ```sql
   SELECT * FROM scheduled_tasks WHERE task_name = 'alert_evaluation';
   ```

4. **Review alert history:**
   ```sql
   SELECT ae.*, ar.name AS rule_name
   FROM alert_events ae
   JOIN alert_rules ar ON ar.id = ae.alert_rule_id
   WHERE ae.organization_id = <org_id>
   ORDER BY ae.created_at DESC LIMIT 20;
   ```

---

## 2FA / TOTP Issues

### User locked out of 2FA

1. **Use backup codes** — the user has 10 backup codes generated at setup time

2. **Admin disable 2FA** (if backup codes are lost):
   ```sql
   UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, totp_backup_codes = NULL
   WHERE id = <user_id>;
   ```

### TOTP codes not working

- **Time sync**: TOTP requires server and device clocks to be within ±30 seconds (±1 step window)
- Verify server time: `date -u` should match UTC
- If using NTP: `timedatectl status` should show "System clock synchronized: yes"
- The TOTP implementation uses a ±1 window (allows 30-second drift each way)

### Generate new backup codes

```bash
curl -X POST http://localhost:3000/api/v1/2fa/backup-codes \
  -H "Authorization: Bearer <token>"
```

This regenerates 10 new codes and invalidates old ones.
