# ISP Management Software — Functions & Features Reference

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

## 1. CRM — Customer Relationship Management

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
- [x] Service order workflow: request → approval → provisioning → activation
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
- [ ] SNMPv3 with AES-128/256 encryption and SHA authentication
- [ ] Bulk device import via CSV
- [x] Device grouping by type, location, region, OLT
- [x] Custom SNMP OID polling templates
- [x] SNMP trap receiver with parsing and forwarding

### 6.2 Network Device Monitoring
- [x] MikroTik RouterOS: CPU, memory, voltage, temperature, fan speed
- [ ] Cisco/Juniper BNG: interface stats, sessions, CPU, memory
- [ ] Huawei/ZTE OLT monitoring (private MIBs where available)
- [ ] Switch monitoring: port status, errors, utilization, PoE status
- [x] SFP/QSFP diagnostics: temperature, Tx/Rx power, vendor info, distance
- [x] UPS / PDU monitoring via SNMP
- [x] Environmental sensors (temp, humidity, water, door)

### 6.3 Interface & Traffic Monitoring
- [x] Real-time bandwidth graphing (SNMP counter polling at 30s/60s/5min intervals)
- [x] Per-interface utilization (percentage + absolute values)
- [x] Error/discards counter monitoring (CRC, input errors, output drops)
- [x] Top talkers by interface / by subscriber
- [ ] Traffic classification (adaptive to NetFlow/sFlow if available)
- [ ] Graph retention: hourly (7 days), daily (90 days), monthly (3 years)

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
- [x] Alert escalation: L1 → L2 → L3 with time-based escalation
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

## 7. FTTH — OLT & ONU Management

### 7.1 OLT Management
- [ ] Supported vendors: Huawei MA5800/EA5800, ZTE C300/C320/C600, VSOL V1600/W40/W80, C-Data 1600/9000, WOLCK WNM Series, Calix E7
- [ ] Remote management via SNMP / TL1 / NETCONF / SSH CLI
- [ ] OLT chassis monitoring: CPU, memory, temperature, PSU, fan, uplink card
- [ ] PON port monitoring: Tx/Rx optical power, ONU count, bandwidth utilization
- [ ] GPON/EPON/XGSPON profile management
- [ ] Splitter management (1:8, 1:16, 1:32, 1:64, 1:128)

### 7.2 ONU Management
- [ ] Auto-discovery of new ONUs (plug-and-play)
- [ ] ONU provisioning: serial number (SN), LOID/Password, profile assignment
- [ ] ONU profiles: service plan → PON profile mapping
- [ ] ONU status: online/offline/los/dying-gasp/power-off/loc
- [ ] Per-ONU optical diagnostics: Tx power, Rx power, temperature, voltage, bias current
- [ ] ONU distance measurement (ranging)
- [ ] ONU firmware upgrade scheduler (batch by OLT/region)
- [ ] ONU reboot remote command
- [ ] ONU whitelist/blacklist by MAC or serial number
- [ ] ONU line profile parameters: T-CONT, GEM port, DBA, VLAN mapping
- [ ] Bridge/router mode configuration per ONU
- [ ] Wi-Fi SSID/password management via TR-069 or OMCI

### 7.3 PON Port Management
- [ ] PON port utilization dashboard
- [ ] Active/inactive ONU list per PON port
- [ ] Optical power budget calculation (splitter loss + fiber distance + margin)
- [ ] PON port shutdown for maintenance
- [ ] ONU migration between PON ports
- [ ] Xingpon / XGS-PON mode configuration

### 7.4 Fiber Plant Management
- [ ] Fiber route mapping (central office → splitter → ONU)
- [ ] Splitter inventory and assignment
- [ ] ODF (Optical Distribution Frame) port management
- [ ] OTDR integration for fault location
- [ ] SFP inventory and lifecycle tracking

---

## 8. TR-069 Auto Configuration Server (ACS)

### 8.1 CPE Management
- [ ] Auto-provisioning of CPE on first boot (zero-touch)
- [ ] Supported devices: TP-Link, ZTE, Huawei, Fiberhome, VSOL, D-Link, Netis, Tenda, and CWMP/TR-069 compliant devices
- [ ] Parameter tree browsing per CPE
- [ ] Read/write parameters: Wi-Fi SSID, password, channel, WAN config, firmware URL
- [ ] Batch parameter push (multi-CPE)
- [ ] Scheduled firmware upgrade campaigns
- [ ] Firmware version inventory per model

### 8.2 Profiles & Templates
- [ ] CPE profile templates per service plan
- [ ] Configuration template inheritance and overrides
- [ ] Automatic parameter mapping (e.g., internet VLAN → WAN config)
- [ ] Pre-configured templates per vendor/model

### 8.3 Diagnostics
- [ ] Ping / traceroute from ACS to CPE
- [ ] Wi-Fi signal strength and client count
- [ ] Ethernet port status
- [ ] WAN connection diagnostics
- [ ] Factory reset remote command
- [ ] Reboot remote command
- [ ] Session log for CWMP (TR-069 protocol) communication errors

