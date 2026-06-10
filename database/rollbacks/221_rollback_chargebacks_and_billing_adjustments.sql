-- Rollback 221: Remove chargebacks and billing_adjustments tables

DROP TABLE IF EXISTS billing_adjustments;
DROP TABLE IF EXISTS chargebacks;
