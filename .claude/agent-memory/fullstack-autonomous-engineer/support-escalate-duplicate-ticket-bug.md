---
name: support-escalate-duplicate-ticket-bug
description: FIXED — supportConversationService.escalate() previously had no already-escalated guard; now idempotent via a status==='escalated' SELECT-and-short-circuit at the top of the function
metadata:
  type: project
---

`supportConversationService.escalate()` (src/services/supportConversationService.js:464)
used to unconditionally UPDATE `support_conversations.status='escalated'`,
INSERT a NEW row into `tickets`, overwrite `ticket_id` on the conversation,
and INSERT a new system message — every single time it was called, with no
internal "already escalated, no-op" guard.

`sendMessage`'s own escalation-detection step 5 (`if (!escalationReason &&
conv.status === 'escalated') escalationReason = 'already_escalated';`) only
ever prevented a SECOND diagnostic run — it did NOT prevent `escalate()`
itself from running again. Net effect: once a conversation was escalated (by
ANY of the 5 triggers — human_requested, negative_sentiment, billing_dispute,
low_confidence_repeated, or the diagnostic-engine `escalate:true` path),
every subsequent customer message created a brand-new duplicate ticket and
silently orphaned the previous one, plus spammed a duplicate "your
conversation has been escalated" system message.

**Fixed on branch `feat/escalate-trigger-upload-limiter`, commit `e273885`.**
Found while verifying [[diagnostic-engine-escalate-checknames-fix]] composes
safely with PR #400's `escalate()` wiring — initially flagged as an
out-of-scope follow-up (the brief said "note it, don't add speculative
guarding"), then the coordinator explicitly pulled it into scope: *this* PR
is what makes escalate:true reachable on real faults for the first time, so
the latent bug goes live the moment it ships.

**The fix:** `escalate()` now opens with
```js
const [existingRows] = await db.query(
  'SELECT status, ticket_id FROM support_conversations WHERE id = ? AND organization_id = ?',
  [conversationId, orgId],
);
const existing = existingRows[0];
if (existing && existing.status === 'escalated') {
  logger.info({ conversationId, orgId, ticketId: existing.ticket_id }, '...no-op...');
  return _loadConversation(conversationId, orgId);
}
```
before any of the UPDATE/INSERT side effects. `status === 'escalated'` was
chosen over `ticket_id IS NOT NULL` because status is set unconditionally as
escalate()'s very first side effect, whereas `ticket_id` can legitimately
stay NULL after a "successful" escalation if the ticket INSERT itself fails
(the existing try/catch swallows that failure so escalation isn't aborted) —
guarding on `ticket_id` alone would incorrectly re-run the whole chain
(including a second system message) on every retry of a conversation whose
first ticket-creation attempt failed.

**Tests:** `tests/supportConversationService.test.js`'s new `describe('escalate()
idempotency guard', ...)` block directly tests `escalate()` in isolation
(first call still creates ticket+message; second call on an already-escalated
conversation creates neither) plus an end-to-end `sendMessage` case through
the step-5 `already_escalated` path. Every pre-existing test that drove
`escalate()`'s db.query sequence (in both `section21.test.js` and
`supportConversationService.test.js`) needed a new `mockResolvedValueOnce`
inserted at the front of the chain for the guard's SELECT — grep for
`SET status = 'escalated'` mock sequences before adding any new escalate()
test coverage.