### 8.4 Inventory
- [ ] CPE assignment to subscriber (auto-link via serial number/NAS port)
- [ ] CPE lifecycle: in-stock → assigned → active → returned → RMA
- [ ] CPE swap workflow (return old, assign new)
- [ ] CPE depreciation tracking

---

## 9. Wireless / WISP Management

### 9.1 Sector / AP Management
- [ ] AP registration (MikroTik, Ubiquiti, Cambium, Mimosa, Tariff, Radwin, Siklu)
- [ ] Sector/AP monitoring: status, clients, noise floor, channel, frequency
- [ ] Client (CPE) per AP: signal, SNR, CCQ/throughput, distance, rate
- [ ] Channel planning and interference detection
- [ ] Power and frequency remote adjustment
- [ ] Scheduled speed profiles (day vs. night rates)

### 9.2 PTMP / PTP Links
- [ ] Link planning tool (Fresnel zone, distance, frequency)
- [ ] PTP link monitoring: Tx/Rx signal, modulation, throughput
- [ ] Backup/failover link management

### 9.3 RF Metrics
- [ ] Noise floor polling per AP
- [ ] Air utilization / duty cycle per channel
- [ ] Client signal strength distribution graph
- [ ] Spectrum analysis integration (where hardware supports)
- [ ] GPS sync monitoring for TDMA systems

---

## 10. Bandwidth & QoS Management

### 10.1 Speed Profiles
- [ ] Named speed plans with download/upload rate limits
- [ ] Bursty allowances ( Mb allowance over X seconds)
- [ ] Time-of-day speed profiles (peak vs off-peak)
- [ ] Per-queue priority (VoIP > Video > Web > Download)
- [ ] Tree-based hierarchical QoS (MikroTik Queue Tree / Simple Queue)

### 10.2 Rate Limiting
- [ ] Per-subscriber rate limit via RADIUS or router-side queues
- [ ] Per-protocol/port shaping (torrent throttling, etc.)
- [ ] Rate limit templates per service type

### 10.3 FUP / Data Caps
- [ ] Monthly data cap per plan
- [ ] Rollover data from previous month
- [ ] FUP threshold with notification (80%, 90%, 100%)
- [ ] Speed reduction after cap reached
- [ ] Top-up / data pack purchase via customer portal

### 10.4 Traffic Engineering
- [ ] Per-interface QoS policy
- [ ] MPLS / VLAN-based traffic prioritization (for enterprise)
- [ ] DSCP marking and policy
- [ ] CBQ / HFSC / PCQ queue types (MikroTik-specific)
- [ ] Bandwidth test server with scheduled speed tests per subscriber

---

## 11. Customer Self-Service Portal

### 11.1 Dashboard
- [ ] Account overview: plan, balance, next due date
- [ ] Current session status (connected/disconnected, IP, data used)
- [ ] Speed tier and connection type
- [ ] Real-time usage graph (daily/monthly)

### 11.2 Billing & Payments
- [ ] Invoice history and PDF download
- [ ] Online payment (card, OXXO, SPEI, PayPal)
- [ ] Payment history
- [ ] Auto-debit enrollment
- [ ] CFDI receipt download

### 11.3 Self-Service Actions
- [ ] Change/upgrade plan (with proration)
- [ ] Change Wi-Fi password
- [ ] Change PPPoE password
- [ ] Request static IP
- [ ] Request service cancellation
- [ ] Schedule installation/visit

### 11.4 Support
- [ ] Open and track tickets
- [ ] Knowledge base / FAQ community forum
- [ ] Live chat integration
- [ ] Callback request
- [ ] Speed test tool (embedded, results logged)
- [ ] **AI-powered chatbot for instant answers** (see Section 21)
  - [ ] Answers billing questions, plan info, usage data in real time
  - [ ] Diagnoses connectivity issues using live system data (NMS + RADIUS + OLT)
  - [ ] If AI cannot resolve, automatically creates a human support ticket with full context
  - [ ] Always-available 24/7 first line of support via portal, WhatsApp, and mobile app

### 11.5 Mobile
- [ ] Responsive design / PWA
- [ ] Native mobile app (Android/iOS) with same features
- [ ] Push notifications for outages and billing events

---

## 12. Ticketing & NOC

### 12.1 Ticket Management
- [ ] Ticket creation: manual, auto (from alert), customer (from portal), **AI-escalated (from chatbot)**
- [ ] **AI pre-processing on ticket creation**:
  - [ ] AI reads ticket description and pulls relevant context: recent alerts on subscriber's OLT/ONU, billing status, past tickets, speed test history
  - [ ] AI suggests category, priority, and possible resolution to human agent
  - [ ] AI auto-suggests KB articles and troubleshooting steps based on ticket content
- [ ] Categories: outage, billing, installation, maintenance, general
- [ ] Priority: critical, high, medium, low
- [ ] Assignment to technician / department
- [ ] SLA tracking with breach alerts
- [ ] Escalation rules (time-based, priority-based)
- [ ] Ticket merging and linking
- [ ] Internal notes (not visible to customer)
- [ ] File attachment (photos of installation, screenshots)
- [ ] Time logging per ticket (tech work duration)
- [ ] **AI-powered ticket summarization**: auto-generate technical summary from conversation thread

