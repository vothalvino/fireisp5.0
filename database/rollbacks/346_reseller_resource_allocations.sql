-- Rollback: 346_reseller_resource_allocations
-- Drops resource allocation tables added in migration 346.

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS reseller_billing_entities;
DROP TABLE IF EXISTS reseller_olt_port_assignments;
DROP TABLE IF EXISTS reseller_bandwidth_quotas;
DROP TABLE IF EXISTS reseller_ip_pool_allocations;
SET FOREIGN_KEY_CHECKS = 1;
