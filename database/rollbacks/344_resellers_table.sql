-- Rollback: 344_resellers_table
-- Drops reseller hierarchy and related tables added in migration 344.

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS reseller_commissions;
DROP TABLE IF EXISTS reseller_plan_prices;
DROP TABLE IF EXISTS resellers;
SET FOREIGN_KEY_CHECKS = 1;