### 12.2 NOC Dashboard
- [ ] Network-wide health status (green/yellow/red)
- [ ] Active alarm count by severity
- [ ] Ongoing outage map
- [ ] Technician GPS tracking (mobile app)
- [ ] Ticket queue by priority and due time
- [ ] Recent events timeline
- [ ] SLA compliance percentage

### 12.3 Field Operations
- [ ] Work order creation and dispatch
- [ ] Technician mobile app: view assigned jobs, navigate, log hours, take photos, capture customer signature
- [ ] Route optimization for field visits
- [ ] Material usage logging (cable length, converters, etc.)
- [ ] GPS breadcrumb tracking of technician movements
- [ ] Offline capability with auto-sync

---

## 13. Topology & Mapping

### 13.1 Network Topology Map
- [ ] Interactive map with all devices (OLTs, switches, routers, APs)
- [ ] Link visualization with utilization color-coding
- [ ] Layer switching: physical, logical, service
- [ ] Zoom to region / city / street
- [ ] Device search and highlight

### 13.2 Geographic Mapping
- [ ] Customer locations on map (clustered at zoom-out level)
- [ ] Service area polygon drawing
- [ ] Coverage heatmaps (signal strength / client density)
- [ ] Fiber route tracing on map
- [ ] Tower / cabinet / ODF location pins
- [ ] Geo-fencing alerts (device moved, CPE out of service area)

### 13.3 Dependency Mapping
- [ ] Parent-child dependency relationships
- [ ] Upstream failure cascade visualization
- [ ] Impact analysis: "If this OLT goes down, N customers affected"
- [ ] Redundancy visualization (dual-homed paths)

---

## 14. Inventory & Asset Management

### 14.1 Stock Management
- [ ] Warehouses / storage locations
- [ ] Product catalog: cables, converters, ONTs, routers, switches, SFP modules, splitters, fiber patch cords, connectors
- [ ] Stock in/out tracking with document reference (PO, invoice)
- [ ] Barcode/QR code generation and scanning
- [ ] Minimum stock alerts
- [ ] Stock transfer between locations

### 14.2 Lifecycle
- [ ] Purchase order management
- [ ] Vendor / supplier management
- [ ] Warranty tracking and expiration alerts
- [ ] Depreciation calculation
- [ ] Disposal / write-off tracking
- [ ] Asset tagging and scanning

### 14.3 Assignment
- [ ] Equipment-to-customer assignment
- [ ] Equipment-to-OLT/switch port assignment
- [ ] Equipment swap workflow
- [ ] Serial number tracking for all network equipment
- [ ] RMA (Return Merchandise Authorization) workflow

---

## 15. Reporting & Analytics

### 15.1 Financial Reports
- [ ] Revenue by period (daily, weekly, monthly, quarterly, annually)
- [ ] Revenue by plan type, region, sales agent
- [ ] Outstanding receivables aging report
- [ ] Cash flow report
- [ ] Payment method breakdown
- [ ] Churn revenue impact
- [ ] Agent commission calculations
- [ ] Tax reports (IVA, ISR)
- [ ] SAT-compliant reports for Mexico

### 15.2 Operational Reports
- [ ] Subscriber count (active, suspended, cancelled) over time
- [ ] Subscriber net growth / churn rate
- [ ] Average revenue per user (ARPU)
- [ ] Bandwidth utilization per OLT / per link / per region
- [ ] Top 10 customers by consumption
- [ ] Uptime/downtime per service area
- [ ] Mean Time To Repair (MTTR)
- [ ] Installation completion reports

### 15.3 Network Reports
- [ ] Top congested links
- [ ] SFP lifespan and replacement forecast
- [ ] Optical power degradation trends
- [ ] Reboot frequency per device
- [ ] SNMP polling success rate
- [ ] Alert frequency and resolution time
- [ ] Capacity planning forecast (subscriber growth vs. available capacity)
- [ ] PON port utilization forecast

### 15.4 Compliance Reports
- [ ] Data retention compliance report
- [ ] IP assignment log (court order ready)
- [ ] Subscriber identity verification report
- [ ] Traffic interception capability readiness
- [ ] Regulatory filing data export

### 15.5 Report Engine
- [ ] Scheduled report generation (daily/weekly/monthly)
- [ ] Export formats: PDF, Excel (XLSX), CSV
- [ ] Dashboard widgets with drag/drop layout
- [ ] Custom report builder (SQL-based or visual)
- [ ] Email report delivery to stakeholders

---

## 16. Regulatory Compliance (Mexico)

### 16.1 Legal Framework (Reference)
- [ ] **Ley Federal de Telecomunicaciones y Radiodifusion (LFTR)** — governing law
- [ ] **IFT (Instituto Federal de Telecomunicaciones)** — replaced July 2025 by new regulatory bodies:
  - [ ] **ATDT** (Agencia de Transformacion Digital y Telecomunicaciones) — policy, licensing, spectrum
  - [ ] **CRT** (Comision Reguladora de Telecomunicaciones) — regulatory enforcement, compliance, sanctions
- [ ] **Ley Federal de Proteccion de Datos Personales en Posesion de los Particulares (LFPDPPP)** — data privacy
- [ ] **Codigo Penal Federal** — telecommunications crimes
- [ ] **CFDI 4.0** — SAT digital invoicing requirements

