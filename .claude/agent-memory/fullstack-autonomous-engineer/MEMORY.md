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
