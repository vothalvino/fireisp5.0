---
name: section7-ftth-olt-onu
description: §7.1–§7.4 FTTH OLT/ONU/PON/Fiber Plant — migration numbers, tables, permissions, frontend pages, what's stubbed vs real
metadata:
  type: project
---

Worktree: `C:\Users\votha\Repos\Claude fable\fireisp-wt-sec7` (branch `7-of-isp-platform-feature.md`). All §7.1–§7.4 committed.

## Tables added (208 total in schema.sql)

### §7.1/§7.2 (migrations 266–269)
- `olt_ports` — PON + uplink ports per OLT device (org-scoped, soft-delete); extended in mig-270 with 6 maintenance/xgspon columns
- `onu_profiles`, `onu_details`, `onu_optical_metrics` (no FKs), `onu_whitelist`, `onu_omci_configs`, `onu_firmware_jobs`
- `olt_vendor_capabilities` — GLOBAL (no org_id), 10 vendor seeds
- `olt_splitters` — passive optical splitter inventory

### §7.3 (migrations 270–271)
- `onu_migration_jobs` — ONU transactional port reassignment jobs (source/target olt_port FKs = RESTRICT, status lifecycle, result_detail JSON)
- olt_ports extended: maintenance_mode, maintenance_note, maintenance_by, maintenance_at, xgspon_mode ENUM, xgspon_mode_validated

### §7.4 (migrations 272–273)
- `fiber_routes` — CO→splitter→ONU path hierarchy (parent_route_id self-FK, from/to device/port/ONU/splitter FKs, gis_path JSON)
- `odf_frames` — ODF inventory per site
- `odf_ports` — ports within a frame (UNIQUE on frame+port_number, CASCADE on frame delete, FK to fiber_routes)
- `odf_cross_connects` — cross-connect records between two ODF ports (RESTRICT deletes)
- `otdr_test_results` — fault detection records (fault_type ENUM, events JSON, sor_file_path; live I/O = honest stub)
- `sfp_inventory` — SFP lifecycle (installed/spare/faulty/retired); FK to devices + inventory_items; DDM from snmp_metrics sfp_* columns (mig-255)

## Permissions
- §7.1/§7.2: 32 permissions (migrations 268)
- §7.3: 8 permissions (migration 271) — olt_ports.shutdown/configure_mode/utilization/power_budget + onu_migration_jobs.*
- §7.4: 24 permissions (migration 273) — fiber_routes.*, odf_frames.*, odf_ports.*, odf_cross_connects.*, otdr_tests.*, sfp_inventory.*

## Routes
- `/api/v1/olt-management` — ports/splitters CRUD + port utilization, ONUs list, power-budget, shutdown, xgspon-mode, onu-migrations CRUD + cancel
- `/api/v1/onu-management` — profiles CRUD, details CRUD, optical-metrics, provision, reboot, whitelist, omci-configs, firmware-jobs + cancel
- `/api/v1/fiber-plant` — fiber-routes CRUD, odf/frames CRUD (with ports sub-response), odf/ports CRUD, odf/cross-connects CRUD, otdr/tests CRUD, sfp CRUD + diagnostics endpoint

## Frontend pages
- `OltManagementPage.tsx` — tabbed: Ports + Splitters
- `OnuManagementPage.tsx` — tabbed: ONUs + optical history, Profiles, Whitelist, OMCI Configs, Firmware Jobs
- `PonPortManagementPage.tsx` — tabbed: Utilization, ONUs, Power Budget, ONU Migrations
- `FiberPlantManagementPage.tsx` — tabbed: Fiber Routes, ODF (frame+port drill-down), OTDR Tests, SFP + diagnostics panel
- Routes at `/olt-management`, `/onu-management`, `/pon-port-management`, `/fiber-plant-management` (all Technician+ guard)

## Power budget calculation
- Pure function in ftthService (no DB): SPLITTER_LOSS map (1:2=3.5 to 1:128=21), fiber_loss=(length/1000)*attenuation, total=splitter+fiber+connector, max=28 dB (GPON Class B+)

## What's stubbed (NOT live device I/O)
- ftthService records intent via DB rows; no live TL1/NETCONF/SSH sessions
- OTDR "run test" records a pending job row; no live OTDR hardware integration
- Background job processor (ftth_onu_firmware_job_processor) is seeded but not implemented
- Driver pattern: `src/services/ftth/drivers/<vendor>Driver.js` with { provision, reboot, upgradeFirmware, getOpticalDiagnostics }

## Next migration number
274 (for §8 TR-069 ACS or other future work)

**Why:** §7.3/§7.4 used 270–273. Next sequential number is 274.