### 16.2 User Data Management
- [ ] Customer identity verification (INE/IFE or CURP validation)
- [ ] Registration of all subscriber details per legal requirements
- [ ] Personal consent tracking for data processing (LFPDPPP Aviso de Privacidad)
- [ ] Data subject access request (DSAR) handling
- [ ] Right to erasure (with legal hold exceptions)
- [ ] Data minimization and purpose limitation enforcement

### 16.3 IP Log Retention & Interception
- [ ] **Mandatory IP-to-subscriber mapping log retention** (per Mexican telecom law)
  - [ ] Minimum retention period: per current legislation (verify with ATDT/CRT for latest)
  - [ ] Log: timestamp, subscriber ID, IP address, session start/end, NAS identifier
  - [ ] Tamper-proof storage with integrity checks (WORM/append-only)
- [ ] **Lawful interception capability**:
  - [ ] Real-time traffic mirroring capability on request from authorities
  - [ ] IP assignment traceability (which subscriber had which IP at what time)
  - [ ] CDR (Call Detail Records) export in required format
  - [ ] API endpoint for authorized law enforcement queries
  - [ ] Audit log of all government data requests

### 16.4 Numbering and Addressing
- [ ] Phone number inventory management (if offering VoIP)
- [ ] Number portability support
- [ ] CNMC (Mexican numbering) block management
- [ ] Address standardization (SEPOMEX / INEGI codes)

### 16.5 Quality of Service Requirements
- [ ] SLA monitoring against regulatory minimums
- [ ] Complaint handling with mandated response times
- [ ] Service availability tracking
- [ ] Speed guarantee monitoring (advertised vs. delivered)
- [ ] Quarterly/annual compliance report generation

### 16.6 Universal Service Contribution
- [ ] Tracking of universal service obligations
- [ ] Rural deployment reporting contribution tracking
- [ ] Social coverage metrics (underserved areas)

### 16.7 Consumer Protection (PROFECO)
- [ ] Terms of service / contract template management
- [ ] Mandatory consumer right information
- [ ] Dispute resolution tracking
- [ ] Service modification notification tracking (regulatory-mandated notice periods)

### 16.8 Data Localization
- [ ] Primary data storage within Mexico (recommended; verify latest ATDT/CRT rules)
- [ ] Backup and disaster recovery location compliance
- [ ] Cross-border transfer restrictions monitoring

### 16.9 Audit Trail
- [ ] Complete audit log for all system actions
- [ ] Admin action logging (who deleted/modified what and when)
- [ ] Report access logging (who downloaded subscriber data)
- [ ] Retention period compliance automation
- [ ] Read-only audit export for regulatory inspections

---

## 17. Security & Access Control

### 17.1 User Management
- [ ] Admin user accounts with role-based access control (RBAC)
- [ ] Roles: super admin, billing admin, NOC operator, technician, read-only auditor, reseller admin
- [ ] 2FA / MFA support (TOTP, hardware key)
- [ ] Session timeout and idle lock
- [ ] IP-based whitelisting for admin access
- [ ] Password policy enforcement (length, complexity, rotation)

### 17.2 API Security
- [ ] API key management with per-key permissions
- [ ] OAuth 2.0 / JWT token authentication
- [ ] Rate limiting per API key
- [ ] IP whitelist for API access
- [ ] Audit log of all API calls
- [ ] Webhook signing verification

### 17.3 Network Security
- [ ] Firewall rule management for each subscriber pool
- [ ] DDoS protection integration (Flowspec, RTBH)
- [ ] Blackhole routing for attacked subscribers
- [ ] DNS blocklist management (malware/phishing domains)
- [ ] CPE security scanning (default password detection)

### 17.4 Data Security
- [ ] Encryption at rest (AES-256) for PII and financial data
- [ ] TLS 1.3 for all communication
- [ ] Database backup encryption
- [ ] Key management and rotation policy
- [ ] Data masking for non-privileged users
- [ ] Secure deletion of expired retention data

---

## 18. Automation & Scripting

### 18.1 Workflow Automation
- [ ] Event-triggered rules (if X then Y)
- [ ] Scheduled tasks (cron-based)
- [ ] Batch subscriber operations (suspend, rate-limit, send notification)
- [ ] Auto-provisioning pipeline: order → assign IP → configure → activate → notify
- [ ] Auto-remediation scripts (e.g., reboot ONU if offline > 5 min)

### 18.2 Scripting Engine
- [ ] Built-in script editor (Bash / Python / PowerShell)
- [ ] Script library with community/shared scripts
- [ ] Script execution logging and error handling
- [ ] API call from within scripts (to platform APIs and external)
- [ ] Scheduler for recurring scripts

### 18.3 Router API Integration
- [ ] MikroTik RouterOS API (primary)
- [ ] Cisco IOS/IOS-XE SSH / RESTCONF
- [ ] Juniper JunOS NETCONF / REST
- [ ] ZTE/Huawei OTL TL1 / SSH / NETCONF
- [ ] REST API for modern NMS devices

