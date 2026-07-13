---
name: support-escalate-duplicate-ticket-bug
description: supportConversationService.escalate() has no already-escalated guard — sendMessage re-invokes it (new duplicate ticket + orphaned ticket_id + duplicate system message) on every message sent after escalation
metadata:
  type: project
---

`supportConversationService.escalate()` (src/services/supportConversationService.js:464)
unconditionally UPDATEs `support_conversations.status='escalated'`, INSERTs a
NEW row into `tickets`, overwrites `ticket_id` on the conversation, and
INSERTs a new system message — every single time it's called. It has no
internal "already escalated, no-op" guard.

`sendMessage`'s own escalation-detection block (same file, ~line 393-402) has
a step 5 that looks like a guard but is not one:
```js
if (!escalationReason && conv.status === 'escalated') {
  escalationReason = 'already_escalated';
}
if (escalationReason) {
  await escalate({ conversationId, reason: escalationReason, orgId });
  return _loadConversation(conversationId, orgId);
}
```
This only prevents a SECOND diagnostic run (`_generateResponse`/
`runDiagnostic` are never reached once escalationReason is set) — it does
NOT prevent `escalate()` itself from being called again. The route layer
(`src/routes/supportConversations.js` POST `/conversations/:id/messages`,
~line 376) has no status check either; it calls `sendMessage` unconditionally
for every message.

**Net effect:** once a conversation is escalated (by ANY of the 5 triggers —
human_requested, negative_sentiment, billing_dispute, low_confidence_repeated,
or the diagnostic-engine `escalate:true` path), every subsequent customer
message creates a brand-new duplicate ticket and silently orphans the
previous one (ticket_id gets overwritten), plus spams a duplicate "your
conversation has been escalated" system message. Confirmed empirically: no
`conv.status==='escalated'` early-return exists anywhere before the
`escalate()` call in this path.

**Why this matters now:** discovered while wiring up
[[diagnostic-engine-escalate-checknames-fix]] (ESCALATABLE_CHECK_NAMES) — before
that fix, `_buildResult.escalate` was always `false` so a diagnostic-triggered
escalation could never happen, keeping this pre-existing bug's exposure low.
Now that escalate:true is actually reachable on real fiber/wireless
`no_internet` faults, this duplicate-ticket path is reachable more often in
practice (a customer waiting on a truck roll who keeps texting "hello?"
while waiting creates one ticket per message).

**How to apply:** NOT fixed as part of the escalate-trigger PR — the brief
explicitly scoped that PR to "confirm escalate() guards against
double-escalating; if it doesn't, note it — do not add speculative guarding
beyond what's needed." This is flagged as a follow-up candidate: add an
early return in `escalate()` (or at both call sites) when
`conv.status === 'escalated'` already, before the ticket INSERT.
