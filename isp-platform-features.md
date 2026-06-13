# ISP Management Software â€” Functions & Features Reference

> Comprehensive feature specification for an integrated ISP platform covering CRM, NMS, and Regulatory Compliance. Covers subscriber management, network operations, billing, and Mexican regulatory requirements (IFT/ATDT).

---

## Table of Contents

1. [Customer Relationship Management (CRM)](#1-crm)
2. [Billing & Subscription Management](#2-billing)
3. [RADIUS / AAA (Authentication, Authorization, Accounting)](#3-radius)
4. [PPPoE Management](#4-pppoe)
5. [Dual Stack (IPv4 + IPv6) Management](#5-dual-stack)
6. [SNMP Network Management (NMS)](#6-snmp--nms)
7. [FTTH / GPON / EPON OLT & ONU Management](#7-ftth--olt-onu)
8. [TR-069 Auto Configuration Server (ACS)](#8-tr-069-acs)
9. [Wireless / WISP Management](#9-wireless-wisp)
10. [Bandwidth & QoS Management](#10-bandwidth--qos)
11. [Customer Self-Service Portal](#11-customer-portal)
12. [Ticketing & Help Desk / NOC](#12-ticketing--noc)
13. [Network Topology & Mapping](#13-topology--mapping)
14. [Inventory & Asset Management](#14-inventory--assets)
15. [Reporting & Analytics](#15-reports--analytics)
16. [Regulatory Compliance (Mexico)](#16-compliance)
17. [Security & Access Control](#17-security)
18. [Automation & Scripting](#18-automation)
19. [Multi-Tenancy / Reseller Support](#19-multi-tenancy)
20. [APIs & Third-Party Integrations](#20-apis--integrations)
21. [AI-Powered Customer Support System](#21-ai-support)

---

## 1. CRM â€” Customer Relationship Management

### 1.1 Subscriber Profile Management
- [x] Full customer profile: name, company (RFC/CURP in Mexico), email, phone, address, GPS coordinates
- [x] Service address with map pin + geocoding
- [x] Customer classification: Residential / Business / Corporate / Government
- [x] Customer credit score / risk rating
- [x] Custom fields (unlimited) for technician notes, internal tags, etc.
- [x] Customer photo / ID document upload (INE, passport)
- [x] Family/account grouping (shared billing, family plan)
- [x] Account merging and duplicate detection

### 1.2 Customer Lifecycle
- [x] Lead capture and prospect pipeline
- [x] Service order workflow: request â†’ approval â†’ provisioning â†’ activation
- [x] Automated welcome email/SMS on activation
- [x] Customer onboarding checklist (contract signed, payment method verified, equipment received)
- [x] Contract lifecycle: create, renew, modify, suspend, terminate
- [x] Grace period management with configurable policies
- [x] Win-back campaigns for cancelled customers
- [x] Churn analytics and predictive alerts

### 1.3 Interaction Tracking
- [x] Full interaction history: calls, emails, tickets, payments, visits
- [x] Activity timeline per customer
- [x] Automated follow-up reminders
- [x] Customer satisfaction surveys (NPS, CSAT)
- [x] Escalation management for unresolved issues

### 1.4 Communication
- [x] Bulk email, SMS, WhatsApp messaging
- [x] Automated notifications: payment due, payment received, outage alerts, maintenance windows
- [x] Personalized communication templates (HTML + variables)
- [x] Delivery tracking (opened, bounced, delivered)
- [x] DND (Do Not Disturb) management per customer preference

---

## 2. Billing & Subscription Management

### 2.1 Plan & Package Management
- [x] Service plan creation: name, speed tier (download/upload), data cap, validity period
- [x] Speed profiles mapped to RADIUS attributes (MikroTik / Cisco / Juniper format)
- [x] FUP (Fair Usage Policy): throttling after data threshold
- [x] Overage billing: per-GB or plan upgrade trigger
- [x] Time-based plans: nightly unlimited, weekend boost
- [x] Bundled services: internet + VoIP + IPTV + static IP
- [x] Promotional/discount plans with auto-expiration
- [x] Tax configuration: IVA (Mexico 16%), configurable per region
- [x] Currency support with multi-currency display
- [x] Free trial plans with auto-conversion to paid

### 2.2 Invoicing
- [x] Recurring auto-generation (monthly, quarterly, annual)
- [x] Prorated billing for mid-cycle signups/cancellations
- [x] Invoice templates (branding, logo, legal text)
- [x] Invoice delivery: email, portal, printed (thermal receipt format)
- [x] Late fee automation with configurable grace periods
- [x] Credit notes and refunds
- [x] Payment reminders (pre-due, due date, overdue)
- [x] CFDI 4.0 digital tax receipts (Mexican SAT requirement)
- [x] Retention and report generation for tax authorities

### 2.3 Payment Processing
- [x] Multiple payment methods: cash, card (Stripe/PayPal/OXXO/SPEI/bank transfer)
- [x] Auto-debit / recurring card charging
- [x] Payment gateway integration
- [x] Partial payments and payment plans
- [x] Balance carry-forward and credit management
- [x] Cash reconciliation for field agents
- [x] Multi-currency support
- [x] Receipt generation (thermal printer format for convenience stores)

### 2.4 Suspension & Reactivation
- [x] Auto-suspend on X days past due
- [x] Soft suspension: slow speed (128kbps) instead of full block
- [x] Hard suspension: full disconnect
- [x] Auto-reactivation upon payment receipt
- [x] Manual override for VIP customers
- [x] Batch operations for mass suspend/reactivate
- [x] Suspension history log

### 2.5 Refunds & Disputes
- [x] Refund request workflow
- [x] Dispute tracking with evidence attachment
- [x] Chargeback management
- [x] Billing adjustment log with audit trail

---

## 3. RADIUS / AAA

### 3.1 Authentication
- [x] FreeRADIUS or equivalent RADIUS server integration
- [x] PPPoE authentication (PAP/CHAP/EAP)
- [x] 802.1X port-based authentication for enterprise clients
- [x] MAC-based authentication (MAB) for CPE auto-auth
- [x] Login/Password authentication for portals
- [x] Certificate-based authentication (EAP-TLS)
- [x] Multi-factor authentication for admin accounts

### 3.2 Authorization
- [x] Speed profile assignment via RADIUS (MikroTik rate-limit, Cisco AV-pair, Juniper filter)
- [x] IP address pool assignment (IPv4 / IPv6 / dual-stack)
- [x] Session timeout and idle timeout enforcement
- [x] Simultaneous session limits per user
- [x] Time-based access restriction
- [x] VLAN assignment via RADIUS (QinQ, C-VLAN)
- [x] Proxy-redirect / walled-garden for unpaid users
- [x] Route injection per session

### 3.3 Accounting
- [x] Real-time accounting: session start/stop/interim-update
- [x] Data usage tracking (input/output octets in RADIUS accounting)
- [x] Session duration tracking
- [x] NAS port identification (OLT PON port, switch port)
- [x] Per-session billing detail records (CDR)
- [x] Accounting stop/start on re-auth (MAC move detection)
- [x] Historical accounting data retention (configurable months)

### 3.4 NAS Management
- [x] NAS device registry (IP, secret, type, location)
- [x] MikroTik RouterOS via RADIUS CoA (Change of Authorization)
- [x] Cisco ASR / Juniper MX BNG support
- [x] PacketFence / CoA for dynamic policy changes
- [x] NAS failover and fallback configuration

---

## 4. PPPoE Management

### 4.1 Session Control
- [x] Active PPPoE session dashboard (all NAS devices)
- [x] Per-subscriber session details: username, IP, MAC, NAS, interface, uptime, data used
- [x] Active session count per NAS / per OLT / per ONU
- [x] Session search by username, IP, MAC address, NAS
- [x] Force disconnect (kill session) by admin
- [x] Auto-kick duplicate sessions
- [x] Session limit enforcement (max concurrent per user)

### 4.2 Address Pool Management
- [x] IPv4 address pool creation per NAS / per region per service type
- [x] IPv6 prefix delegation pools (/64, /56, /48)
- [x] Dynamic IP assignment and static IP reservation
- [x] IP-to-customer binding (logging for compliance)
- [x] Pool utilization monitoring and alerts at 75%/90%
- [x] Excluded IP ranges (gateway, servers, static leases)
- [x] Overlapping pool detection

### 4.3 PPPoE Service Profiles
- [x] PPPoE service name configuration per pool
- [x] MTU/MRU optimization (1492 default, configurable)
- [x] Authentication method per profile (PAP/CHAP/MSCHAPv2)
- [x] DNS server assignment per profile
- [x] Session timeout profiles
- [x] Per-profile rate limiting and firewall rules

### 4.4 Troubleshooting
- [x] PPPoE discovery stage monitoring (PADI/PADO/PADR/PADS)
- [x] Session failure logs with reason codes
- [x] LCP/NCP negotiation diagnostics
- [x] MTU mismatch detection
- [x] Authentication failure tracking (bad password, no pool, limit reached)

---

## 5. Dual Stack (IPv4 + IPv6)

### 5.1 IPv4 Management
- [x] DHCP server integration (ISC Kea, MikroTik DHCP)
- [x] Static DHCP reservations by MAC
- [x] DHCP Option 82 (Relay Agent Information) for subscriber binding
- [x] IPAM (IP Address Management): subnet planner, utilization, conflict detection
- [x] NAT management for CGNAT deployments (if applicable)
- [x] Reverse DNS (PTR) management

### 5.2 IPv6 Management
- [x] DHCPv6 server: stateful address assignment
- [x] Stateless Address Autoconfiguration (SLAAC) support
- [x] Prefix delegation (/64 per subscriber, /56 for routed home networks)
- [x] Router Advertisement (RA) management on OLT/BNG
- [x] IPv6 address pools per NAS / per OLT / per region
- [x] IPv6 /64 subnet visualization and planning
- [x] Dual-stack session correlation (IPv4 + IPv6 on same PPPoE session)
- [x] IPv6 RA Guard on switches

### 5.3 Dual Stack Session Management
- [x] Single PPPoE session carrying both IPv4 and IPv6 (IPv6CP)
- [x] Separate RADIUS attributes for v4/v6 (Framed-IP-Address + Delegated-IPv6-Prefix)
- [x] Dual-stack speed profiles (same rate limit for v4 and v6 traffic)
- [x] Per-stack accounting separation
- [x] Dual-stack DNS server assignment
- [x] v4-only, v6-only, and dual-stack plan types
- [x] NAT64/DNS64 for v6-only customers needing v4 access

### 5.4 Transition Mechanisms
- [x] 6rd (IPv6 Rapid Deployment) tunnel broker support
- [x] DS-Lite (Dual-Stack Lite) for CGNAT + IPv6 deployments
- [x] MAP-E / MAP-T mapping rules
- [x] 464XLAT support configuration templates

---

## 6. SNMP & NMS

### 6.1 Device Discovery & Onboarding
- [x] Auto-discovery via SNMP scan (seed IP + CIDR range)
- [x] Vendor-agnostic SNMP support (v1, v2c, v3)
- [x] SNMPv3 with AES-128/256 encryption and SHA authentication
- [x] Bulk device import via CSV
- [x] Device grouping by type, location, region, OLT
- [x] Custom SNMP OID polling templates
- [x] SNMP trap receiver with parsing and forwarding

### 6.2 Network Device Monitoring
- [x] MikroTik RouterOS: CPU, memory, voltage, temperature, fan speed
- [x] Cisco/Juniper BNG: interface stats, sessions, CPU, memory
- [x] Huawei/ZTE OLT monitoring (private MIBs where available)
- [x] Switch monitoring: port status, errors, utilization, PoE status
- [x] SFP/QSFP diagnostics: temperature, Tx/Rx power, vendor info, distance
- [x] UPS / PDU monitoring via SNMP
- [x] Environmental sensors (temp, humidity, water, door)

### 6.3 Interface & Traffic Monitoring
- [x] Real-time bandwidth graphing (SNMP counter polling at 30s/60s/5min intervals)
- [x] Per-interface utilization (percentage + absolute values)
- [x] Error/discards counter monitoring (CRC, input errors, output drops)
- [x] Top talkers by interface / by subscriber
- [ ] Traffic classification (adaptive to NetFlow/sFlow if available)
- [x] Graph retention: hourly (7 days), daily (90 days), monthly (3 years)

### 6.4 Polling Engine
- [x] Configurable polling intervals per device type / per metric
- [x] Distributed polling for large networks (multiple poller nodes)
- [x] SNMP bulk-get optimization for devices with many ports
- [x] Failover poller with automatic redistribution
- [x] Poller performance dashboard (poll time, timeout rate, queue depth)
- [x] Adaptive polling: increase frequency during incidents

### 6.5 Alerting & Notification
- [x] Threshold-based alerts (static and dynamic/baseline)
- [x] Alert correlation: suppress downstream alerts on upstream failure
- [x] Multi-channel notification: email, SMS, WhatsApp, Telegram, webhook
- [x] Alert escalation: L1 â†’ L2 â†’ L3 with time-based escalation
- [x] Maintenance window scheduling (suppress alerts during planned work)
- [x] Alert acknowledgment and resolution tracking
- [x] Repeat alert suppression (flapping detection)

### 6.6 Device Configuration Management
- [x] Configuration backup scheduler (daily/weekly)
- [x] Configuration diff comparison (version history)
- [ ] Rollback to previous configuration
- [x] Template-based config deployment
- [x] Scheduled config push (batch/multi-device)
- [x] Configuration compliance auditing

---

## 7. FTTH â€” OLT & ONU Management

### 7.1 OLT Management
- [x] Supported vendors: Huawei MA5800/EA5800, ZTE C300/C320/C600, VSOL V1600/W40/W80, C-Data 1600/9000, WOLCK WNM Series, Calix E7 (capability records + seed data; live protocol drivers are stubs)
- [ ] Remote management via SNMP / TL1 / NETCONF / SSH CLI (stub service interface; ftth_onu_firmware_job_processor dispatches â€” no live session driver yet)
- [x] OLT chassis monitoring: CPU, memory, temperature, PSU, fan, uplink card (GET /olt-management/:id/chassis reads from snmp_metrics)
- [x] PON port monitoring: Tx/Rx optical power, ONU count, bandwidth utilization (olt_ports table + API)
- [x] GPON/EPON/XGSPON profile management (onu_profiles table, technology enum)
- [x] Splitter management (1:8, 1:16, 1:32, 1:64, 1:128) (olt_splitters CRUD + UI)

### 7.2 ONU Management
- [x] Auto-discovery of new ONUs (plug-and-play) (ftth_onu_discovery scheduled task seeded; onu_whitelist pre-auth store; actual MAC/SN trap handler is a stub)
- [x] ONU provisioning: serial number (SN), LOID/Password, profile assignment (POST /onu-management/details/:id/provision â€” records intent in onu_firmware_jobs)
- [x] ONU profiles: service plan â†’ PON profile mapping (onu_profiles with plan_id FK, T-CONT/GEM/VLAN fields)
- [x] ONU status: online/offline/los/dying-gasp/power-off/loc (onu_state ENUM on onu_details; status badge in UI)
- [x] Per-ONU optical diagnostics: Tx power, Rx power, temperature, voltage, bias current (onu_optical_metrics table + GET /details/:id/optical-metrics + UI history table)
- [x] ONU distance measurement (ranging) (ranging_distance_m column on onu_details)
- [x] ONU firmware upgrade scheduler (batch by OLT/region) (onu_firmware_jobs with scope: single_onu/olt_port/full_olt; UI + POST /firmware-jobs)
- [x] ONU reboot remote command (POST /onu-management/details/:id/reboot â†’ job row; dispatched by processor)
- [x] ONU whitelist/blacklist by MAC or serial number (onu_whitelist with entry_type: serial/loid/mac; UI + CRUD API)
- [x] ONU line profile parameters: T-CONT, GEM port, DBA, VLAN mapping (onu_profiles fields; line_profile_name/service_profile_name on onu_details)
- [x] Bridge/router mode configuration per ONU (wan_mode column on onu_details; IPoE/PPPoE/bridged)
- [x] Wi-Fi SSID/password management via TR-069 or OMCI (onu_omci_configs: wifi_ssid, wifi_password_encrypted, wifi_band; delivery_method: omci/tr069/manual; UI + CRUD API)

### 7.3 PON Port Management
- [x] PON port utilization dashboard (getPortUtilization: onu_state_counts + optical_summary; GET /olt-management/ports/:portId/utilization)
- [x] Active/inactive ONU list per PON port (getOnusForPort with optional ?state filter; GET /olt-management/ports/:portId/onus)
- [x] Optical power budget calculation (splitter loss + fiber distance + margin) (calculatePowerBudget pure service fn; POST /olt-management/power-budget; GPON Class B+ 28 dB max)
- [x] PON port shutdown for maintenance (setPortMaintenanceMode: maintenance_mode/note/by/at columns; POST /olt-management/ports/:portId/shutdown)
- [x] ONU migration between PON ports (onu_migration_jobs table; createOnuMigrationJob with sourceâ‰ target validation; cancel endpoint)
- [x] Xingpon / XGS-PON mode configuration (configurePortXgsPonMode: xgspon_mode + xgspon_mode_validated via olt_vendor_capabilities lookup; POST /olt-management/ports/:portId/xgspon-mode)

### 7.4 Fiber Plant Management
- [x] Fiber route mapping (central office â†’ splitter â†’ ONU) (fiber_routes table with parent_route_id hierarchy, from/to FKs, gis_path JSON; full CRUD at /fiber-plant/fiber-routes)
- [x] Splitter inventory and assignment (leverages existing olt_splitters table from Â§7.1 migration 267; fiber_routes references to_splitter_id)
- [x] ODF (Optical Distribution Frame) port management (odf_frames + odf_ports + odf_cross_connects tables; GET /fiber-plant/odf/frames/:id returns frame with ports array)
- [x] OTDR integration for fault location (otdr_test_results table with fault_type ENUM, events JSON, sor_file_path; live OTDR I/O = honest stub via job records; /fiber-plant/otdr/tests CRUD)
- [x] SFP inventory and lifecycle tracking (sfp_inventory table: installed/spare/faulty/retired lifecycle; DDM diagnostics from snmp_metrics sfp_* columns (mig-255); GET /fiber-plant/sfp/:id/diagnostics)

---

## 8. TR-069 Auto Configuration Server (ACS)

### 8.1 CPE Management
- [x] Auto-provisioning of CPE on first boot (zero-touch)
- [x] Supported devices: TP-Link, ZTE, Huawei, Fiberhome, VSOL, D-Link, Netis, Tenda, and CWMP/TR-069 compliant devices
- [x] Parameter tree browsing per CPE
- [x] Read/write parameters: Wi-Fi SSID, password, channel, WAN config, firmware URL
- [x] Batch parameter push (multi-CPE)
- [x] Scheduled firmware upgrade campaigns
- [x] Firmware version inventory per model

### 8.2 Profiles & Templates
- [x] CPE profile templates per service plan
- [x] Configuration template inheritance and overrides
- [x] Automatic parameter mapping (e.g., internet VLAN â†’ WAN config)
- [x] Pre-configured templates per vendor/model

### 8.3 Diagnostics
- [x] Ping / traceroute from ACS to CPE
- [x] Wi-Fi signal strength and client count
- [x] Ethernet port status
- [x] WAN connection diagnostics
- [x] Factory reset remote command
- [x] Reboot remote command
- [x] Session log for CWMP (TR-069 protocol) communication errors

### 8.4 Inventory
- [x] CPE assignment to subscriber (auto-link via serial number/NAS port)
- [x] CPE lifecycle: in-stock â†’ assigned â†’ active â†’ returned â†’ RMA
- [x] CPE swap workflow (return old, assign new)
- [x] CPE depreciation tracking

---

## 9. Wireless / WISP Management

### 9.1 Sector / AP Management
- [x] AP registration (MikroTik, Ubiquiti, Cambium, Mimosa, Tariff, Radwin, Siklu)
- [x] Sector/AP monitoring: status, clients, noise floor, channel, frequency
- [x] Client (CPE) per AP: signal, SNR, CCQ/throughput, distance, rate
- [x] Channel planning and interference detection
- [x] Power and frequency remote adjustment
- [x] Scheduled speed profiles (day vs. night rates)

### 9.2 PTMP / PTP Links
- [x] Link planning tool (Fresnel zone, distance, frequency)
- [x] PTP link monitoring: Tx/Rx signal, modulation, throughput
- [x] Backup/failover link management

### 9.3 RF Metrics
- [x] Noise floor polling per AP
- [x] Air utilization / duty cycle per channel
- [x] Client signal strength distribution graph
- [x] Spectrum analysis integration (where hardware supports)
- [x] GPS sync monitoring for TDMA systems

---

## 10. Bandwidth & QoS Management

### 10.1 Speed Profiles
- [x] Named speed plans with download/upload rate limits
- [x] Bursty allowances ( Mb allowance over X seconds)
- [x] Time-of-day speed profiles (peak vs off-peak)
- [x] Per-queue priority (VoIP > Video > Web > Download)
- [x] Tree-based hierarchical QoS (MikroTik Queue Tree / Simple Queue)

### 10.2 Rate Limiting
- [x] Per-subscriber rate limit via RADIUS or router-side queues
- [x] Per-protocol/port shaping (torrent throttling, etc.)
- [x] Rate limit templates per service type

### 10.3 FUP / Data Caps
- [x] Monthly data cap per plan
- [x] Rollover data from previous month
- [x] FUP threshold with notification (80%, 90%, 100%)
- [x] Speed reduction after cap reached
- [x] Top-up / data pack purchase via customer portal

### 10.4 Traffic Engineering
- [x] Per-interface QoS policy
- [x] MPLS / VLAN-based traffic prioritization (for enterprise)
- [x] DSCP marking and policy
- [x] CBQ / HFSC / PCQ queue types (MikroTik-specific)
- [x] Bandwidth test server with scheduled speed tests per subscriber

---

## 11. Customer Self-Service Portal

### 11.1 Dashboard
- [x] Account overview: plan, balance, next due date
- [x] Current session status (connected/disconnected, IP, data used)
- [x] Speed tier and connection type
- [x] Real-time usage graph (daily/monthly)

### 11.2 Billing & Payments
- [x] Invoice history and PDF download
- [ ] Online payment (card, OXXO, SPEI, PayPal) â€” deferred: requires payment-gateway integration (Conekta/Stripe); models and route stubs present but no live gateway
- [x] Payment history
- [ ] Auto-debit enrollment â€” deferred: requires mandate/recurring-charge gateway support not yet wired
- [x] CFDI receipt download

### 11.3 Self-Service Actions
- [x] Change/upgrade plan (with proration)
- [x] Change Wi-Fi password
- [x] Change PPPoE password
- [x] Request static IP
- [x] Request service cancellation
- [x] Schedule installation/visit

### 11.4 Support
- [x] Open and track tickets
- [x] Knowledge base / FAQ community forum
- [x] Live chat integration
- [x] Callback request
- [x] Speed test tool (embedded, results logged)
- [x] **AI-powered chatbot for instant answers** (see Section 21)
  - [x] Answers billing questions, plan info, usage data in real time
  - [x] Diagnoses connectivity issues using live system data (NMS + RADIUS + OLT)
  - [x] If AI cannot resolve, automatically creates a human support ticket with full context
  - [ ] Always-available 24/7 first line of support via portal, WhatsApp, and mobile app â€” WhatsApp channel is out of scope for Â§11

### 11.5 Mobile
- [x] Responsive design / PWA
- [ ] Native mobile app (Android/iOS) with same features â€” explicitly out of scope per spec
- [x] Push notifications for outages and billing events

---

## 12. Ticketing & NOC

### 12.1 Ticket Management
- [x] Ticket creation: manual, auto (from alert via `POST /tickets/from-alert`), customer (from portal, existing Â§11), **AI-escalated (from chatbot, existing Â§11 `portal_chat_sessions.ticket_id`)**
- [x] **AI pre-processing on ticket creation**:
  - [x] AI reads ticket description and pulls relevant context: recent alerts on subscriber's OLT/ONU, billing status, past tickets, speed test history (via `aiReplyService.generate` â€” degrades gracefully when no LLM key configured)
  - [x] AI suggests category, priority, and possible resolution to human agent (stored in `ticket_ai_triage` table; surfaced via `GET /tickets/:id/ai-triage`; displayed in TicketDetail AI Triage panel)
  - [x] AI auto-suggests KB articles and troubleshooting steps based on ticket content (`kb_article_ids` field in `ticket_ai_triage`; KB article IDs shown in TicketDetail AI Triage panel)
- [x] Categories: outage, billing, installation, maintenance, general (`tickets.category` VARCHAR column, existing)
- [x] Priority: critical, high, medium, low (`tickets.priority` ENUM, existing)
- [x] Assignment to technician / department (`tickets.assigned_to` FK to users, existing)
- [x] SLA tracking with breach alerts (`ticket_sla_events` table + `sla_breach_check` scheduled task seeded in migration 299)
- [x] Escalation rules (time-based, priority-based) (`ticket_escalations` table + `auto_escalate_tickets` task, existing Â§1.3)
- [x] Ticket merging and linking (`POST /tickets/:id/merge` + `ticket_relations` table + `GET/POST/DELETE /tickets/:id/relations`; frontend: TicketDetail Relations panel with add/remove)
- [x] Internal notes (not visible to customer) (`ticket_comments.is_internal` flag; frontend: TicketDetail comment form includes is_internal toggle)
- [x] File attachment (photos of installation, screenshots) (dedicated `ticket_attachments` table, migration 300; `GET/POST/DELETE /tickets/:id/attachments` + `/tickets/:ticketId/attachments/:id/download`; multer disk storage 20 MB limit; frontend upload/list/delete/download in TicketDetail)
- [x] Time logging per ticket (tech work duration) (`ticket_time_logs` table + `GET/POST/PUT/DELETE /tickets/:id/time-logs`; frontend: TicketDetail Time Logs panel with add form and total display)
- [x] **AI-powered ticket summarization**: auto-generate technical summary from conversation thread (`POST /tickets/:id/ai-summary` â€” degrades gracefully when no LLM key configured; frontend: "Generate Summary" button in TicketDetail AI Triage panel)

### 12.2 NOC Dashboard
- [x] Network-wide health status (green/yellow/red) (`GET /noc/health` â€” device status counts + active alert counts by severity; frontend: `NocDashboard.tsx` panel)
- [x] Active alarm count by severity (`GET /noc/alarms` â€” `alert_events` grouped by severity; frontend: NOC Dashboard alarms panel)
- [x] Ongoing outage map (`GET /noc/outages` â€” ongoing outages grouped by site; list/grouping, no map dependency added; frontend: NOC Dashboard outages panel)
- [ ] Technician GPS tracking (mobile app) â€” GPS data ingested via `GET /technician-tracking/positions`; live map display requires a frontend map component not added (no heavy map dependency introduced per spec guidance)
- [x] Ticket queue by priority and due time (`GET /noc/ticket-queue`; frontend: NOC Dashboard queue panel)
- [x] Recent events timeline (`GET /noc/events` â€” last 50 combined alert/outage/ticket events; frontend: NOC Dashboard events panel)
- [x] SLA compliance percentage (`GET /noc/sla-compliance` â€” % non-breached over last 30 days; frontend: NOC Dashboard SLA panel)

### 12.3 Field Operations
- [x] Work order creation and dispatch (`work_orders` table + full CRUD under `/work-orders`; frontend: `WorkOrders.tsx` list/create/status-dispatch/detail view)
- [ ] Technician mobile app: view assigned jobs, navigate, log hours, take photos, capture customer signature â€” API surface implemented (`GET /work-orders`, `PATCH /work-orders/:id`, `POST /work-orders/:id/materials`, `POST /technician-tracking/breadcrumb`); native mobile app UI and offline sync are out of scope (deferred per spec guidance)
- [x] Route optimization for field visits (`POST /technician-tracking/route-optimize` â€” nearest-neighbor TSP in pure JS, no external API; frontend: WorkOrders route-optimize action)
- [x] Material usage logging (cable length, converters, etc.) (`work_order_materials` table + `GET/POST/DELETE /work-orders/:id/materials`; frontend: WorkOrders materials sub-panel; `work_order_attachments` table migration 301 for work order photos)
- [x] GPS breadcrumb tracking of technician movements (`technician_gps_breadcrumbs` table + `POST /technician-tracking/breadcrumb` + `GET /technician-tracking/:userId/history`)
- [ ] Offline capability with auto-sync â€” deferred; requires native mobile app (React Native / PWA with service worker background sync); server-side conflict-resolution endpoint not implemented

---

## 13. Topology & Mapping

### 13.1 Network Topology Map
- [x] Interactive map with all devices (OLTs, switches, routers, APs)
- [x] Link visualization with utilization color-coding
- [x] Layer switching: physical, logical, service
- [x] Zoom to region / city / street
- [x] Device search and highlight

### 13.2 Geographic Mapping
- [ ] Customer locations on map (clustered at zoom-out level) â€” locations rendered as markers; clustering at zoom-out deferred (no clustering lib added)
- [x] Service area polygon drawing
- [x] Coverage heatmaps (signal strength / client density) â€” density-weighted marker approximation, no external heatmap lib
- [x] Fiber route tracing on map
- [x] Tower / cabinet / ODF location pins
- [x] Geo-fencing alerts (device moved, CPE out of service area)

### 13.3 Dependency Mapping
- [x] Parent-child dependency relationships
- [x] Upstream failure cascade visualization
- [x] Impact analysis: "If this OLT goes down, N customers affected"
- [x] Redundancy visualization (dual-homed paths)

---

## 14. Inventory & Asset Management

### 14.1 Stock Management
- [x] Warehouses / storage locations
- [x] Product catalog: cables, converters, ONTs, routers, switches, SFP modules, splitters, fiber patch cords, connectors
- [x] Stock in/out tracking with document reference (PO, invoice)
- [x] Barcode/QR code generation and scanning
- [x] Minimum stock alerts
- [x] Stock transfer between locations

### 14.2 Lifecycle
- [x] Purchase order management
- [x] Vendor / supplier management
- [x] Warranty tracking and expiration alerts
- [x] Depreciation calculation
- [x] Disposal / write-off tracking
- [x] Asset tagging and scanning

### 14.3 Assignment
- [x] Equipment-to-customer assignment
- [x] Equipment-to-OLT/switch port assignment
- [x] Equipment swap workflow
- [x] Serial number tracking for all network equipment
- [x] RMA (Return Merchandise Authorization) workflow

---

## 15. Reporting & Analytics

### 15.1 Financial Reports
- [x] Revenue by period (daily, weekly, monthly, quarterly, annually)
- [x] Revenue by plan type, region, sales agent
- [x] Outstanding receivables aging report
- [x] Cash flow report
- [x] Payment method breakdown
- [x] Churn revenue impact
- [x] Agent commission calculations
- [x] Tax reports (IVA, ISR)
- [x] SAT-compliant reports for Mexico

### 15.2 Operational Reports
- [x] Subscriber count (active, suspended, cancelled) over time
- [x] Subscriber net growth / churn rate
- [x] Average revenue per user (ARPU)
- [x] Bandwidth utilization per OLT / per link / per region
- [x] Top 10 customers by consumption
- [x] Uptime/downtime per service area
- [x] Mean Time To Repair (MTTR)
- [x] Installation completion reports

### 15.3 Network Reports
- [x] Top congested links
- [x] SFP lifespan and replacement forecast
- [x] Optical power degradation trends
- [x] Reboot frequency per device
- [x] SNMP polling success rate
- [x] Alert frequency and resolution time
- [x] Capacity planning forecast (subscriber growth vs. available capacity)
- [x] PON port utilization forecast

### 15.4 Compliance Reports
- [x] Data retention compliance report
- [x] IP assignment log (court order ready)
- [x] Subscriber identity verification report
- [x] Traffic interception capability readiness
- [x] Regulatory filing data export

### 15.5 Report Engine
- [x] Scheduled report generation (daily/weekly/monthly)
- [x] Export formats: PDF, Excel (XLSX), CSV
- [x] Dashboard widgets with drag/drop layout
- [x] Custom report builder (SQL-based or visual)
- [x] Email report delivery to stakeholders

---

## 16. Regulatory Compliance (Mexico)

### 16.1 Legal Framework (Reference)
- [x] **Ley Federal de Telecomunicaciones y Radiodifusion (LFTR)** â€” governing law
- [x] **IFT (Instituto Federal de Telecomunicaciones)** â€” replaced July 2025 by new regulatory bodies:
  - [x] **ATDT** (Agencia de Transformacion Digital y Telecomunicaciones) â€” policy, licensing, spectrum
  - [x] **CRT** (Comision Reguladora de Telecomunicaciones) â€” regulatory enforcement, compliance, sanctions
- [x] **Ley Federal de Proteccion de Datos Personales en Posesion de los Particulares (LFPDPPP)** â€” data privacy
- [x] **Codigo Penal Federal** â€” telecommunications crimes
- [x] **CFDI 4.0** â€” SAT digital invoicing requirements

### 16.2 User Data Management
- [x] Customer identity verification (INE/IFE or CURP validation)
- [x] Registration of all subscriber details per legal requirements
- [x] Personal consent tracking for data processing (LFPDPPP Aviso de Privacidad)
- [x] Data subject access request (DSAR) handling
- [x] Right to erasure (with legal hold exceptions)
- [x] Data minimization and purpose limitation enforcement

### 16.3 IP Log Retention & Interception
- [x] **Mandatory IP-to-subscriber mapping log retention** (per Mexican telecom law)
  - [x] Minimum retention period: per current legislation (verify with ATDT/CRT for latest)
  - [x] Log: timestamp, subscriber ID, IP address, session start/end, NAS identifier
  - [x] Tamper-proof storage with integrity checks (WORM/append-only)
- [x] **Lawful interception capability**:
  - [x] Real-time traffic mirroring capability on request from authorities
  - [x] IP assignment traceability (which subscriber had which IP at what time)
  - [x] CDR (Call Detail Records) export in required format
  - [x] API endpoint for authorized law enforcement queries
  - [x] Audit log of all government data requests

### 16.4 Numbering and Addressing
- [x] Phone number inventory management (if offering VoIP)
- [x] Number portability support
- [x] CNMC (Mexican numbering) block management
- [x] Address standardization (SEPOMEX / INEGI codes)

### 16.5 Quality of Service Requirements
- [x] SLA monitoring against regulatory minimums
- [x] Complaint handling with mandated response times
- [x] Service availability tracking
- [x] Speed guarantee monitoring (advertised vs. delivered)
- [x] Quarterly/annual compliance report generation

### 16.6 Universal Service Contribution
- [x] Tracking of universal service obligations
- [x] Rural deployment reporting contribution tracking
- [x] Social coverage metrics (underserved areas)

### 16.7 Consumer Protection (PROFECO)
- [x] Terms of service / contract template management
- [x] Mandatory consumer right information
- [x] Dispute resolution tracking
- [x] Service modification notification tracking (regulatory-mandated notice periods)

### 16.8 Data Localization
- [x] Primary data storage within Mexico (recommended; verify latest ATDT/CRT rules)
- [x] Backup and disaster recovery location compliance
- [x] Cross-border transfer restrictions monitoring

### 16.9 Audit Trail
- [x] Complete audit log for all system actions
- [x] Admin action logging (who deleted/modified what and when)
- [x] Report access logging (who downloaded subscriber data)
- [x] Retention period compliance automation
- [x] Read-only audit export for regulatory inspections

---

## 17. Security & Access Control

### 17.1 User Management
- [x] Admin user accounts with role-based access control (RBAC)
- [x] Roles: super admin, billing admin, NOC operator, technician, read-only auditor, reseller admin
- [x] 2FA / MFA support (TOTP, hardware key)
- [x] Session timeout and idle lock
- [x] IP-based whitelisting for admin access
- [x] Password policy enforcement (length, complexity, rotation)

### 17.2 API Security
- [x] API key management with per-key permissions
- [x] OAuth 2.0 / JWT token authentication
- [x] Rate limiting per API key
- [x] IP whitelist for API access
- [x] Audit log of all API calls
- [x] Webhook signing verification

### 17.3 Network Security
- [x] Firewall rule management for each subscriber pool
- [x] DDoS protection integration (Flowspec, RTBH)
- [x] Blackhole routing for attacked subscribers
- [x] DNS blocklist management (malware/phishing domains)
- [x] CPE security scanning (default password detection)

### 17.4 Data Security
- [x] Encryption at rest (AES-256) for PII and financial data
- [x] TLS 1.3 for all communication
- [x] Database backup encryption
- [x] Key management and rotation policy
- [x] Data masking for non-privileged users
- [x] Secure deletion of expired retention data

---

## 18. Automation & Scripting

### 18.1 Workflow Automation
- [x] Event-triggered rules (if X then Y)
- [x] Scheduled tasks (cron-based)
- [x] Batch subscriber operations (suspend, rate-limit, send notification)
- [x] Auto-provisioning pipeline: order â†’ assign IP â†’ configure â†’ activate â†’ notify
- [x] Auto-remediation scripts (e.g., reboot ONU if offline > 5 min)

### 18.2 Scripting Engine
- [x] Built-in script editor (Bash / Python / PowerShell)
- [x] Script library with community/shared scripts
- [x] Script execution logging and error handling
- [x] API call from within scripts (to platform APIs and external)
- [x] Scheduler for recurring scripts

### 18.3 Router API Integration
- [x] MikroTik RouterOS API (primary)
- [x] Cisco IOS/IOS-XE SSH / RESTCONF
- [x] Juniper JunOS NETCONF / REST
- [x] ZTE/Huawei OTL TL1 / SSH / NETCONF
- [x] REST API for modern NMS devices

### 18.4 AI / ML â€” NMS & Operations Analytics (summary)
- [x] Anomaly detection on traffic patterns
- [x] Predictive failure analysis (SFP degradation, ONU failure)
- [x] Smart alert correlation and noise reduction
- [x] Bandwidth forecasting (capacity planning)
- [x] Churn prediction scoring
- [ ] **Full AI-powered customer support system â€” see Section 21**

---

## 19. Multi-Tenancy / Reseller Support

### 19.1 Roles & Permissions
- [x] Multi-level reseller hierarchy (ISP â†’ Master Reseller â†’ Sub-Reseller â†’ Customer)
- [x] Each reseller sees only their own customers, devices, and revenue
- [x] Reseller-branded customer portal (white-label)
- [x] Custom pricing per reseller
- [x] Commission/profit tracking per reseller

### 19.2 Resource Allocation
- [x] IP pool allocation per reseller
- [x] Bandwidth allocation per reseller
- [x] OLT / PON port assignment per reseller
- [x] Separate billing per reseller entity
- [x] Separate reporting per reseller

### 19.3 Reseller Portal
- [x] Dashboard with their subscriber count, revenue, tickets
- [x] Customer management (create, suspend, cancel)
- [x] Invoice generation under their own brand
- [x] Stock management for their assigned equipment

---

## 20. APIs & Integrations

### 20.1 Core REST API
- [x] Full CRUD for: customers, plans, invoices, tickets, devices, OLTs, ONUs, sessions
- [x] Pagination, filtering, sorting on all endpoints
- [x] Webhooks for event notification (payment received, outage, new subscriber)
- [x] OpenAPI/Swagger documentation
- [x] Rate limiting and throttling

### 20.2 Third-Party Integrations
- [x] **Accounting**: QuickBooks, ContPAQi (Mexico), SAP, ERPNext
- [x] **Payment Gateways**: Stripe, PayPal, Conekta (Mexico), Openpay, MercadoPago, OXXO Pay
- [x] **Communication**: Twilio, Vonage (SMS), WhatsApp Business API, SendGrid (email)
- [x] **Maps**: Google Maps, OpenStreetMap, MapBox
- [x] **Monitoring**: Zabbix, Prometheus, Grafana, PRTG (bidirectional sync)
- [x] **Helpdesk**: Zendesk, Freshdesk, osTicket (import/export)
- [x] **Tax/SAT**: CFDI 4.0 PAC (Proveedor Autorizado de Certificacion) integration
- [x] **LoRaWAN**: ChirpStack API integration for IoT farm sensors

## 21. AI-Powered Customer Support System

### 21.1 Overview & Philosophy
The AI support system acts as the **first line of customer contact** 24/7. Its goal is to resolve as many issues as possible without human intervention while ensuring a seamless handoff to a human agent when needed. The AI has **read-only and diagnostic access** to the entire platform (NMS for fiber and wireless, RADIUS, OLT, AP/sector monitoring, CRM, billing, TR-069) so it can give accurate, real-time answers for **both FTTH fiber and WISP wireless subscribers**.

**Core principle**: AI answers when it knows. Human answers when AI doesn't.

### 21.2 AI Query Routing Engine

Every incoming customer message (portal chat, WhatsApp, email, SMS, voice) goes through the routing engine:

```
Customer sends message
        |
   [Intent Classifier]
        |
   +----+----+----+
   |         |    |
 Billing  Tech   Other
   |         |    |
  [AI     [AI    [AI
  Module]  Module] Module]
   |         |    |
  Can      Can    Can
  resolve? resolve? resolve?
   |         |    |
   YES      YES    YES
   |         |    |
 [Answer]  [Answer] [Answer]
   |         |    |
   NO       NO     NO
   |         |    |
   +----+----+----+
        |
   [HANDOFF TO HUMAN]
   (with full AI context summary)
```

#### Handoff Escalation Rules
- [x] AI cannot resolve after 2 attempts â†’ escalate to human
- [x] Customer explicitly asks for "agent" / "humano" â†’ immediate escalate
- [x] Detected frustration (negative sentiment, repeated issue) â†’ escalate
- [x] Billing dispute or refund request â†’ escalate to billing team
- [x] VIP / enterprise customer â†’ always offer human agent option
- [x] Issue involving outage affecting >N subscribers â†’ escalate to NOC + notify all affected
- [x] All escalations include: AI conversation summary, customer context, attempted solutions, relevant system data

### 21.3 AI Module â€” Billing & Account

**Data sources**: CRM, billing engine, payment gateway, subscription database

**Capabilities**:
- [x] "What's my balance?" â†’ reads account balance in real time
- [x] "When is my next payment due?" â†’ reads next billing date
- [x] "I want to upgrade my plan" â†’ shows available plans with pricing, handles upgrade with prorated charge
- [x] "How much data have I used this month?" â†’ reads RADIUS accounting data
- [x] "I was overcharged" â†’ pulls invoice details, compares with plan, initiates refund if mismatch confirmed
- [x] "I want to cancel" â†’ explains cancellation process, offers retention discount, processes if confirmed
- [x] "Can I pay at OXXO?" â†’ sends payment barcode/reference number
- [x] "I need my CFDI receipt" â†’ generates and links CFDI PDF
- [x] "Change my service address" â†’ updates CRM, checks service availability at new address
- [x] "What plans do you have?" â†’ lists plans with speeds, prices, data caps in customer's language

**Language support**: Spanish (primary for Mexico), English, with regional slang understanding

### 21.4 AI Module â€” Technical Diagnostics & Troubleshooting

The AI tech diagnostic module works for **both FTTH (fiber) and WISP (wireless) subscribers**. The first thing it checks is the **subscriber's access type** (fiber/PPPoE vs. wireless/CPE-AP link) and runs the appropriate diagnostic branch.

**Data sources (FTTH fiber)**: SNMP NMS, RADIUS, OLT/ONU management, TR-069 ACS, alert database
**Data sources (WISP wireless)**: SNMP NMS, RADIUS, AP/sector monitoring (signal/SNR/CCQ), CPE status, wireless link metrics, alert database

---

#### 21.4a â€” Diagnostic: "My internet is slow" (FTTH Fiber)

1. Checks if subscriber's PPPoE session is active
2. Checks assigned speed profile vs. plan (mismatch?)
3. Reads recent speed test results from subscriber
4. Checks subscriber's ONU optical signal (Rx power within range?)
5. Checks if OLT PON port has alerts (degraded signal, high utilization)
6. Checks subscriber's router/CPE status via TR-069 (Wi-Fi channel congestion? firmware outdated?)
7. Checks if subscriber is hitting data cap / FUP threshold
8. Checks for active outages in subscriber's area
â†’ Returns diagnostic result with specific cause and fix, or escalates

#### 21.4b â€” Diagnostic: "My internet is slow" (WISP Wireless)

1. Checks if subscriber's PPPoE session is active (or DHCP session)
2. Checks assigned speed profile vs. plan (mismatch?)
3. Reads recent speed test results from subscriber
4. Checks which AP/sector the subscriber's CPE is connected to
5. Reads CPE signal strength, SNR, and CCQ/throughput from AP monitoring
6. Checks AP/sector load â€” how many clients on same AP? Is sector overloaded?
7. Checks for RF interference or channel congestion on that channel/frequency
8. Checks CPE alignment (if PTP: antenna alignment, Fresnel zone obstruction)
9. Checks CPE firmware version via TR-069
10. Checks if subscriber is hitting data cap / FUP threshold
11. Checks for weather conditions affecting wireless links (heavy rain on 5 GHz = rain fade)
â†’ Returns: "Your signal has dropped from -55 dBm to -72 dBm â€” tree/antenna misalignment likely." OR "Your sector has 48 active clients (capacity 50). Consider upgrading our Turbo plan." OR "CPE firmware is 2 versions behind; scheduling upgrade."

#### 21.4c â€” Diagnostic: "I have no internet" (FTTH Fiber)

1. Checks PPPoE session status (connected? authentication error?)
2. Checks ONU status (online? LOS? power-off?)
3. Checks OLT PON port (active? any alarms?)
4. Checks RADIUS authentication logs (rejected? bad password? expired?)
5. Checks account status (suspended due to non-payment?)
6. Checks for area-wide outage
â†’ Returns result: "Your ONU is offline (no light). Please check power cable." OR "Your account is suspended due to unpaid balance of $XXX. Pay now?" OR "There's an outage in your area, ETA 2 hours."

#### 21.4d â€” Diagnostic: "I have no internet" (WISP Wireless)

1. Checks PPPoE/DHCP session status
2. Checks RADIUS authentication logs (rejected? bad password? expired?)
3. Checks account status (suspended due to non-payment?)
4. Checks if subscriber's CPE is visible on any AP
5. If CPE not visible on any AP â†’ CPE offline or misaligned
6. If CPE visible but no session â†’ RADIUS or plan issue
7. Checks for AP/sector outage (AP down? sector down? backhaul link down?)
8. Checks weather alerts (storm = signal fade)
â†’ Returns: "Your CPE is not showing on our network. Please check power and antenna direction." OR "Your AP (Tower-X Sector 2) is currently down for maintenance, ETA 1 hour." OR "Your building materials may be blocking signal; let's try a different CPE location."

#### 21.4e â€” Diagnostic: "My Wi-Fi doesn't work" (Both Fiber & WISP)

1. Checks CPE/Wi-Fi router via TR-069 (online? SSID broadcasting?)
2. Reads Wi-Fi channel and client count
3. Detects if Wi-Fi password was recently changed (via account)
4. Suggests: restart router, check Wi-Fi password, move device closer
5. If CPE offline â†’ restart via TR-069
â†’ If unresolved after steps â†’ escalate with full diagnostic dump

#### 21.4f â€” Diagnostic: "My internet disconnects frequently"

*Fiber branch:*
1. Reads RADIUS session history (frequent drops?)
2. Checks ONU optical signal stability (fluctuating Rx power = fiber issue)
3. Checks OLT PON port error counters
4. Checks CPE uptime and reboot frequency
â†’ Returns possible cause: fiber splice issue, CPE overheating, ONU failing, etc.

*Wireless branch:*
1. Reads RADIUS session history (frequent drops?)
2. Checks CPE signal fluctuation pattern (intermittent fade = alignment or obstruction)
3. Checks AP uptime and reboot events (channel change? firmware reload?)
4. Checks for interference events (new AP on same channel detected?)
â†’ Returns: "Your signal fluctuates between -60 and -78 dBm â€” likely antenna movement or new obstruction. Recommend re-alignment." OR "Your AP changed channel from 5180 to 5220 at 3 AM â€” CPE may need manual reconnect."

#### 21.4g â€” Diagnostic: "I can connect to the internet but very slowly at night" (Both)

*Fiber branch:* Checks PON port utilization during peak hours â€” if >85%, PON is congested.

*Wireless branch:* Checks AP client count during peak hours â€” if near capacity, subscribers share bandwidth. Checks if night-time rates differ from plan.

â†’ Returns: "Your PON port serves 45 users and is at 89% capacity during 7-11 PM. Upgrade available for dedicated bandwidth." OR "Your sector has 1 free slot remaining. During peak hours bandwidth is shared â€” upgrade plan for guaranteed speed."

---

#### AI Module â€” Technical: What It CAN Diagnose Automatically

| Issue | Access Type | Data Used | Auto-Fix? |
|---|---|---|---|
| Account suspended (non-payment) | Both | Billing + CRM | Prompt payment link |
| Bad password | Both | RADIUS auth log | Password reset flow |
| Data cap reached | Both | RADIUS accounting | Offer top-up |
| ONU offline (power) | Fiber | OLT ONU status | Guide user to check power |
| ONU LOS (fiber cut) | Fiber | OLT optical alarm | Create ticket + notify NOC |
| CPE offline (no power) | Both | AP monitoring / TR-069 | Guide user to check power |
| CPE misaligned / no signal | WISP | AP CPE signal/SNR | Guide re-alignment |
| CPE Wi-Fi off | Both | TR-069 | Remote Wi-Fi toggle |
| CPE needs reboot | Both | TR-069 + uptime | Remote reboot |
| OLT PON port overloaded | Fiber | SNMP utilization | Suggest plan migration |
| AP/sector overloaded | WISP | AP client count + throughput | Suggest sector split or upgrade |
| Sector down / AP offline | WISP | NMS AP monitoring | Notify ETA + dispatch tech |
| Area outage | Both | NMS alerts | Notify ETA |
| CPE firmware outdated | Both | TR-069 inventory | Schedule upgrade |
| PPPoE session limit exceeded | Both | RADIUS | Explain + offer upgrade |
| IPv6 not working | Both | DHCPv6 + RA checks | Config guide or fix |
| Account speed mismatch | Both | RADIUS + plan DB | Fix RADIUS profile |
| RF interference on channel | WISP | AP noise floor + scan | Suggest channel change to admin |
| Rain fade / weather impact | WISP | Weather API + signal logs | Inform customer, wait for weather |
| Antenna/cable physical damage | Both | Field report from customer | Schedule technician |
| Fiber splitter port issue | Fiber | OLT PON diagnostics | Create NOC ticket |

#### AI Module â€” Technical: When It MUST Escalate

*Fiber-specific:*
- [x] Physical fiber damage requiring field team (cable cut, splitter failure)
- [x] OLT hardware failure requiring replacement
- [x] ONU replacement (physical swap)
- [x] Fiber splicing / ODF work
- [x] New drop cable installation

*Wireless-specific:*
- [x] Antenna/CPE physical re-alignment requiring tower/climb crew
- [x] New sector / AP installation
- [x] Pole / tower structural issue
- [x] Tree trimming / obstruction removal
- [x] PTP link re-alignment (both ends)

*Both / General:*
- [x] Legal/regulatory questions
- [x] Complex billing disputes
- [x] Customer requests technician visit
- [x] Anything requiring physical equipment swap
- [x] Issue affecting entire node/subnet/sector (escalate to NOC, notify all)
- [x] AI confidence below 60%

### 21.5 AI Module â€” General & Account Management

- [x] "How do I change my Wi-Fi password?" â†’ Step-by-step guide + offer to do it via TR-069
- [x] "What's my IP address?" â†’ Reads RADIUS session, returns current IP
- [x] "I need a static IP" â†’ Checks eligibility, explains pricing, processes request
- [x] "How do I set up port forwarding?" â†’ Provides CPE-specific guide (model aware)
- [x] "I'm moving, can I transfer my service?" â†’ Checks serviceability at new address, schedules transfer
- [x] "Can I get service at my address?" â†’ Checks coverage map for fiber availability + wireless LOS (line of sight)
- [x] "What are your business hours?" â†’ Provides branch/agent locations and hours
- [x] "I want to report a damaged cable/pole/antenna" â†’ Creates ticket with GPS from customer profile + access type (fiber or wireless)
- [x] "My antenna/CPE was knocked by wind" â†’ Schedules re-alignment visit (wireless) or drop cable check (fiber)
- [x] "A tree grew in front of my antenna" â†’ Creates obstruction report, schedules site survey
- [x] "How far is the nearest tower/AP?" â†’ Returns sector info and estimated signal based on distance
- [x] Complaint about technician behavior â†’ Escalates immediately to management with all context

### 21.6 Conversation Channels & Interface

| Channel | AI Available | Human Handoff | Notes |
|---|---|---|---|
| Web portal chat | 24/7 | Chat transfer to agent | Primary channel |
| WhatsApp Business | 24/7 | Agent takes over WhatsApp | Most popular in Mexico |
| Mobile app chat | 24/7 | Push notification to agent | Same chat, same thread |
| Email | Auto-reply with AI analysis | Agent responds directly | AI drafts suggested reply for agent |
| SMS (shortcode) | 24/7 | Agent sends SMS back | Limited to short responses |
| Phone (IVR + voice) | Voice AI (TTS/STT) | Transfer to agent | Natural language voice bot |
| Social media (FB, X) | Monitoring + reply | Agent handles complex | Brand reputation protection |

### 21.7 AI Engine Architecture

```
[Customer Message]
       |
   +---+---+
   |       |
   STT    Text
   |       |
   +---+---+
       |
[Language Detection + Translation]
       |
[Intent Classification + Entity Extraction]
       |
[Context Enrichment]
  - CRM: customer profile, balance, plan, tickets, **access type (fiber/WISP)**
  - NMS (Fiber): OLT/ONU status, PON port, alerts, optical signal
  - NMS (Wireless): AP/sector status, CPE signal/SNR/CCQ, channel utilization, interference
  - RADIUS: session status, IP, data usage
  - Billing: invoices, payments, plan details
  - TR-069: CPE status, Wi-Fi, firmware
  - Coverage map: fiber availability at address, wireless LOS availability
  - Alert DB: current outages and maintenance
       |
[Response Generation]
  - Structured response from known templates (billing, plan info)
  - Dynamic diagnostic response from system queries
  - Empathetic handoff message when escalating
       |
[Confidence Scoring]
  - >85% confidence â†’ Send answer directly
  - 60-85% confidence â†’ Send answer + offer human help
  - <60% confidence â†’ Handoff to human immediately
       |
[Output: Text / TTS / WhatsApp / Portal / Mobile]
```

#### Technology Stack (AI Layer)
- [x] **LLM backend**: OpenAI GPT-4o / Claude Sonnet / self-hosted LLM (Llama 3.2 via llama.cpp for data sovereignty)
- [x] **Self-hosted option**: Llama 3.2-70B or Qwen3.6-27B on local GPU (NVIDIA RTX PRO 6000) â€” keeps customer data in Mexico, no API fees
- [x] **Vector DB**: Qdrant or Milvus for KB embeddings (knowledge base articles, past tickets, SOPs)
- [x] **RAG pipeline**: Retrieves relevant KB docs, past ticket resolutions, SOPs before generating response
- [x] **Fine-tuning**: LLM fine-tuned on ISP-specific terminology, Mexican Spanish, company policies
- [x] **STT**: Whisper (open source) for voice calls
- [x] **TTS**: Edge TTS or ElevenLabs for voice responses
- [x] **Webhook bridge**: All AI modules call platform REST API to read system state

### 21.8 Knowledge Base & Training Data

The AI must be trained on:
- [x] **Company knowledge base**: FAQ, service plans, coverage areas (fiber + wireless), pricing, policies
- [x] **Past ticket resolutions**: Anonymized historical tickets and their solutions â€” both FTTH and WISP (vector DB)
- [x] **Technical SOPs**:
  - [x] FTTH: "PPPoE session not starting" â†’ check RADIUS auth log â†’ check ONU status â†’ check account status
  - [x] WISP: "CPE not connecting" â†’ check CPE visible on any AP â†’ check signal/SNR â†’ check RADIUS â†’ check alignment â†’ check weather
- [x] **Network topology**:
  - [x] Fiber: AI knows which OLT/ONU serves each customer, understands PON port â†’ splitter â†’ ONU relationships
  - [x] Wireless: AI knows which AP/sector covers each customer, understands tower â†’ sector â†’ CPE relationships, Fresnel zone, distance, antenna types
- [x] **Coverage maps**: Fiber serviceability by address; wireless LOS (line of sight) availability, tower locations, sector azimuth/bearing
- [x] **Regulatory FAQ**: PROFECO rights, CFDI requirements, cancellation policy (Mexican law)
- [x] **Product documentation**: ONU/CPE user guides, AP/CPE antenna guides (Ubiquiti, MikroTik, Cambium, Mimosa), Wi-Fi configuration steps, alignment guides
- [x] **Real-time system state**: NMS alerts (OLT/AP), RADIUS sessions, ONU/CPE status, AP noise floor, weather data (not training data â€” live queries)
- [x] **Common responses (templates)**: Pre-approved responses for frequent scenarios (both fiber and wireless) to ensure consistency

**Continuous learning**:
- [x] Every resolved AI conversation is logged (anonymized)
- [x] Tickets that required human escalation are flagged for KB improvement
- [x] Monthly KB review: new articles added for emerging issues
- [x] A/B testing of AI responses for resolution rate optimization
- [x] Human agents can mark AI responses as "helpful" or "wrong" â†’ feedback loop

### 21.9 AI Guardrails & Safety

- [x] **Never access raw customer PII** in LLM context â€” use customer ID references internally, resolve PII only for response
- [x] **Never make billing adjustments without explicit customer confirmation** â€” AI proposes, customer confirms
- [x] **Never reveal internal system details** (SNMP community strings, RADIUS secrets, server IPs, internal IPs)
- [x] **Never impersonate a human** â€” always identify as "AI assistant" or virtual agent
- [x] **Never make promises** ("I guarantee your internet will be back in 5 minutes") â€” use "typically" / "usually"
- [x] **Escalate on legal/regulatory topics** â€” AI should NOT give legal advice
- [x] **Rate limit per customer** â€” max N AI interactions per hour to prevent abuse
- [x] **Log everything** â€” all AI conversations logged with timestamps, confidence scores, data sources accessed
- [x] **Prompt injection protection** â€” customer messages sanitized before LLM context injection
- [x] **Retention policy** â€” AI conversation logs subject to same data retention rules as CRM data (Section 16)

### 21.10 Performance Metrics & KPIs

| Metric | Target | Description |
|---|---|---|
| **AI Resolution Rate** | >70% | % of contacts resolved without human |
| **First Contact Resolution (FCR)** | >75% | Resolved on first AI interaction |
| **Average AI Handle Time** | <2 min | Time from message to answer |
| **Escalation Rate** | <30% | % escalated to human |
| **Customer Satisfaction (AI)** | >4.0/5.0 | Post-interaction CSAT for AI |
| **False Positive Rate** | <5% | AI gave wrong/misleading answer |
| **Response Latency** | <3 seconds | Time from customer message to AI reply |
| **Self-Service Adoption** | >50% | % of customers using AI chatbot vs. calling |
| **Cost Per Contact (AI)** | <$0.10 | vs. $3-5 for human agent |
| **Escalation Quality** | >90% | Human agents rate AI context summary as useful |

### 21.11 NOC AI Assistant (Internal)

Beyond customer-facing AI, the same engine assists NOC staff:

*Fiber examples:*
- [x] **Alert explanation**: "OLT-X PON port 3/1/5 Rx power dropped 5 dB" â†’ AI correlates: "This is affecting 23 subscribers. One ONU (SN:XXX) shows Rx -28 dB (near threshold). Last fiber splice at splitter 3B. Recommend check splice."
- [x] **Capacity warning**: "PON port 2/1/7 at 82% utilization. At this growth rate (3%/month), will hit 95% in 5 months. Recommend preemptive split or OLT upgrade."

*Wireless examples:*
- [x] **Alert explanation**: "AP Tower-3 Sector 2 (5.8 GHz) â€” 3 CPEs dropped in last 10 min" â†’ AI correlates: "Signal dropped 8 dB across all 3 CPEs simultaneously. Weather radar shows heavy rain cell moving through. Likely rain fade. Will recover when weather clears."
- [x] **Interference detection**: "AP Tower-1 Sector 1 noise floor increased from -95 to -82 dBm on channel 5180" â†’ AI correlates: "New AP detected on same channel 2.3 km away (ISP competitor or new deployment). Recommend channel change to 5220 or 5745."
- [x] **Capacity warning**: "AP Tower-2 Sector 3 at 47/50 clients. Average throughput per client dropped to 4 Mbps (plan: 10 Mbps). Recommend sector split or new AP deployment."
- [x] **Alignment drift**: "CPE SN:XXX signal trending down 0.5 dB/day over 2 weeks. Current: -71 dBm (threshold: -75 dBm). Recommend schedule re-alignment visit before signal drops below threshold."

*General:*
- [x] **On-call summary**: At shift change, AI generates summary of all open issues, ongoing outages, tickets pending
- [x] **Runbook suggestion**: AI suggests troubleshooting steps based on alert type (learns from past NOC actions)


---

## Appendix A â€” Architecture Recommendations

### High Availability
- [x] Database: PostgreSQL with streaming replication (primary + read replica)
- [x] Application: Load-balanced app servers (2+ behind HAProxy/Nginx)
- [x] Redis for caching and session management (Redis Sentinel for HA)
- [x] Shared storage or block-level replication for file attachments
- [x] Automated failover with health checks

### Performance Targets
- [x] 10,000 subscribers: single server (4 vCPU, 8GB RAM) sufficient
- [x] 50,000+ subscribers: distributed architecture required
- [x] SNMP polling: <30s per device at 10,000 devices (requires multiple pollers)
- [x] Page load: <2 seconds for all dashboard pages
- [x] API response: <200ms for CRUD operations

### Recommended Stack (Budget-Oriented)
- [x] Backend: Python (Django/FastAPI) or PHP (Laravel) â€” both proven in ISP stacks
- [x] Database: PostgreSQL (primary) + Redis (cache)
- [x] Frontend: Vue.js / React (SPA dashboard) + Nginx
- [x] RADIUS: FreeRADIUS 3.x with MySQL/PostgreSQL backend
- [x] NMS: Custom SNMP poller + LibreNMS/Zabbix integration
- [x] Queue: RabbitMQ / Redis for async tasks
- [x] Storage: MinIO (S3-compatible, self-hosted) for file backups

### Scalability Considerations
- [x] Horizontal scaling for polling engine (add poller nodes)
- [x] Database partitioning by date for accounting records
- [x] CDN for static assets and customer portal
- [x] Containerized deployment (Docker / Docker Compose) for easy scaling

---

## Appendix B â€” Compliance Checklist (Mexico)

- [x] Subscriber identity capture (INE/IFE/CURP)
- [x] LFPDPPP Aviso de Privacidad displayed and accepted
- [x] IP-to-subscriber log retention configured and verified
- [x] Log integrity protection (append-only / WORM)
- [x] Lawful interception capability documented and operational
- [x] CFDI 4.0 invoicing integration with PAC
- [x] Tax regimen facturacion (regimen fiscal) properly configured
- [x] Complaint response SLA configured
- [x] Consumer terms template compliant with PROFECO
- [x] Data backup within Mexican territory (verify latest rules)
- [x] Audit trail activated for all administrative actions
- [x] Access control policy documented and enforced
- [x] Incident response plan documented
- [x] Annual compliance self-assessment scheduled
- [x] ATDT/CRT registration and licensing up to date

---

*Document version: 1.1 | Created: 2026-05-31 | Updated: 2026-05-31 (added Section 21 AI Support)*
*Next review: After ATDT/CRT regulatory updates are published*
