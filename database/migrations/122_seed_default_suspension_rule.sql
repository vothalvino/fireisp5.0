-- Migration: 122_seed_default_suspension_rule
-- Description: Seeds a default auto-suspend rule in suspension_rules that
--              the automated suspension task will use when no organization-
--              specific rule overrides it.
--
--              NOTE: The suspension_rules table enforces organization_id NOT NULL,
--              so this migration seeds the rule for the first organization
--              (id = 1).  It will only insert when both (a) an organization with
--              id = 1 exists and (b) no rule with the same name exists for that
--              organization.  On fresh multi-tenant installations the application
--              bootstrapper should call this migration after creating the primary
--              organization row, or an administrator can manually insert rules
--              per organization using this row as a template.
--
--              The suspension_rules table does not have a description column;
--              the human-readable description is stored in the name column.
--
--              Uses WHERE NOT EXISTS for full idempotency since suspension_rules
--              carries no UNIQUE constraint on name.

INSERT INTO suspension_rules
    (organization_id, name, days_past_due, grace_period_days, action, is_active)
SELECT
    1,
    'Default: auto-suspend contracts 30 days past due with 5-day grace period',
    30,
    5,
    'auto_suspend',
    TRUE
WHERE EXISTS (SELECT 1 FROM organizations WHERE id = 1)
  AND NOT EXISTS (
      SELECT 1 FROM suspension_rules
      WHERE  organization_id = 1
        AND  name = 'Default: auto-suspend contracts 30 days past due with 5-day grace period'
  );
