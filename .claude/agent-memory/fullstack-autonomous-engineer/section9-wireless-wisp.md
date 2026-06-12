---
name: section9-wireless-wisp
description: §9 Wireless/WISP Management implementation status — all 14 items complete (migrations 279-285)
metadata:
  type: project
---

## Implementation status as of 2026-06-11

Migrations 279–285. Branch: `9-of-isp-platform-feature.md`.

### Completed (all 14 items)

**§9.1 Sector / AP Management — fully complete:**
- Migration 279: `ap_sector_configs` (links devices to RF attributes: channel, frequency, tx_power_dbm, noise_floor_dbm, ccq_pct, connected_clients), `wireless_client_sessions` (per-CPE signal_dbm, snr_db, ccq_pct, tx/rx_rate_mbps, distance_m), `ap_channel_plans` (planned channel assignments), `wireless_channel_interference` (conflict detection results), `ap_command_jobs` (set_tx_power / set_frequency / set_channel_width command queue with stub driver pattern)
- Migration 280: vendor OID seeds in snmp_oid_profiles for MikroTik RouterOS, Ubiquiti airOS, Cambium Networks, Mimosa Networks, Tarana Wireless, Radwin, Siklu — covering noise floor, air utilization, CCQ, GPS sync, client count OIDs
- Migration 281: 30 wireless permissions seeded
- Frontend: WirelessApSectorsPage with AP Sectors / Channel Planning / AP Commands tabs; client session nested panel

**§9.2 PTMP / PTP Links — fully complete:**
- Migration 282: adds tx_signal_dbm, rx_signal_dbm, modulation, tx/rx_throughput_mbps, failover_link_id, is_primary, failover_state, last_failover_at to network_links table; `calculateLinkBudget()` pure functions (haversine distance, free-space path loss, Fresnel clearance)
- Migration 283: 12 link-planning permissions seeded
- Endpoints: POST /wireless/link-planning/calculate, GET /wireless/network-links/:id/ptp-metrics
- Frontend: WirelessLinkPlanningPage with Link Planning Calculator tab (input form + output cards) and PTP Monitoring tab

**§9.3 RF Metrics — fully complete:**
- Migration 284: `spectrum_scan_results` table (spectrum analysis records, hardware scanning noted as stub); gps_sync_status column in snmp_metrics + rollup tables; noise_floor_dbm, air_util_pct in rollup tables (already in snmp_metrics from §6)
- Migration 285: 18 RF/spectrum permissions seeded
- Endpoints: POST /wireless/spectrum-scans, GET /wireless/rf-metrics/signal-distribution, /noise-floor, /air-utilization, /gps-sync
- Frontend: WirelessMetricsPage with Signal Distribution (SVG bar chart via getSignalDistribution()), Noise Floor, Air Utilization, Spectrum Scans, GPS Sync tabs

### Architecture notes

- Scheduled speed profiles reuse plan_speed_windows from migration 201 — no duplicate infrastructure; wireless subscribers are assigned plans with speed windows
- AP command jobs use stub driver pattern matching §7 OLT/ONU — job row recorded immediately, driver execution placeholder per hardware type
- spectrum_scan_results: live hardware scanning is noted as stub (hardware-dependent), same pattern as §7 live I/O
- Interference detection via `wirelessService.detectChannelConflicts()`: queries ap_channel_plans + wireless_channel_interference, returns conflict rows grouped by AP
- Link budget: haversine → km distance → FSPL (dB) = 20·log10(d_km) + 20·log10(f_mhz) + 32.45; Fresnel radius r1 = 17.3·sqrt(d_km / (4·f_ghz)); clearance check is pure JS (no external deps)
- gps_sync_status added to snmp_metrics via ALTER TABLE — column is nullable, no migration risk
- schema.sql updated to reflect all 7 new tables; 208 total CREATE TABLE statements after §9

**Why:** All §9 Wireless/WISP items implemented and verified 2026-06-11. All verification gates passed: 89 migration tests, 0 lint errors, 0 schema parity failures, 0 spec drift (518 paths).
**How to apply:** Next free migration is 286. No open §9 gaps remain.