### 18.4 AI / ML — NMS & Operations Analytics (summary)
- [ ] Anomaly detection on traffic patterns
- [ ] Predictive failure analysis (SFP degradation, ONU failure)
- [ ] Smart alert correlation and noise reduction
- [ ] Bandwidth forecasting (capacity planning)
- [ ] Churn prediction scoring
- [ ] **Full AI-powered customer support system — see Section 21**

---

## 19. Multi-Tenancy / Reseller Support

### 19.1 Roles & Permissions
- [ ] Multi-level reseller hierarchy (ISP → Master Reseller → Sub-Reseller → Customer)
- [ ] Each reseller sees only their own customers, devices, and revenue
- [ ] Reseller-branded customer portal (white-label)
- [ ] Custom pricing per reseller
- [ ] Commission/profit tracking per reseller

### 19.2 Resource Allocation
- [ ] IP pool allocation per reseller
- [ ] Bandwidth allocation per reseller
- [ ] OLT / PON port assignment per reseller
- [ ] Separate billing per reseller entity
- [ ] Separate reporting per reseller

### 19.3 Reseller Portal
- [ ] Dashboard with their subscriber count, revenue, tickets
- [ ] Customer management (create, suspend, cancel)
- [ ] Invoice generation under their own brand
- [ ] Stock management for their assigned equipment

---

## 20. APIs & Integrations

### 20.1 Core REST API
- [ ] Full CRUD for: customers, plans, invoices, tickets, devices, OLTs, ONUs, sessions
- [ ] Pagination, filtering, sorting on all endpoints
- [ ] Webhooks for event notification (payment received, outage, new subscriber)
- [ ] OpenAPI/Swagger documentation
- [ ] Rate limiting and throttling

### 20.2 Third-Party Integrations
- [ ] **Accounting**: QuickBooks, ContPAQi (Mexico), SAP, ERPNext
- [ ] **Payment Gateways**: Stripe, PayPal, Conekta (Mexico), Openpay, MercadoPago, OXXO Pay
- [ ] **Communication**: Twilio, Vonage (SMS), WhatsApp Business API, SendGrid (email)
- [ ] **Maps**: Google Maps, OpenStreetMap, MapBox
- [ ] **Monitoring**: Zabbix, Prometheus, Grafana, PRTG (bidirectional sync)
- [ ] **Helpdesk**: Zendesk, Freshdesk, osTicket (import/export)
- [ ] **Tax/SAT**: CFDI 4.0 PAC (Proveedor Autorizado de Certificacion) integration
- [ ] **LoRaWAN**: ChirpStack API integration for IoT farm sensors

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
- [ ] AI cannot resolve after 2 attempts → escalate to human
- [ ] Customer explicitly asks for "agent" / "humano" → immediate escalate
- [ ] Detected frustration (negative sentiment, repeated issue) → escalate
- [ ] Billing dispute or refund request → escalate to billing team
- [ ] VIP / enterprise customer → always offer human agent option
- [ ] Issue involving outage affecting >N subscribers → escalate to NOC + notify all affected
- [ ] All escalations include: AI conversation summary, customer context, attempted solutions, relevant system data

### 21.3 AI Module — Billing & Account

**Data sources**: CRM, billing engine, payment gateway, subscription database

**Capabilities**:
- [ ] "What's my balance?" → reads account balance in real time
- [ ] "When is my next payment due?" → reads next billing date
- [ ] "I want to upgrade my plan" → shows available plans with pricing, handles upgrade with prorated charge
- [ ] "How much data have I used this month?" → reads RADIUS accounting data
- [ ] "I was overcharged" → pulls invoice details, compares with plan, initiates refund if mismatch confirmed
- [ ] "I want to cancel" → explains cancellation process, offers retention discount, processes if confirmed
- [ ] "Can I pay at OXXO?" → sends payment barcode/reference number
- [ ] "I need my CFDI receipt" → generates and links CFDI PDF
- [ ] "Change my service address" → updates CRM, checks service availability at new address
- [ ] "What plans do you have?" → lists plans with speeds, prices, data caps in customer's language

**Language support**: Spanish (primary for Mexico), English, with regional slang understanding

### 21.4 AI Module — Technical Diagnostics & Troubleshooting

The AI tech diagnostic module works for **both FTTH (fiber) and WISP (wireless) subscribers**. The first thing it checks is the **subscriber's access type** (fiber/PPPoE vs. wireless/CPE-AP link) and runs the appropriate diagnostic branch.

**Data sources (FTTH fiber)**: SNMP NMS, RADIUS, OLT/ONU management, TR-069 ACS, alert database
**Data sources (WISP wireless)**: SNMP NMS, RADIUS, AP/sector monitoring (signal/SNR/CCQ), CPE status, wireless link metrics, alert database

---

#### 21.4a — Diagnostic: "My internet is slow" (FTTH Fiber)

1. Checks if subscriber's PPPoE session is active
2. Checks assigned speed profile vs. plan (mismatch?)
3. Reads recent speed test results from subscriber
4. Checks subscriber's ONU optical signal (Rx power within range?)
5. Checks if OLT PON port has alerts (degraded signal, high utilization)
6. Checks subscriber's router/CPE status via TR-069 (Wi-Fi channel congestion? firmware outdated?)
7. Checks if subscriber is hitting data cap / FUP threshold
8. Checks for active outages in subscriber's area
→ Returns diagnostic result with specific cause and fix, or escalates

