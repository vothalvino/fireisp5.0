---
name: section5-dual-stack
description: Section 5 Dual Stack implementation complete — tables, routes, permissions, frontend pages added in migrations 241-246
metadata:
  type: project
---

Section 5 "Dual Stack (IPv4 + IPv6)" is fully implemented and wired up. Initial implementation: commits 24cd906, d6f10fe, d779183, a1da05d. CI fix + dead-schema wiring: commits 855966f, 2cb00b8, b2e58a1, b22923f, c76779d (2026-06-11).

**Why:** ISP platform feature coverage for dual-stack subscriber management.

**How to apply:** When working on §5 follow-on items, these tables and routes exist:
- `dhcp_servers`, `dhcp_static_reservations` (migration 241)
- `nat_pools`, `ptr_records` (migration 242)
- ip_pools extended with dhcpv6_mode/ra_*/slaac_prefix/region_name; plans extended with stack_type; `ra_guard_policies` (migration 243)
- pppoe_service_profiles extended with ipv6cp_enabled/delegated_prefix_len/dns_*_v6/nat64_enabled/dns64_prefix; connection_logs extended with acct_*_v6/stack_type (migration 244 — radius columns removed as duplicates of 008 columns)
- `tunnel_6rd_configs`, `ds_lite_configs`, `map_rules`, `xlat464_configs` (migration 245)
- 25 dual_stack RBAC permissions seeded (migration 246)
- Routes: /dhcp-servers, /nat-pools, /ptr-records, /ipv6 (ra-guard + subnet-plan + pool-conflicts), /transition-mechanisms
- subnetPlannerService.js has planSubnets(), detectConflicts(), getUtilization()
- radiusService.js syncFreeradiusTables() Phase B emits DNS-Server-IPv6-Address (primary/secondary) and Delegated-IPv6-Prefix-Pool (from ipv6_pool_name via LEFT JOIN on ipv6_pool_id) when IPv6CP is enabled
- radiusAccountingService.js exports deriveStackType(); all INSERT/UPDATE include acct_input_octets_v6, acct_output_octets_v6, stack_type
- NAT64/DNS64 (dns64_prefix) is stored in pppoe_service_profiles but NOT emitted via RADIUS — no standard RADIUS attribute exists for it (configured on DNS64 resolver directly)
- README table count updated to 173; migrations range updated to 001-246
