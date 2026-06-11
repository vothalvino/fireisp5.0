---
name: section6-snmp-nms
description: §6.1–6.6 SNMP & NMS implementation status and known gaps (migrations 247-263)
metadata:
  type: project
---

## Implementation status as of 2026-06-11

Migrations 247–259. Branch: `6-of-isp-platform-feature.md`.

### Completed

**§6.1 Device Discovery & Onboarding:**
- Migrations 247–248: discovery_scans, trap_forwarding_rules tables
- Migration 249: device_groups table
- Migrations 250–252: snmp_scan_jobs, snmp_trap_receivers, device_group_members (pre-existing tables extended)
- Backend routes: `/discovery-scans`, `/trap-forwarding-rules`, `/device-groups` (full CRUD)
- Frontend pages: DiscoveryScanList, TrapForwardingRuleList, DeviceGroupList
- SNMPv3 credential *columns* exist on devices (auth_key_encrypted, priv_key_encrypted) but net-snmp session NOT yet wired for v3

**§6.2 Network Device Monitoring:**
- Migration 255: 12 new columns in snmp_metrics
- Migration 256: OID seeds for MikroTik RouterOS, SFP Diagnostics, Generic Switch, Generic UPS, Environmental Sensors
- snmpPoller.js: VALID_METRIC_COLUMNS expanded to 20; insertMetricRow extended to 22 columns

**§6.3 Interface & Traffic Monitoring:**
- New endpoints in `/snmp-metrics`: top-talkers, interfaces/:deviceId, errors
- Tests: tests/snmpMetricsExtended.test.js (8 tests)

**§6.4 Polling Engine:**
- Migration 258: poller_nodes, device_polling_configs, poller_performance_snapshots tables + 2 scheduled task seeds
- Migration 259: 9 RBAC permissions (poller_nodes.*, polling_configs.*, poller_performance.view) for admin/technician/readonly
- src/services/pollerEngine.js: getPollingConfig (4-level precedence), pollWithConfig, adaptivePollCheck (in-memory Map), recordPerformanceSnapshot, getPerformanceDashboard
- Routes: /poller-nodes (CRUD + performance endpoint), /device-polling-configs (CRUD), /poller-performance (list + dashboard)
- Models: PollerNode, DevicePollingConfig
- Schemas: src/middleware/schemas/pollerNodes.js, devicePollingConfigs.js (plain object format, NOT express-validator)
- Frontend pages: PollerNodeList, DevicePollingConfigList, PollerPerformanceDashboard
- Tests: tests/pollerEngine.test.js (13 tests), tests/pollerNodes.test.js (8 tests)
- i18n: 3 new top-level keys in en/es/pt-BR (1127 total keys, 100% coverage)
- Next free migration: 260

**§6.5 Alerting & Notification:**
- Migration 260: 5 new tables (alert_escalation_chains, alert_escalation_steps, maintenance_windows, alert_notification_channels, alert_suppression_rules); alert_rules extended (escalation_chain_id, flap_detection_enabled/threshold/window, baseline_enabled/lookback/stddev_multiplier, auto_create_ticket guard); alert_events extended (escalation_step, escalated_at, flapping, suppressed, maintenance_window_id)
- Migration 261: 16 RBAC permissions seeded (alert_escalations/maintenance_windows/alert_channels/alert_suppression.*) for admin(16)/technician(8)/readonly(4)
- alertService: isInMaintenanceWindow, isSuppressedByCorrelation, checkFlapping, triggerEscalation, evaluateAlertsV2; ALLOWED_METRICS/SNMP_METRICS extended with 12 hardware metrics
- Routes: 22 new handlers across /alerts/escalation-chains, /maintenance-windows, /notification-channels, /suppression-rules, /evaluate-v2
- notification-channels: config_encrypted stored AES-256-GCM; GET never returns config_encrypted field
- Frontend pages: AlertEscalationChainList, MaintenanceWindowList, AlertChannelList, AlertSuppressionList; all in technician+ route group
- Commit: 5663d8f. Next free migration: 262.

**§6.6 Device Configuration Management:**
- Migration 262: 5 new tables (config_templates, config_deployment_records, config_backup_schedules, config_compliance_rules, config_compliance_results); device_config_backups extended with diff_from_previous column
- Migration 263: 16 RBAC permissions seeded for admin(16)/technician(10)/readonly(4)
- configBackupService: computeDiff, runComplianceAudit, pullBackupWithDiff, deployConfigTemplate
- Routes: /config-templates (CRUD + POST /:id/deploy), /config-backup-schedules (CRUD), /config-compliance-rules (CRUD + GET /results + POST /run); /device-config-backups extended with GET /diff/:id, POST /compliance-run, GET /compliance-results
- Frontend pages: ConfigTemplateList, ConfigBackupScheduleList, ConfigComplianceRuleList; registered in technician+ route group
- i18n: config_templates, config_backup_schedules, config_compliance keys in en/es/pt-BR
- Tests: 22 new tests across 3 test files; all passing
- Commit: 15c2a03. schema.sql updated to 191 tables, README updated to 001-263 range, feature checkboxes finalized. Next free migration: 264.

### Known gaps (open checkboxes — still deferred)

- SNMPv3 session creation in snmpPoller (net-snmp `createSession` options for authProto, authKey, privProto, privKey) — highest-value gap
- §6.6 "Rollback to previous configuration" — requires live FireRelay/RouterOS tunnel; left unticked in isp-platform-features.md
- CSV bulk device import endpoint
- Cisco/Juniper BNG vendor-specific OID seeds
- Huawei/ZTE OLT private MIB monitoring
- NetFlow/sFlow traffic classification
- Graph retention pruning jobs (cron to drop old partitions)
- pollWithConfig() calls pollDevice() locally — remote poller node dispatch deferred
- adaptivePollCheck in-memory Map resets on process restart (needs Redis for HA)
- recurring maintenance_windows (recurrence_cron stored but not auto-executed by scheduler)
- triggerEscalation emits event bus message but does not call external SMTP/SMS/Telegram APIs

### Architecture notes

- snmp_metrics is RANGE-partitioned by month; no FKs, avoid NOT NULL without defaults
- snmpPoller.js: VALID_METRIC_COLUMNS set guards which columns can be written
- pollerEngine adaptiveOverrides is an in-memory Map — resets on process restart
- Validation schemas use plain object format (see src/middleware/validate.js) — NOT express-validator
- alert_notification_channels: config_encrypted never returned in GET; POST encrypts via src/utils/encryption.js
- jest.resetAllMocks() required in pollerEngine tests; jest.clearAllMocks() does NOT clear queued mockResolvedValueOnce values
- schema.sql now has 191 CREATE TABLE statements; migrations run 001-263

**Why:** §6.4–6.6 fully implemented on 2026-06-11. Branch: 6-of-isp-platform-feature.md.
**How to apply:** When resuming §6 work, start from migration 264. SNMPv3 wiring in snmpPoller is the highest-value remaining gap.
