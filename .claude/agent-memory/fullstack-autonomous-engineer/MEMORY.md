# Agent Memory Index

- [Environment setup](env-setup.md) — Node/pnpm lives at C:\Users\votha\tools\node24; must set PATH before running commands
- [Testing conventions](testing-conventions.md) — How tests are structured, what mocks are used, and pre-existing failures to ignore
- [OpenAPI pattern](openapi-pattern.md) — Spec is static (hand-written in openapi.js); new routes need manual path additions; frontend uses `as never` cast on full options objects for paths with `query?: never` types
- [Regex escape lint rule](regex-escape-lint.md) — ESLint no-useless-escape fires on `\-` in character classes; use `[:.]/g` + `/-/g` for MAC normalization
- [Section 5 Dual Stack](section5-dual-stack.md) — migrations 241-246 complete; tables, routes, frontend pages, 25 permissions; radiusService IPv6 sync not yet done
- [Section 6 SNMP & NMS](section6-snmp-nms.md) — migrations 247-265; §6.1–6.6 done; gaps: rollback-to-version, traffic classification; next migration: 266
- [Section 7 FTTH OLT/ONU](section7-ftth-olt-onu.md) — migrations 266-273; §7.1–§7.4 done; 208 tables total, 64 perms, 4 React pages; live device I/O stubbed; next migration: 274
- [Section 9 Wireless/WISP](section9-wireless-wisp.md) — migrations 279-285 complete; all 14 §9 items done; 7 new tables, 60 perms; next migration: 286
- [Section 10 QoS & Bandwidth](section10-qos-bandwidth.md) — migrations 286-294 complete; all §10.1-10.4 done; 13 tables, 44 perms, 6-tab frontend page; next migration: 295
- [Section 12 Ticketing & NOC](section12-ticketing-noc.md) — migrations 297-301 complete; 8 tables, 20 perms, 3 new route files + tickets.js extensions + NOC/work-order frontend; next migration: 302
- [Section 13 Topology & Mapping](section13-topology-mapping.md) — migrations 302-304 complete; 4 new tables, 12 perms, 19 endpoints, react-leaflet frontend; next migration: 305
- [Section 14 Inventory & Asset Management](section14-inventory-asset.md) — migrations 305-307 complete; 6 tables, 20 perms, 4 route files + 5-tab frontend page; next migration: 308
- [Section 15 Reporting & Analytics](section15-reporting-analytics.md) — migrations 308-313 complete; 5 tables, 11 perms, 712 total endpoints, 5 route files + 2 frontend pages; next migration: 314
- [Section 16 Regulatory Compliance](section16-regulatory-compliance.md) — migrations 314-322 complete; 12 new tables (277 total), 47 perms, 5 route files + 8-tab frontend page, docs/compliance-mexico.md; next migration: 323
