---
name: section6-snmp-nms
description: §6.1–6.6 SNMP & NMS implementation status — all feasible gaps closed (migrations 247-265)
metadata:
  type: project
---

## Implementation status as of 2026-06-11

Migrations 247–265. Branch: `6-of-isp-platform-feature.md`.

### Completed (all feasible items)

**§6.1 Device Discovery & Onboarding — fully complete:**
- Migrations 247–254: discovery_scans, trap_forwarding_rules, device_groups, SNMPv3 columns, vendor profiles, permissions, scheduled tasks
- SNMPv3 session wiring in snmpPoller.js: `createSnmpSession()` detects v3, decrypts auth/priv keys via `src/utils/encryption.js`, maps auth_protocol (md5/sha/sha256/sha512) and priv_protocol (des/aes128/aes256) to net-snmp constants, resolves SecurityLevel from credential presence, calls `snmp.createV3Session()`
- Bulk device CSV import: backend existed since initial work; `DeviceImport.tsx` page added at `/device-import` (file upload, per-row error table, download template button), i18n in en/es/pt-BR

**§6.2 Network Device Monitoring — fully complete:**
- Migration 255: 12 extended metric columns in snmp_metrics
- Migration 256: MikroTik/SFP/Switch/UPS/Environmental OID seeds
- Migration 264: `if_oper_status` column added to snmp_metrics + rollup tables; 4 new profiles (Cisco BNG, Juniper BNG, Huawei OLT, ZTE OLT) with real vendor OIDs; Generic Switch extended with 64-bit counters, ifOperStatus, discards, pethPsePortDetectionStatus
- Frontend: `SwitchPortsPanel` in SnmpMetrics.tsx shows per-port status/throughput/errors/PoE from /snmp-metrics/interfaces/:deviceId

**§6.3 Interface & Traffic Monitoring — fully complete:**
- Top-talkers, interfaces/:deviceId, errors endpoints
- Migration 265: graph retention corrected — hourly 7d (was 1yr), daily 90d (was indefinite), monthly 3yr (new tier)
- `snmp_metrics_1month` table created; `snmp_rollup_to_1month()` procedure; `snmp_apply_retention()` updated; events `evt_snmp_rollup_1month` + `evt_snmp_retention` added

**§6.4 Polling Engine — fully complete** (mig 258-259)

**§6.5 Alerting & Notification — fully complete** (mig 260-261)

**§6.6 Device Configuration Management — partial** (mig 262-263)
- "Rollback to previous configuration" remains deferred (needs live FireRelay/RouterOS tunnel)

### Permanently deferred (leave unticked)

- §6.3 "Traffic classification (NetFlow/sFlow)" — needs live flow ingestion infrastructure
- §6.6 "Rollback to previous configuration" — needs live device tunnels

### Architecture notes

- snmp_metrics is RANGE-partitioned by month; no FKs, avoid NOT NULL without defaults
- snmpPoller.js: VALID_METRIC_COLUMNS guards columns; insertMetricRow now writes 23 params including if_oper_status
- `createV3Session()` user object: { name, level (SecurityLevel enum), authProtocol, authKey, privProtocol, privKey }
- snmpMetricsExtended.test.js mocks `net-snmp` as `{}` (empty) — causes mock bleed if run with snmpPoller.test.js via --runInBand; each file passes when run independently (Jest default parallel mode is unaffected)
- snmp_metrics_1month: NOT partitioned (batch-DELETE retention); snmp_metrics raw IS partitioned (instant DROP PARTITION)
- schema.sql now has 192 CREATE TABLE statements; migrations run 001-265

**Why:** All feasible §6 gaps closed on 2026-06-11. Next work likely §7 FTTH/OLT or §8 TR-069.
**How to apply:** When continuing, next free migration is 266. No open §6 gaps remain except the two deferred items above.
