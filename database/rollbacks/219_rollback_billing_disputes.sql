-- Rollback 219: Remove billing disputes and dispute evidence tables

DROP TABLE IF EXISTS dispute_evidence;
DROP TABLE IF EXISTS billing_disputes;
