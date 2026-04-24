# FireISP 5.0 — Operational Runbook

Common operational scenarios and troubleshooting guides.

## Table of Contents

- [Suspension Troubleshooting](#suspension-troubleshooting)
- [RADIUS Debugging](#radius-debugging)
- [CFDI Error Handling](#cfdi-error-handling)
- [Database Maintenance](#database-maintenance)
- [Alert System](#alert-system)
- [2FA / TOTP Issues](#2fa--totp-issues)
- [Incident Response](#incident-response-p19)
  - [Severity Matrix](#severity-matrix)
  - [Incident Declaration Criteria](#incident-declaration-criteria)
  - [Incident Workflow](#incident-workflow)
  - [SEV1 Scenarios](#sev1-scenarios--what-to-do-when-x-is-on-fire)
  - [Comms Templates](#comms-templates)
  - [Post-Mortem Template](#post-mortem-template)
  - [Escalation Paths](#escalation-paths)

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

---

## Incident Response (P1.9)

---

### Severity Matrix

| Severity | Definition | Response time | Examples |
|---|---|---|---|
| **SEV1** | Complete service outage or critical data loss; revenue impact or regulatory breach imminent | Page immediately; respond within **15 minutes** | Database down, RADIUS down, mass incorrect suspension, leaked credentials, TLS certificate expired |
| **SEV2** | Significant degradation; major feature unavailable; >10% of users impacted | Respond within **1 hour** | Payment gateway down, CFDI stamping failing, repeated 5xx on billing endpoints |
| **SEV3** | Minor degradation; workaround exists; single user or minor feature affected | Respond within **4 hours** | Single 4xx on non-critical endpoint, scheduled task delayed, PDF generation slow |
| **SEV4** | Informational; no active user impact; planned maintenance or cosmetic defect | Respond within **2 business days** | Log noise, non-critical warning alert, documentation bug |

---

### Incident Declaration Criteria

An incident should be **formally declared** (create an incident channel / ticket) when:

- Any SEV1 or SEV2 condition is met (see table above).
- An alert fires in PagerDuty / Opsgenie and is not resolved within 30 minutes.
- A customer reports a critical issue that cannot be immediately identified as a known configuration error.
- Any potential security breach is discovered (treat as SEV1 until scope is determined).

**Who can declare an incident:** Any on-call engineer or operator.

---

### Incident Workflow

```
1. DETECT   — alert fires or customer report received
2. DECLARE  — create incident (#incident-YYYYMMDD-NNN in chat, or ticket)
3. ASSIGN   — on-call engineer becomes Incident Commander (IC)
4. ASSESS   — determine severity within 5 min of declaration
5. MITIGATE — implement fastest available fix (rollback, feature flag, redirect)
6. RESOLVE  — confirm service restored; update status page
7. CLOSE    — post-mortem within 48 h (SEV1/SEV2) or 5 days (SEV3)
```

---

### SEV1 Scenarios — "What To Do When X Is On Fire"

#### 🔴 Database is down

1. **Verify**: `curl https://your-fireisp.domain/health?detail=true` → `db.connected: false`
2. **Check MySQL service**:
   ```bash
   docker exec fireisp-db mysqladmin -u root -p ping
   # or in K8s:
   kubectl exec -n fireisp deploy/mysql -- mysqladmin ping
   ```
3. **Check disk space** (MySQL will stop if disk is full):
   ```bash
   df -h /var/lib/mysql
   ```
4. **Check MySQL error log**:
   ```bash
   docker logs fireisp-db --tail 50
   kubectl logs -n fireisp -l app=mysql --tail 50
   ```
5. **Restart MySQL** (if no data-integrity issue):
   ```bash
   docker compose -f docker-compose.prod.yml restart db
   ```
6. **Switch to read replica** (if write DB is down and read-only mode is acceptable):
   - Set `DB_READ_REPLICA_URL` in `.env` to the replica host; the app will serve reads from replica.
7. **If MySQL will not start**, initiate a DR restore: see `docs/dr-drill.md`.
8. **Customer comms**: Use SEV1 comms template below.

---

#### 🔴 RADIUS is down (clients cannot authenticate)

1. **Verify**: Multiple clients report no internet; check RADIUS logs on the NAS.
2. **Check FreeRADIUS service**:
   ```bash
   systemctl status freeradius
   journalctl -u freeradius --since "10 min ago"
   ```
3. **Test RADIUS authentication**:
   ```bash
   radtest <username> <password> <radius_host> 0 <secret>
   # Expected: Access-Accept
   ```
4. **Check database connectivity from RADIUS host**:
   ```bash
   mysql -h <DB_HOST> -u <DB_USER> -p -e "SELECT 1;"
   ```
5. **Check for CoA port issues** (UDP 3799 blocked):
   ```bash
   nc -u -z <nas_ip> 3799
   ```
6. **Restart FreeRADIUS** (if config is intact):
   ```bash
   systemctl restart freeradius
   ```
7. **Emergency workaround** — if RADIUS will not recover within 15 min,
   manually push a static route/lease to the NAS to allow known-good clients
   to pass while RADIUS is being restored.
8. **Customer comms**: Use SEV1 comms template below.

---

#### 🔴 Payment gateway is down

1. **Identify affected gateway** (Stripe, Conekta, or manual):
   ```sql
   SELECT name, is_active, last_error FROM payment_gateways WHERE organization_id = <org_id>;
   ```
2. **Check gateway status page** (Stripe: https://status.stripe.com, Conekta: https://status.conekta.com).
3. **Disable the failing gateway** temporarily to stop failed payment attempts from filling logs:
   ```sql
   UPDATE payment_gateways SET is_active = FALSE WHERE name = '<gateway>';
   ```
4. **Enable fallback gateway** if configured:
   ```sql
   UPDATE payment_gateways SET is_active = TRUE WHERE name = '<fallback_gateway>';
   ```
5. **Queue affected payments for retry** once gateway recovers — use the webhook retry queue or manually re-process.
6. **Customer comms**: Only if the outage affects self-service payment pages. Use SEV2 template.

---

#### 🔴 Mass suspension event (clients incorrectly suspended)

1. **Verify scope**:
   ```sql
   SELECT COUNT(*), DATE(created_at) FROM suspension_logs
   WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
   GROUP BY DATE(created_at);
   ```
2. **Identify trigger** — check `scheduled_tasks` for the suspension job and audit logs for recent rule changes.
3. **Pause the suspension task** to prevent further incorrect suspensions:
   ```sql
   UPDATE scheduled_tasks SET is_enabled = FALSE WHERE task_name = 'auto_suspension';
   ```
4. **Bulk reconnect** affected clients:
   ```bash
   curl -X POST https://your-fireisp.domain/api/v1/suspension/bulk-reconnect \
     -H "Authorization: Bearer <admin_token>" \
     -H "X-Org-Id: <org_id>" \
     -H "Content-Type: application/json" \
     -d '{"reason": "Emergency reconnect — SEV1 investigation"}'
   ```
5. **Root cause**: Review the suspension rule that triggered, cross-reference with payment data.
6. **Customer comms**: Use SEV1 template (service interruption). Prepare a credit / goodwill gesture.

---

#### 🔴 Leaked credentials

1. **Immediately revoke all active JWT sessions**:
   - Change `JWT_SECRET` in `.env` / K8s Sealed Secret — all existing tokens will be invalidated instantly.
   - Rolling-restart the app pods to pick up the new secret.
2. **Rotate the leaked secret** in your secrets manager (see `docs/secrets-management.md`).
3. **Audit access** — query `audit_logs` for suspicious activity in the past 30 days:
   ```sql
   SELECT user_id, action, ip_address, created_at FROM audit_logs
   WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
   ORDER BY created_at DESC LIMIT 500;
   ```
4. **Check for data exfiltration** in access logs (nginx / CloudFlare) — look for unusual `GET /export` or bulk-download patterns.
5. **Notify affected parties** per LFPDPPP Art. 20 (72 hours) or GDPR Art. 33 (72 hours) if personal data was accessed.
6. **Engage security counsel** if the breach scope is unclear.

---

#### 🔴 TLS certificate expired

1. **Identify** via browser or `curl -vI https://your-fireisp.domain 2>&1 | grep "expire"`.
2. **Force Let's Encrypt renewal**:
   ```bash
   docker exec fireisp-certbot certbot renew --force-renewal
   docker exec fireisp-nginx nginx -s reload
   ```
3. **Cloudflare DNS-01** (wildcard):
   ```bash
   bash scripts/cloudflare-renew.sh
   ```
4. If automated renewal is broken, check Certbot logs:
   ```bash
   docker logs fireisp-certbot --tail 50
   ```
5. Add a Prometheus alert for certificate expiry < 14 days (see `docs/slo.md`).

---

### Comms Templates

#### SEV1 — Status Page / Customer Email

> **Subject:** [FireISP] Service interruption — [Date]
>
> We are currently experiencing a service interruption affecting [describe affected service, e.g., internet connectivity for some customers].
>
> **Impact:** [Describe impact — e.g., "Customers may be unable to connect to the internet."]
>
> **Start time:** [UTC timestamp]
>
> **Status:** We have identified the cause and are actively working on a resolution. We will post an update within 30 minutes.
>
> We apologise for the disruption. Our team is working to restore service as quickly as possible.
>
> — [Company name] Operations Team

#### SEV1 — Incident Channel (Internal)

```
🔴 SEV1 INCIDENT DECLARED — [Date/Time UTC]
IC: @[incident-commander]
Summary: [one-line description]
Affected: [service / customers]
Timeline so far:
  HH:MM — [event]
Next update: HH:MM (in 30 minutes)
Bridge: [link if applicable]
```

#### SEV2 — Status Page

> **Subject:** [FireISP] Degraded service — [Date]
>
> We are investigating a degraded service affecting [feature].
>
> **Impact:** [Describe impact — limited to X feature, workaround: Y]
>
> **Start time:** [UTC timestamp]
>
> We will provide an update within 1 hour.

#### Incident Resolution

> **Subject:** [FireISP] Service restored — [Date]
>
> The service interruption that began at [start time UTC] has been resolved as of [resolution time UTC].
>
> **Root cause summary:** [brief description]
>
> We have implemented [fix]. We are conducting a full post-mortem and will share a summary with customers within 48 hours.
>
> We apologise for the disruption. If you continue to experience issues, please contact support.

---

### Post-Mortem Template

Create a new file `docs/post-mortems/YYYYMMDD-<slug>.md` for every SEV1 and SEV2 incident.

```markdown
# Post-Mortem: <Title> (SEV<N> — YYYY-MM-DD)

## Summary
One paragraph: what happened, what was the user impact, and how was it resolved.

## Timeline (all times UTC)

| Time  | Event |
|-------|-------|
| HH:MM | Alert fired / first customer report |
| HH:MM | Incident declared, IC assigned |
| HH:MM | Root cause identified |
| HH:MM | Mitigation applied |
| HH:MM | Service restored |
| HH:MM | Incident closed |

## Root Cause
Detailed technical explanation.

## Impact
- Duration: X minutes
- Customers affected: Y
- Estimated revenue impact: Z

## Contributing factors
- [factor 1]
- [factor 2]

## What went well
- [item]

## What could be improved
- [item]

## Action items

| Action | Owner | Due date | Status |
|--------|-------|----------|--------|
| [action] | @name | YYYY-MM-DD | Open |

## Detection
How was the incident detected? Was the alert timely?

## Lessons learned
[Free-text lessons for the team]
```

---

### Escalation Paths

```
On-call engineer  ──→  Engineering lead / CTO  ──→  All-hands bridge
   (0 – 15 min)           (15 – 30 min)              (> 30 min)

For legal/regulatory issues (data breach, SAT inquiry):
   On-call engineer  ──→  Legal counsel  ──→  INAI (LFPDPPP) or DPA (GDPR)
                                               within 72 hours of discovery

For payment gateway issues:
   On-call engineer  ──→  Finance/accounting  ──→  Gateway support line
```