#### 21.4b — Diagnostic: "My internet is slow" (WISP Wireless)

1. Checks if subscriber's PPPoE session is active (or DHCP session)
2. Checks assigned speed profile vs. plan (mismatch?)
3. Reads recent speed test results from subscriber
4. Checks which AP/sector the subscriber's CPE is connected to
5. Reads CPE signal strength, SNR, and CCQ/throughput from AP monitoring
6. Checks AP/sector load — how many clients on same AP? Is sector overloaded?
7. Checks for RF interference or channel congestion on that channel/frequency
8. Checks CPE alignment (if PTP: antenna alignment, Fresnel zone obstruction)
9. Checks CPE firmware version via TR-069
10. Checks if subscriber is hitting data cap / FUP threshold
11. Checks for weather conditions affecting wireless links (heavy rain on 5 GHz = rain fade)
→ Returns: "Your signal has dropped from -55 dBm to -72 dBm — tree/antenna misalignment likely." OR "Your sector has 48 active clients (capacity 50). Consider upgrading our Turbo plan." OR "CPE firmware is 2 versions behind; scheduling upgrade."

#### 21.4c — Diagnostic: "I have no internet" (FTTH Fiber)

1. Checks PPPoE session status (connected? authentication error?)
2. Checks ONU status (online? LOS? power-off?)
3. Checks OLT PON port (active? any alarms?)
4. Checks RADIUS authentication logs (rejected? bad password? expired?)
5. Checks account status (suspended due to non-payment?)
6. Checks for area-wide outage
→ Returns result: "Your ONU is offline (no light). Please check power cable." OR "Your account is suspended due to unpaid balance of $XXX. Pay now?" OR "There's an outage in your area, ETA 2 hours."

#### 21.4d — Diagnostic: "I have no internet" (WISP Wireless)

1. Checks PPPoE/DHCP session status
2. Checks RADIUS authentication logs (rejected? bad password? expired?)
3. Checks account status (suspended due to non-payment?)
4. Checks if subscriber's CPE is visible on any AP
5. If CPE not visible on any AP → CPE offline or misaligned
6. If CPE visible but no session → RADIUS or plan issue
7. Checks for AP/sector outage (AP down? sector down? backhaul link down?)
8. Checks weather alerts (storm = signal fade)
→ Returns: "Your CPE is not showing on our network. Please check power and antenna direction." OR "Your AP (Tower-X Sector 2) is currently down for maintenance, ETA 1 hour." OR "Your building materials may be blocking signal; let's try a different CPE location."

#### 21.4e — Diagnostic: "My Wi-Fi doesn't work" (Both Fiber & WISP)

1. Checks CPE/Wi-Fi router via TR-069 (online? SSID broadcasting?)
2. Reads Wi-Fi channel and client count
3. Detects if Wi-Fi password was recently changed (via account)
4. Suggests: restart router, check Wi-Fi password, move device closer
5. If CPE offline → restart via TR-069
→ If unresolved after steps → escalate with full diagnostic dump

#### 21.4f — Diagnostic: "My internet disconnects frequently"

*Fiber branch:*
1. Reads RADIUS session history (frequent drops?)
2. Checks ONU optical signal stability (fluctuating Rx power = fiber issue)
3. Checks OLT PON port error counters
4. Checks CPE uptime and reboot frequency
→ Returns possible cause: fiber splice issue, CPE overheating, ONU failing, etc.

*Wireless branch:*
1. Reads RADIUS session history (frequent drops?)
2. Checks CPE signal fluctuation pattern (intermittent fade = alignment or obstruction)
3. Checks AP uptime and reboot events (channel change? firmware reload?)
4. Checks for interference events (new AP on same channel detected?)
→ Returns: "Your signal fluctuates between -60 and -78 dBm — likely antenna movement or new obstruction. Recommend re-alignment." OR "Your AP changed channel from 5180 to 5220 at 3 AM — CPE may need manual reconnect."

#### 21.4g — Diagnostic: "I can connect to the internet but very slowly at night" (Both)

*Fiber branch:* Checks PON port utilization during peak hours — if >85%, PON is congested.

*Wireless branch:* Checks AP client count during peak hours — if near capacity, subscribers share bandwidth. Checks if night-time rates differ from plan.

→ Returns: "Your PON port serves 45 users and is at 89% capacity during 7-11 PM. Upgrade available for dedicated bandwidth." OR "Your sector has 1 free slot remaining. During peak hours bandwidth is shared — upgrade plan for guaranteed speed."

---

#### AI Module — Technical: What It CAN Diagnose Automatically

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

#### AI Module — Technical: When It MUST Escalate

*Fiber-specific:*
- [ ] Physical fiber damage requiring field team (cable cut, splitter failure)
- [ ] OLT hardware failure requiring replacement
- [ ] ONU replacement (physical swap)
- [ ] Fiber splicing / ODF work
- [ ] New drop cable installation

*Wireless-specific:*
- [ ] Antenna/CPE physical re-alignment requiring tower/climb crew
- [ ] New sector / AP installation
- [ ] Pole / tower structural issue
- [ ] Tree trimming / obstruction removal
- [ ] PTP link re-alignment (both ends)

