-- =============================================================================
-- Migration 432 — billing may WITHDRAW a consent and CLOSE a DSAR
-- =============================================================================
-- Migration 321 gave the billing role `.view` and `.create` on both
-- subscriber_consents and dsar_requests, but reserved `.manage` for admin. The
-- Regulatory Compliance page is scoped to billing — it is the role the page
-- exists for — so the people who own these records could open them, log them,
-- and then not finish them:
--
--   * A subscriber phones to revoke consent. The privacy notice the product now
--     shows them explicitly promises that right ("revocar el consentimiento
--     otorgado"). The billing agent taking the call could not action it.
--   * A DSAR carries a 30-day statutory deadline (dsar_requests.due_at). The
--     agent who logged it could not mark it fulfilled or rejected, so the clock
--     ran against a request only an admin could close.
--
-- Decided by the operator 2026-07-28: both are routine customer service, not
-- privileged configuration. Every action is already attributed — the withdraw
-- and fulfil paths record who performed them — so the audit trail is unchanged
-- by widening who may perform them.
--
-- Idempotent via NOT EXISTS, matching migration 321's own grant style.
-- =============================================================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'subscriber_consents.manage',
  'dsar_requests.manage'
)
WHERE r.name = 'billing'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );
