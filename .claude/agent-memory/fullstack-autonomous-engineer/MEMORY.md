# Agent Memory Index

- [Environment setup](env-setup.md) — Node/pnpm lives at C:\Users\votha\tools\node24; must set PATH before running commands
- [Testing conventions](testing-conventions.md) — How tests are structured, what mocks are used, and pre-existing failures to ignore
- [OpenAPI pattern](openapi-pattern.md) — Spec is static (hand-written in openapi.js); new routes need manual path additions; frontend uses `as never` cast on full options objects for paths with `query?: never` types
- [Regex escape lint rule](regex-escape-lint.md) — ESLint no-useless-escape fires on `\-` in character classes; use `[:.]/g` + `/-/g` for MAC normalization
- [Section 5 Dual Stack](section5-dual-stack.md) — migrations 241-246 complete; tables, routes, frontend pages, 25 permissions; radiusService IPv6 sync not yet done
- [Section 6 SNMP & NMS](section6-snmp-nms.md) — migrations 247-263; §6.1–6.6 done; gaps: SNMPv3 wiring, rollback-to-version, CSV import; next migration: 264
