---
name: mysql-atomic-sequence-idiom
description: How to build an atomic per-key counter table in MySQL without AUTO_INCREMENT — the single-statement INSERT..ON DUPLICATE KEY UPDATE..LAST_INSERT_ID() idiom silently fails to set LAST_INSERT_ID() on a fresh (non-conflicting) insert; use two statements instead
metadata:
  type: project
---

When building an atomic "next number" counter (invoice numbers, any other
per-org/per-key sequence) backed by a table whose PRIMARY KEY is a natural
key (e.g. `organization_id`, not a surrogate `AUTO_INCREMENT id`), the
tempting single-statement idiom

```sql
INSERT INTO seq (org_id, next_number) VALUES (?, 2)
ON DUPLICATE KEY UPDATE next_number = LAST_INSERT_ID(next_number) + 1;
SELECT LAST_INSERT_ID();
```

is **broken** the first time a row is created for a given key: the
`ON DUPLICATE KEY UPDATE` clause (and therefore the `LAST_INSERT_ID(expr)`
call embedded in it) only executes when a duplicate-key conflict actually
happens. On a fresh, non-conflicting `INSERT`, that clause never runs — and
because the table has no `AUTO_INCREMENT` column, MySQL does NOT
auto-populate `LAST_INSERT_ID()` for the new row either. `SELECT
LAST_INSERT_ID()` afterward returns whatever stale value this pooled
connection last set (from an unrelated earlier statement), not `1`.

**Fix: use two statements, not one.**
```sql
INSERT IGNORE INTO seq (org_id, next_number) VALUES (?, 1);
UPDATE seq SET next_number = LAST_INSERT_ID(next_number) + 1 WHERE org_id = ?;
SELECT LAST_INSERT_ID();
```
The bare `UPDATE` has no conditional branch — it always executes and always
evaluates `LAST_INSERT_ID(next_number)` against the row's pre-update value,
so the read-back is reliable on every call (first-ever and subsequent). The
`UPDATE` also takes an exclusive InnoDB row lock for its duration, so
concurrent callers for the same key serialize correctly (writes always see
the latest committed row, not a REPEATABLE READ snapshot) — no collision.

**Why:** Discovered building `organization_invoice_sequences` (migration
381, PR #389) to replace `SELECT COUNT(*) FROM invoices ...` + 1 invoice
numbering, which raced under concurrent invoice generation. The
single-statement version passed every test where the row already existed
but silently returned garbage numbers the FIRST time a fresh org generated
an invoice — caught by writing an explicit "first-ever call" unit test
before shipping, not by intuition.

**How to apply:** Any future per-org/per-key atomic counter on a
natural-key table (not surrogate `AUTO_INCREMENT id`) should use the
two-statement `INSERT IGNORE` + `UPDATE ... LAST_INSERT_ID(col)` pattern,
never the single-statement upsert form. See
`src/services/billingService.js#nextInvoiceNumber` for the reference
implementation and its full doc-comment.
