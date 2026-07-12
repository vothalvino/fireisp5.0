# Memory Index

- [Permission matrix module aggregation](permission-matrix-module-aggregation.md) — a module's catalog rows span many entity slug-prefixes; View/Edit presets must use the full id set, not one found id
- [Modal prefill error gating](modal-prefill-error-gating.md) — gate save-validity on query.isError, not just "local state still null" — checkbox interaction can silently reseed it
- [PATCH diff explicit clear vs omit](patch-diff-explicit-clear-vs-omit.md) — `value.trim() || undefined` drops a cleared field from JSON entirely; send `null` explicitly for nullable columns