*Both / General:*
- [ ] Legal/regulatory questions
- [ ] Complex billing disputes
- [ ] Customer requests technician visit
- [ ] Anything requiring physical equipment swap
- [ ] Issue affecting entire node/subnet/sector (escalate to NOC, notify all)
- [ ] AI confidence below 60%

### 21.5 AI Module — General & Account Management

- [ ] "How do I change my Wi-Fi password?" → Step-by-step guide + offer to do it via TR-069
- [ ] "What's my IP address?" → Reads RADIUS session, returns current IP
- [ ] "I need a static IP" → Checks eligibility, explains pricing, processes request
- [ ] "How do I set up port forwarding?" → Provides CPE-specific guide (model aware)
- [ ] "I'm moving, can I transfer my service?" → Checks serviceability at new address, schedules transfer
- [ ] "Can I get service at my address?" → Checks coverage map for fiber availability + wireless LOS (line of sight)
- [ ] "What are your business hours?" → Provides branch/agent locations and hours
- [ ] "I want to report a damaged cable/pole/antenna" → Creates ticket with GPS from customer profile + access type (fiber or wireless)
- [ ] "My antenna/CPE was knocked by wind" → Schedules re-alignment visit (wireless) or drop cable check (fiber)
- [ ] "A tree grew in front of my antenna" → Creates obstruction report, schedules site survey
- [ ] "How far is the nearest tower/AP?" → Returns sector info and estimated signal based on distance
- [ ] Complaint about technician behavior → Escalates immediately to management with all context

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
  - >85% confidence → Send answer directly
  - 60-85% confidence → Send answer + offer human help
  - <60% confidence → Handoff to human immediately
       |
