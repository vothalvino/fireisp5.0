-- =============================================================================
-- FireISP 5.0 — Migration 151: Add soft-delete (deleted_at) columns
-- =============================================================================
-- Adds a nullable deleted_at DATETIME column and an index to all resource
-- tables, enabling archive-on-delete instead of hard DELETE.
--
-- Each table gets:
--   deleted_at DATETIME DEFAULT NULL
--   INDEX idx_<table>_deleted_at (deleted_at)
-- Both additions are guarded with INFORMATION_SCHEMA checks so the migration
-- is safely re-runnable after a partial failure.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_151_add_soft_delete;
DELIMITER //
CREATE PROCEDURE migration_151_add_soft_delete(IN p_table VARCHAR(64))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = p_table
      AND COLUMN_NAME  = 'deleted_at'
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN deleted_at DATETIME DEFAULT NULL');
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = p_table
      AND INDEX_NAME   = CONCAT('idx_', p_table, '_deleted_at')
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE `', p_table, '` ADD INDEX idx_', p_table, '_deleted_at (deleted_at)');
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

-- Core resources
CALL migration_151_add_soft_delete('users');
CALL migration_151_add_soft_delete('clients');
CALL migration_151_add_soft_delete('contacts');
CALL migration_151_add_soft_delete('organizations');
CALL migration_151_add_soft_delete('organization_users');
CALL migration_151_add_soft_delete('sites');
CALL migration_151_add_soft_delete('plans');
CALL migration_151_add_soft_delete('plan_addons');
CALL migration_151_add_soft_delete('contracts');
CALL migration_151_add_soft_delete('contract_addons');
CALL migration_151_add_soft_delete('devices');
CALL migration_151_add_soft_delete('tickets');
CALL migration_151_add_soft_delete('ticket_comments');

-- Financial
CALL migration_151_add_soft_delete('invoices');
CALL migration_151_add_soft_delete('invoice_items');
CALL migration_151_add_soft_delete('payments');
CALL migration_151_add_soft_delete('payment_allocations');
CALL migration_151_add_soft_delete('credit_notes');
CALL migration_151_add_soft_delete('credit_note_items');
CALL migration_151_add_soft_delete('expenses');
CALL migration_151_add_soft_delete('quotes');
CALL migration_151_add_soft_delete('quote_items');
CALL migration_151_add_soft_delete('tax_rates');
CALL migration_151_add_soft_delete('tax_rules');
CALL migration_151_add_soft_delete('payment_gateways');
CALL migration_151_add_soft_delete('recurring_payment_profiles');

-- Networking
CALL migration_151_add_soft_delete('nas');
CALL migration_151_add_soft_delete('radius');
CALL migration_151_add_soft_delete('ip_pools');
CALL migration_151_add_soft_delete('ip_assignments');
CALL migration_151_add_soft_delete('network_links');
CALL migration_151_add_soft_delete('vlans');
CALL migration_151_add_soft_delete('outages');
CALL migration_151_add_soft_delete('snmp_profiles');
CALL migration_151_add_soft_delete('snmp_profile_oids');
CALL migration_151_add_soft_delete('speed_tests');
CALL migration_151_add_soft_delete('device_config_backups');
CALL migration_151_add_soft_delete('firerelay_nodes');
CALL migration_151_add_soft_delete('firerelay_client_routing');

-- Infrastructure
CALL migration_151_add_soft_delete('service_areas');
CALL migration_151_add_soft_delete('coverage_zones');
CALL migration_151_add_soft_delete('warehouses');
CALL migration_151_add_soft_delete('inventory_items');
CALL migration_151_add_soft_delete('inventory_stock');
CALL migration_151_add_soft_delete('files');
CALL migration_151_add_soft_delete('notifications');
CALL migration_151_add_soft_delete('message_templates');
CALL migration_151_add_soft_delete('promotions');
CALL migration_151_add_soft_delete('sla_definitions');
CALL migration_151_add_soft_delete('suspension_rules');

-- Auth & Security
CALL migration_151_add_soft_delete('api_tokens');
CALL migration_151_add_soft_delete('roles');
CALL migration_151_add_soft_delete('webhooks');
CALL migration_151_add_soft_delete('alert_rules');

-- MX Compliance
CALL migration_151_add_soft_delete('client_mx_profiles');
CALL migration_151_add_soft_delete('organization_mx_profiles');
CALL migration_151_add_soft_delete('contract_templates_mx');
CALL migration_151_add_soft_delete('concession_titles');
CALL migration_151_add_soft_delete('regulatory_filings');
CALL migration_151_add_soft_delete('ift_statistical_reports');
CALL migration_151_add_soft_delete('csd_certificates');
CALL migration_151_add_soft_delete('pac_providers');

DROP PROCEDURE IF EXISTS migration_151_add_soft_delete;
