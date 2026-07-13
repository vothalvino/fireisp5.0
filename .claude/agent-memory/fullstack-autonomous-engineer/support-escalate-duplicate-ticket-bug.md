---
name: support-escalate-duplicate-ticket-bug
description: FIXED — supportConversationService.escalate() previously had no already-escalated guard; now idempotent AND concurrency-safe via an atomic conditional UPDATE claim (not a SELECT-then-UPDATE guard, which was itself found to have race/dead-end gaps)
metadata:
  type: project
---

`supportConversationService.escalate()` (src/services/supportConversationService.js)
used to unconditionally UPDATE `support_conversations.status='escalated'`,
INSERT a NEW row into `tickets`, overwrite `ticket_id` on the conversation,
and INSERT a new system message — every single time it was called, with no
internal "already escalated, no-op" guard. `sendMessage`'s own
escalation-detection step 5 (`if (!escalationReason && conv.status ===
'escalated') escalationReason = 'already_escalated';`) only ever prevented a
second diagnostic run — it did NOT prevent `escalate()` itself from running
again. Net effect: once a conversation was escalated (by ANY of its 5
triggers — human_requested, negative_sentiment, billing_dispute,
low_confidence_repeated, or the diagnostic-engine `escalate:true` path),
every subsequent customer message created a brand-new duplicate ticket,
silently orphaned the previous one, and spammed a duplicate handoff message.

**Found and fixed on branch `feat/escalate-trigger-upload-limiter`**, in two
passes:

**Pass 1 (commit `e273885`, SUPERSEDED):** a SELECT-then-UPDATE guard —
`SELECT status, ticket_id ...` then, if `status !== 'escalated'`, proceed
with the UPDATE/INSERT chain. This looked correct but review found it had
two gaps from the SAME root cause (no atomicity between the read and the
write):
1. A conversation whose status flip committed but whose ticket INSERT then
   failed (`status='escalated'`, `ticket_id=NULL`) was a **permanent dead
   end** — the guard keyed only on `status`, so even the manual
   `POST /conversations/:id/escalate` retry endpoint would silently no-op
   forever instead of repairing the missing ticket. Trading the
   every-message duplicate-ticket bug for a can-never-repair bug is not an
   improvement.
2. Two concurrent `escalate()` calls (customer double-send, or auto-escalate
   racing the manual endpoint) could both read `status='open'`, both pass
   the guard, and both create a ticket.

**Pass 2 (commit `a631fc4`, CURRENT):** replaced the guard with an atomic
conditional claim — the status flip itself IS the lock:
```js
const [claimResult] = await db.query(
  `UPDATE support_conversations
   SET status = 'escalated', escalation_reason = ?, escalated_at = NOW()
   WHERE id = ? AND organization_id = ? AND status <> 'escalated'`,
  [reason || 'manual', conversationId, orgId],
);

if (claimResult.affectedRows === 1) {
  // WE claimed it — first escalation. Create ticket + handoff message.
} else {
  // affectedRows === 0: already escalated. SELECT ticket_id and branch:
  //   ticket_id present -> true no-op (return existing state)
  //   ticket_id NULL    -> REPAIR: create just the missing ticket, never
  //                        re-touch status, never re-send the handoff message
}
```
Only one caller's UPDATE can ever match a given conversation (fixes gap 2 —
concurrency), and `affectedRows===0` is now distinguished from a *repairable*
already-escalated state via a fresh `ticket_id` read rather than assuming
"already escalated" always means "nothing to do" (fixes gap 1 — the
permanent dead end). Ticket-creation logic (INSERT + `ticket_id` UPDATE,
wrapped in its own try/catch so a failure never aborts the caller) is
factored into a shared `_createEscalationTicket()` helper used by both the
first-escalation path and the repair path.

**Lesson for future guard/idempotency code in this file:** a SELECT-then-act
check is not the same as an atomic claim, even when it looks like it covers
the same cases in tests — the gap only shows up under either concurrency or
a downstream step that can partially fail (leaving state that satisfies the
guard's read but isn't actually "done"). Prefer `UPDATE ... WHERE <not-yet-done-condition>`
+ `affectedRows` as the outcome signal whenever the guarded action has
multiple steps and any of them can fail independently.

**Tests:** `tests/supportConversationService.test.js`'s
`describe('escalate() idempotency guard (atomic conditional claim)', ...)`
covers: (a) first call claims + creates ticket/message; (b) second call with
`ticket_id` present is a true no-op; (c) second call with `ticket_id` NULL
repairs the ticket without re-touching status or re-sending the handoff
message; (d) an explicit assertion that `affectedRows===0` is what routes to
the `ticket_id` branch (via the exact SQL text of both queries). Every
pre-existing test that mocks `escalate()`'s db.query sequence (in both
`section21.test.js` and `supportConversationService.test.js`) has the claim
UPDATE as mock call #1 with no separate guard SELECT before it — grep for
`AND status <> 'escalated'` mock sequences before adding new escalate() test
coverage.