[Output: Text / TTS / WhatsApp / Portal / Mobile]
```

#### Technology Stack (AI Layer)
- [ ] **LLM backend**: OpenAI GPT-4o / Claude Sonnet / self-hosted LLM (Llama 3.2 via llama.cpp for data sovereignty)
- [ ] **Self-hosted option**: Llama 3.2-70B or Qwen3.6-27B on local GPU (NVIDIA RTX PRO 6000) — keeps customer data in Mexico, no API fees
- [ ] **Vector DB**: Qdrant or Milvus for KB embeddings (knowledge base articles, past tickets, SOPs)
- [ ] **RAG pipeline**: Retrieves relevant KB docs, past ticket resolutions, SOPs before generating response
- [ ] **Fine-tuning**: LLM fine-tuned on ISP-specific terminology, Mexican Spanish, company policies
- [ ] **STT**: Whisper (open source) for voice calls
- [ ] **TTS**: Edge TTS or ElevenLabs for voice responses
- [ ] **Webhook bridge**: All AI modules call platform REST API to read system state

### 21.8 Knowledge Base & Training Data

The AI must be trained on:
- [ ] **Company knowledge base**: FAQ, service plans, coverage areas (fiber + wireless), pricing, policies
- [ ] **Past ticket resolutions**: Anonymized historical tickets and their solutions — both FTTH and WISP (vector DB)
- [ ] **Technical SOPs**:
  - [ ] FTTH: "PPPoE session not starting" → check RADIUS auth log → check ONU status → check account status
  - [ ] WISP: "CPE not connecting" → check CPE visible on any AP → check signal/SNR → check RADIUS → check alignment → check weather
- [ ] **Network topology**:
  - [ ] Fiber: AI knows which OLT/ONU serves each customer, understands PON port → splitter → ONU relationships
  - [ ] Wireless: AI knows which AP/sector covers each customer, understands tower → sector → CPE relationships, Fresnel zone, distance, antenna types
- [ ] **Coverage maps**: Fiber serviceability by address; wireless LOS (line of sight) availability, tower locations, sector azimuth/bearing
- [ ] **Regulatory FAQ**: PROFECO rights, CFDI requirements, cancellation policy (Mexican law)
- [ ] **Product documentation**: ONU/CPE user guides, AP/CPE antenna guides (Ubiquiti, MikroTik, Cambium, Mimosa), Wi-Fi configuration steps, alignment guides
- [ ] **Real-time system state**: NMS alerts (OLT/AP), RADIUS sessions, ONU/CPE status, AP noise floor, weather data (not training data — live queries)
- [ ] **Common responses (templates)**: Pre-approved responses for frequent scenarios (both fiber and wireless) to ensure consistency

**Continuous learning**:
- [ ] Every resolved AI conversation is logged (anonymized)
- [ ] Tickets that required human escalation are flagged for KB improvement
- [ ] Monthly KB review: new articles added for emerging issues
- [ ] A/B testing of AI responses for resolution rate optimization
- [ ] Human agents can mark AI responses as "helpful" or "wrong" → feedback loop

### 21.9 AI Guardrails & Safety

- [ ] **Never access raw customer PII** in LLM context — use customer ID references internally, resolve PII only for response
- [ ] **Never make billing adjustments without explicit customer confirmation** — AI proposes, customer confirms
- [ ] **Never reveal internal system details** (SNMP community strings, RADIUS secrets, server IPs, internal IPs)
- [ ] **Never impersonate a human** — always identify as "AI assistant" or virtual agent
- [ ] **Never make promises** ("I guarantee your internet will be back in 5 minutes") — use "typically" / "usually"
- [ ] **Escalate on legal/regulatory topics** — AI should NOT give legal advice
- [ ] **Rate limit per customer** — max N AI interactions per hour to prevent abuse
- [ ] **Log everything** — all AI conversations logged with timestamps, confidence scores, data sources accessed
- [ ] **Prompt injection protection** — customer messages sanitized before LLM context injection
- [ ] **Retention policy** — AI conversation logs subject to same data retention rules as CRM data (Section 16)

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
- [ ] **Alert explanation**: "OLT-X PON port 3/1/5 Rx power dropped 5 dB" → AI correlates: "This is affecting 23 subscribers. One ONU (SN:XXX) shows Rx -28 dB (near threshold). Last fiber splice at splitter 3B. Recommend check splice."
- [ ] **Capacity warning**: "PON port 2/1/7 at 82% utilization. At this growth rate (3%/month), will hit 95% in 5 months. Recommend preemptive split or OLT upgrade."

*Wireless examples:*
- [ ] **Alert explanation**: "AP Tower-3 Sector 2 (5.8 GHz) — 3 CPEs dropped in last 10 min" → AI correlates: "Signal dropped 8 dB across all 3 CPEs simultaneously. Weather radar shows heavy rain cell moving through. Likely rain fade. Will recover when weather clears."
- [ ] **Interference detection**: "AP Tower-1 Sector 1 noise floor increased from -95 to -82 dBm on channel 5180" → AI correlates: "New AP detected on same channel 2.3 km away (ISP competitor or new deployment). Recommend channel change to 5220 or 5745."
- [ ] **Capacity warning**: "AP Tower-2 Sector 3 at 47/50 clients. Average throughput per client dropped to 4 Mbps (plan: 10 Mbps). Recommend sector split or new AP deployment."
- [ ] **Alignment drift**: "CPE SN:XXX signal trending down 0.5 dB/day over 2 weeks. Current: -71 dBm (threshold: -75 dBm). Recommend schedule re-alignment visit before signal drops below threshold."

*General:*
- [ ] **On-call summary**: At shift change, AI generates summary of all open issues, ongoing outages, tickets pending
- [ ] **Runbook suggestion**: AI suggests troubleshooting steps based on alert type (learns from past NOC actions)


---

## Appendix A — Architecture Recommendations

### High Availability
- [ ] Database: PostgreSQL with streaming replication (primary + read replica)
- [ ] Application: Load-balanced app servers (2+ behind HAProxy/Nginx)
- [ ] Redis for caching and session management (Redis Sentinel for HA)
- [ ] Shared storage or block-level replication for file attachments
- [ ] Automated failover with health checks

### Performance Targets
- [ ] 10,000 subscribers: single server (4 vCPU, 8GB RAM) sufficient
- [ ] 50,000+ subscribers: distributed architecture required
- [ ] SNMP polling: <30s per device at 10,000 devices (requires multiple pollers)
- [ ] Page load: <2 seconds for all dashboard pages
- [ ] API response: <200ms for CRUD operations

### Recommended Stack (Budget-Oriented)
- [ ] Backend: Python (Django/FastAPI) or PHP (Laravel) — both proven in ISP stacks
- [ ] Database: PostgreSQL (primary) + Redis (cache)
- [ ] Frontend: Vue.js / React (SPA dashboard) + Nginx
- [ ] RADIUS: FreeRADIUS 3.x with MySQL/PostgreSQL backend
- [ ] NMS: Custom SNMP poller + LibreNMS/Zabbix integration
- [ ] Queue: RabbitMQ / Redis for async tasks
- [ ] Storage: MinIO (S3-compatible, self-hosted) for file backups

### Scalability Considerations
- [ ] Horizontal scaling for polling engine (add poller nodes)
- [ ] Database partitioning by date for accounting records
- [ ] CDN for static assets and customer portal
- [ ] Containerized deployment (Docker / Docker Compose) for easy scaling

---

## Appendix B — Compliance Checklist (Mexico)

- [ ] Subscriber identity capture (INE/IFE/CURP)
- [ ] LFPDPPP Aviso de Privacidad displayed and accepted
- [ ] IP-to-subscriber log retention configured and verified
- [ ] Log integrity protection (append-only / WORM)
- [ ] Lawful interception capability documented and operational
- [ ] CFDI 4.0 invoicing integration with PAC
- [ ] Tax regimen facturacion (regimen fiscal) properly configured
- [ ] Complaint response SLA configured
- [ ] Consumer terms template compliant with PROFECO
- [ ] Data backup within Mexican territory (verify latest rules)
- [ ] Audit trail activated for all administrative actions
- [ ] Access control policy documented and enforced
- [ ] Incident response plan documented
- [ ] Annual compliance self-assessment scheduled
- [ ] ATDT/CRT registration and licensing up to date

---

*Document version: 1.1 | Created: 2026-05-31 | Updated: 2026-05-31 (added Section 21 AI Support)*
*Next review: After ATDT/CRT regulatory updates are published*
