-- =============================================================================
-- Migration 361 — soft-delete-aware business UNIQUE keys (sweep)
-- =============================================================================
-- Make business UNIQUE keys ignore soft-deleted rows so deleting a row frees its value for reuse.
-- Pattern: add a STORED generated column active_flag = IF(deleted_at IS NULL, 1, NULL)
-- and append it to each business UNIQUE key. MySQL treats NULLs as distinct in a
-- unique index, so soft-deleted rows (active_flag = NULL) no longer reserve the
-- value, while at most one LIVE row (active_flag = 1) may hold it.
-- Idempotent via INFORMATION_SCHEMA guards (safe to re-run on MySQL 8).
-- Excluded (globally-unique external/cryptographic identifiers — reuse never
-- occurs, so soft-delete-aware uniqueness adds nothing): api_tokens.token_hash,
-- chargebacks.gateway_dispute_id, csd_certificates (certificate_number +
-- fingerprint_sha256), webauthn_credentials.credential_id.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_361_softdelete_aware_unique_keys;
DELIMITER //
CREATE PROCEDURE migration_361_softdelete_aware_unique_keys()
BEGIN
  -- nas
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='nas' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE nas ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='nas' AND INDEX_NAME='uq_nas_ip_address_active') THEN
    ALTER TABLE nas DROP INDEX uq_nas_ip_address_active;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='nas' AND COLUMN_NAME='ip_address_active') THEN
    ALTER TABLE nas DROP COLUMN ip_address_active;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='nas' AND INDEX_NAME='uq_nas_ip_address' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='nas' AND INDEX_NAME='uq_nas_ip_address') THEN
      ALTER TABLE nas DROP INDEX uq_nas_ip_address, ADD UNIQUE KEY uq_nas_ip_address (`ip_address`, active_flag);
    ELSE
      ALTER TABLE nas ADD UNIQUE KEY uq_nas_ip_address (`ip_address`, active_flag);
    END IF;
  END IF;

  -- radius
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='radius' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE radius ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='radius' AND INDEX_NAME='uq_radius_username' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='radius' AND INDEX_NAME='uq_radius_username') THEN
      ALTER TABLE radius DROP INDEX uq_radius_username, ADD UNIQUE KEY uq_radius_username (`username`, active_flag);
    ELSE
      ALTER TABLE radius ADD UNIQUE KEY uq_radius_username (`username`, active_flag);
    END IF;
  END IF;

  -- users
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE users ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND INDEX_NAME='uq_users_email' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND INDEX_NAME='uq_users_email') THEN
      ALTER TABLE users DROP INDEX uq_users_email, ADD UNIQUE KEY uq_users_email (`email`, active_flag);
    ELSE
      ALTER TABLE users ADD UNIQUE KEY uq_users_email (`email`, active_flag);
    END IF;
  END IF;

  -- client_custom_fields
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='client_custom_fields' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE client_custom_fields ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='client_custom_fields' AND INDEX_NAME='uq_client_custom_fields_client_key' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='client_custom_fields' AND INDEX_NAME='uq_client_custom_fields_client_key') THEN
      ALTER TABLE client_custom_fields DROP INDEX uq_client_custom_fields_client_key, ADD UNIQUE KEY uq_client_custom_fields_client_key (`client_id`, `field_key`, active_flag);
    ELSE
      ALTER TABLE client_custom_fields ADD UNIQUE KEY uq_client_custom_fields_client_key (`client_id`, `field_key`, active_flag);
    END IF;
  END IF;

  -- service_orders
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='service_orders' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE service_orders ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='service_orders' AND INDEX_NAME='uq_service_orders_org_number' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='service_orders' AND INDEX_NAME='uq_service_orders_org_number') THEN
      ALTER TABLE service_orders DROP INDEX uq_service_orders_org_number, ADD UNIQUE KEY uq_service_orders_org_number (`organization_id`, `order_number`, active_flag);
    ELSE
      ALTER TABLE service_orders ADD UNIQUE KEY uq_service_orders_org_number (`organization_id`, `order_number`, active_flag);
    END IF;
  END IF;

  -- devices
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='devices' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE devices ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='devices' AND INDEX_NAME='uq_devices_serial_number' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='devices' AND INDEX_NAME='uq_devices_serial_number') THEN
      ALTER TABLE devices DROP INDEX uq_devices_serial_number, ADD UNIQUE KEY uq_devices_serial_number (`serial_number`, active_flag);
    ELSE
      ALTER TABLE devices ADD UNIQUE KEY uq_devices_serial_number (`serial_number`, active_flag);
    END IF;
  END IF;

  -- invoices
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='invoices' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE invoices ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='invoices' AND INDEX_NAME='uq_invoices_org_number' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='invoices' AND INDEX_NAME='uq_invoices_org_number') THEN
      ALTER TABLE invoices DROP INDEX uq_invoices_org_number, ADD UNIQUE KEY uq_invoices_org_number (`organization_id`, `invoice_number`, active_flag);
    ELSE
      ALTER TABLE invoices ADD UNIQUE KEY uq_invoices_org_number (`organization_id`, `invoice_number`, active_flag);
    END IF;
  END IF;

  -- payment_allocations
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_allocations' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE payment_allocations ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_allocations' AND INDEX_NAME='uq_payment_allocations_payment_invoice' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_allocations' AND INDEX_NAME='uq_payment_allocations_payment_invoice') THEN
      ALTER TABLE payment_allocations DROP INDEX uq_payment_allocations_payment_invoice, ADD UNIQUE KEY uq_payment_allocations_payment_invoice (`payment_id`, `invoice_id`, active_flag);
    ELSE
      ALTER TABLE payment_allocations ADD UNIQUE KEY uq_payment_allocations_payment_invoice (`payment_id`, `invoice_id`, active_flag);
    END IF;
  END IF;

  -- quotes
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='quotes' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE quotes ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='quotes' AND INDEX_NAME='uq_quotes_org_number' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='quotes' AND INDEX_NAME='uq_quotes_org_number') THEN
      ALTER TABLE quotes DROP INDEX uq_quotes_org_number, ADD UNIQUE KEY uq_quotes_org_number (`organization_id`, `quote_number`, active_flag);
    ELSE
      ALTER TABLE quotes ADD UNIQUE KEY uq_quotes_org_number (`organization_id`, `quote_number`, active_flag);
    END IF;
  END IF;

  -- ip_pools
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ip_pools' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE ip_pools ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ip_pools' AND INDEX_NAME='uq_ip_pools_network_mask_ver' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ip_pools' AND INDEX_NAME='uq_ip_pools_network_mask_ver') THEN
      ALTER TABLE ip_pools DROP INDEX uq_ip_pools_network_mask_ver, ADD UNIQUE KEY uq_ip_pools_network_mask_ver (`network`, `subnet_mask`, `ip_version`, active_flag);
    ELSE
      ALTER TABLE ip_pools ADD UNIQUE KEY uq_ip_pools_network_mask_ver (`network`, `subnet_mask`, `ip_version`, active_flag);
    END IF;
  END IF;

  -- ip_assignments
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ip_assignments' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE ip_assignments ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ip_assignments' AND INDEX_NAME='uq_ip_assignments_ip' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ip_assignments' AND INDEX_NAME='uq_ip_assignments_ip') THEN
      ALTER TABLE ip_assignments DROP INDEX uq_ip_assignments_ip, ADD UNIQUE KEY uq_ip_assignments_ip (`ip_address`, active_flag);
    ELSE
      ALTER TABLE ip_assignments ADD UNIQUE KEY uq_ip_assignments_ip (`ip_address`, active_flag);
    END IF;
  END IF;

  -- snmp_profiles
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='snmp_profiles' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE snmp_profiles ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='snmp_profiles' AND INDEX_NAME='uq_snmp_profiles_name' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='snmp_profiles' AND INDEX_NAME='uq_snmp_profiles_name') THEN
      ALTER TABLE snmp_profiles DROP INDEX uq_snmp_profiles_name, ADD UNIQUE KEY uq_snmp_profiles_name (`name`, active_flag);
    ELSE
      ALTER TABLE snmp_profiles ADD UNIQUE KEY uq_snmp_profiles_name (`name`, active_flag);
    END IF;
  END IF;

  -- snmp_profile_oids
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='snmp_profile_oids' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE snmp_profile_oids ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='snmp_profile_oids' AND INDEX_NAME='uq_profile_oid' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='snmp_profile_oids' AND INDEX_NAME='uq_profile_oid') THEN
      ALTER TABLE snmp_profile_oids DROP INDEX uq_profile_oid, ADD UNIQUE KEY uq_profile_oid (`profile_id`, `oid`, active_flag);
    ELSE
      ALTER TABLE snmp_profile_oids ADD UNIQUE KEY uq_profile_oid (`profile_id`, `oid`, active_flag);
    END IF;
  END IF;

  -- device_groups
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='device_groups' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE device_groups ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='device_groups' AND INDEX_NAME='uq_device_groups_org_name' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='device_groups' AND INDEX_NAME='uq_device_groups_org_name') THEN
      ALTER TABLE device_groups DROP INDEX uq_device_groups_org_name, ADD UNIQUE KEY uq_device_groups_org_name (`organization_id`, `name`, active_flag);
    ELSE
      ALTER TABLE device_groups ADD UNIQUE KEY uq_device_groups_org_name (`organization_id`, `name`, active_flag);
    END IF;
  END IF;

  -- inventory_items
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE inventory_items ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items' AND INDEX_NAME='uq_inventory_items_sku' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items' AND INDEX_NAME='uq_inventory_items_sku') THEN
      ALTER TABLE inventory_items DROP INDEX uq_inventory_items_sku, ADD UNIQUE KEY uq_inventory_items_sku (`sku`, active_flag);
    ELSE
      ALTER TABLE inventory_items ADD UNIQUE KEY uq_inventory_items_sku (`sku`, active_flag);
    END IF;
  END IF;

  -- inventory_stock
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_stock' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE inventory_stock ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_stock' AND INDEX_NAME='uq_inventory_stock_location' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_stock' AND INDEX_NAME='uq_inventory_stock_location') THEN
      ALTER TABLE inventory_stock DROP INDEX uq_inventory_stock_location, ADD UNIQUE KEY uq_inventory_stock_location (`item_id`, `warehouse_id`, `aisle`, `col`, `shelf`, active_flag);
    ELSE
      ALTER TABLE inventory_stock ADD UNIQUE KEY uq_inventory_stock_location (`item_id`, `warehouse_id`, `aisle`, `col`, `shelf`, active_flag);
    END IF;
  END IF;

  -- credit_notes
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='credit_notes' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE credit_notes ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='credit_notes' AND INDEX_NAME='uq_credit_notes_org_number' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='credit_notes' AND INDEX_NAME='uq_credit_notes_org_number') THEN
      ALTER TABLE credit_notes DROP INDEX uq_credit_notes_org_number, ADD UNIQUE KEY uq_credit_notes_org_number (`organization_id`, `credit_note_number`, active_flag);
    ELSE
      ALTER TABLE credit_notes ADD UNIQUE KEY uq_credit_notes_org_number (`organization_id`, `credit_note_number`, active_flag);
    END IF;
  END IF;

  -- roles
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='roles' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE roles ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='roles' AND INDEX_NAME='uq_roles_name' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='roles' AND INDEX_NAME='uq_roles_name') THEN
      ALTER TABLE roles DROP INDEX uq_roles_name, ADD UNIQUE KEY uq_roles_name (`name`, active_flag);
    ELSE
      ALTER TABLE roles ADD UNIQUE KEY uq_roles_name (`name`, active_flag);
    END IF;
  END IF;

  -- vlans
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='vlans' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE vlans ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='vlans' AND INDEX_NAME='uq_vlans_site_vlan' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='vlans' AND INDEX_NAME='uq_vlans_site_vlan') THEN
      ALTER TABLE vlans DROP INDEX uq_vlans_site_vlan, ADD UNIQUE KEY uq_vlans_site_vlan (`site_id`, `vlan_id`, active_flag);
    ELSE
      ALTER TABLE vlans ADD UNIQUE KEY uq_vlans_site_vlan (`site_id`, `vlan_id`, active_flag);
    END IF;
  END IF;

  -- message_templates
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='message_templates' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE message_templates ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='message_templates' AND INDEX_NAME='uq_message_templates_org_name_channel' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='message_templates' AND INDEX_NAME='uq_message_templates_org_name_channel') THEN
      ALTER TABLE message_templates DROP INDEX uq_message_templates_org_name_channel, ADD UNIQUE KEY uq_message_templates_org_name_channel (`organization_id`, `name`, `channel`, active_flag);
    ELSE
      ALTER TABLE message_templates ADD UNIQUE KEY uq_message_templates_org_name_channel (`organization_id`, `name`, `channel`, active_flag);
    END IF;
  END IF;

  -- promotions
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='promotions' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE promotions ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='promotions' AND INDEX_NAME='uq_promotions_org_code' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='promotions' AND INDEX_NAME='uq_promotions_org_code') THEN
      ALTER TABLE promotions DROP INDEX uq_promotions_org_code, ADD UNIQUE KEY uq_promotions_org_code (`organization_id`, `code`, active_flag);
    ELSE
      ALTER TABLE promotions ADD UNIQUE KEY uq_promotions_org_code (`organization_id`, `code`, active_flag);
    END IF;
  END IF;

  -- device_config_backups
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='device_config_backups' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE device_config_backups ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='device_config_backups' AND INDEX_NAME='uq_device_config_backups_device_version' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='device_config_backups' AND INDEX_NAME='uq_device_config_backups_device_version') THEN
      ALTER TABLE device_config_backups DROP INDEX uq_device_config_backups_device_version, ADD UNIQUE KEY uq_device_config_backups_device_version (`device_id`, `version`, active_flag);
    ELSE
      ALTER TABLE device_config_backups ADD UNIQUE KEY uq_device_config_backups_device_version (`device_id`, `version`, active_flag);
    END IF;
  END IF;

  -- ift_statistical_reports
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ift_statistical_reports' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE ift_statistical_reports ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ift_statistical_reports' AND INDEX_NAME='uq_ift_statistical_reports_org_period' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ift_statistical_reports' AND INDEX_NAME='uq_ift_statistical_reports_org_period') THEN
      ALTER TABLE ift_statistical_reports DROP INDEX uq_ift_statistical_reports_org_period, ADD UNIQUE KEY uq_ift_statistical_reports_org_period (`organization_id`, `report_period`, active_flag);
    ELSE
      ALTER TABLE ift_statistical_reports ADD UNIQUE KEY uq_ift_statistical_reports_org_period (`organization_id`, `report_period`, active_flag);
    END IF;
  END IF;

  -- pac_providers
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pac_providers' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE pac_providers ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pac_providers' AND INDEX_NAME='uq_pac_providers_org_provider_env' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pac_providers' AND INDEX_NAME='uq_pac_providers_org_provider_env') THEN
      ALTER TABLE pac_providers DROP INDEX uq_pac_providers_org_provider_env, ADD UNIQUE KEY uq_pac_providers_org_provider_env (`organization_id`, `provider_name`, `environment`, active_flag);
    ELSE
      ALTER TABLE pac_providers ADD UNIQUE KEY uq_pac_providers_org_provider_env (`organization_id`, `provider_name`, `environment`, active_flag);
    END IF;
  END IF;

  -- firerelay_nodes
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='firerelay_nodes' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE firerelay_nodes ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='firerelay_nodes' AND INDEX_NAME='idx_firerelay_nodes_api_url' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='firerelay_nodes' AND INDEX_NAME='idx_firerelay_nodes_api_url') THEN
      ALTER TABLE firerelay_nodes DROP INDEX idx_firerelay_nodes_api_url, ADD UNIQUE KEY idx_firerelay_nodes_api_url (`api_url`, active_flag);
    ELSE
      ALTER TABLE firerelay_nodes ADD UNIQUE KEY idx_firerelay_nodes_api_url (`api_url`, active_flag);
    END IF;
  END IF;

  -- organization_users
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='organization_users' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE organization_users ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='organization_users' AND INDEX_NAME='uq_organization_users_org_user' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='organization_users' AND INDEX_NAME='uq_organization_users_org_user') THEN
      ALTER TABLE organization_users DROP INDEX uq_organization_users_org_user, ADD UNIQUE KEY uq_organization_users_org_user (`organization_id`, `user_id`, active_flag);
    ELSE
      ALTER TABLE organization_users ADD UNIQUE KEY uq_organization_users_org_user (`organization_id`, `user_id`, active_flag);
    END IF;
  END IF;

  -- olt_ports
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='olt_ports' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE olt_ports ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='olt_ports' AND INDEX_NAME='uq_olt_ports_device_port' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='olt_ports' AND INDEX_NAME='uq_olt_ports_device_port') THEN
      ALTER TABLE olt_ports DROP INDEX uq_olt_ports_device_port, ADD UNIQUE KEY uq_olt_ports_device_port (`olt_device_id`, `port_index`, active_flag);
    ELSE
      ALTER TABLE olt_ports ADD UNIQUE KEY uq_olt_ports_device_port (`olt_device_id`, `port_index`, active_flag);
    END IF;
  END IF;

  -- onu_profiles
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='onu_profiles' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE onu_profiles ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='onu_profiles' AND INDEX_NAME='uq_onu_profiles_org_name' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='onu_profiles' AND INDEX_NAME='uq_onu_profiles_org_name') THEN
      ALTER TABLE onu_profiles DROP INDEX uq_onu_profiles_org_name, ADD UNIQUE KEY uq_onu_profiles_org_name (`organization_id`, `name`, active_flag);
    ELSE
      ALTER TABLE onu_profiles ADD UNIQUE KEY uq_onu_profiles_org_name (`organization_id`, `name`, active_flag);
    END IF;
  END IF;

  -- onu_details
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='onu_details' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE onu_details ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='onu_details' AND INDEX_NAME='uq_onu_details_device_id' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='onu_details' AND INDEX_NAME='uq_onu_details_device_id') THEN
      ALTER TABLE onu_details DROP INDEX uq_onu_details_device_id, ADD UNIQUE KEY uq_onu_details_device_id (`device_id`, active_flag);
    ELSE
      ALTER TABLE onu_details ADD UNIQUE KEY uq_onu_details_device_id (`device_id`, active_flag);
    END IF;
  END IF;

  -- onu_whitelist
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='onu_whitelist' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE onu_whitelist ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='onu_whitelist' AND INDEX_NAME='uq_onu_whitelist_olt_entry' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='onu_whitelist' AND INDEX_NAME='uq_onu_whitelist_olt_entry') THEN
      ALTER TABLE onu_whitelist DROP INDEX uq_onu_whitelist_olt_entry, ADD UNIQUE KEY uq_onu_whitelist_olt_entry (`olt_device_id`, `entry_type`, `entry_value`, active_flag);
    ELSE
      ALTER TABLE onu_whitelist ADD UNIQUE KEY uq_onu_whitelist_olt_entry (`olt_device_id`, `entry_type`, `entry_value`, active_flag);
    END IF;
  END IF;

  -- odf_ports
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='odf_ports' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE odf_ports ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='odf_ports' AND INDEX_NAME='uq_odf_ports_frame_port' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='odf_ports' AND INDEX_NAME='uq_odf_ports_frame_port') THEN
      ALTER TABLE odf_ports DROP INDEX uq_odf_ports_frame_port, ADD UNIQUE KEY uq_odf_ports_frame_port (`odf_frame_id`, `port_number`, active_flag);
    ELSE
      ALTER TABLE odf_ports ADD UNIQUE KEY uq_odf_ports_frame_port (`odf_frame_id`, `port_number`, active_flag);
    END IF;
  END IF;

  -- cpe_devices
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cpe_devices' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE cpe_devices ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cpe_devices' AND INDEX_NAME='uq_cpe_devices_serial_oui' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cpe_devices' AND INDEX_NAME='uq_cpe_devices_serial_oui') THEN
      ALTER TABLE cpe_devices DROP INDEX uq_cpe_devices_serial_oui, ADD UNIQUE KEY uq_cpe_devices_serial_oui (`serial_number`, `oui`, active_flag);
    ELSE
      ALTER TABLE cpe_devices ADD UNIQUE KEY uq_cpe_devices_serial_oui (`serial_number`, `oui`, active_flag);
    END IF;
  END IF;

  -- cpe_firmware_versions
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cpe_firmware_versions' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE cpe_firmware_versions ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cpe_firmware_versions' AND INDEX_NAME='uq_cpe_fw_ver' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cpe_firmware_versions' AND INDEX_NAME='uq_cpe_fw_ver') THEN
      ALTER TABLE cpe_firmware_versions DROP INDEX uq_cpe_fw_ver, ADD UNIQUE KEY uq_cpe_fw_ver (`manufacturer`, `model_name`, `version`, active_flag);
    ELSE
      ALTER TABLE cpe_firmware_versions ADD UNIQUE KEY uq_cpe_fw_ver (`manufacturer`, `model_name`, `version`, active_flag);
    END IF;
  END IF;

  -- portal_kb_articles
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='portal_kb_articles' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE portal_kb_articles ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='portal_kb_articles' AND INDEX_NAME='uq_kb_org_slug' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='portal_kb_articles' AND INDEX_NAME='uq_kb_org_slug') THEN
      ALTER TABLE portal_kb_articles DROP INDEX uq_kb_org_slug, ADD UNIQUE KEY uq_kb_org_slug (`organization_id`, `slug`, active_flag);
    ELSE
      ALTER TABLE portal_kb_articles ADD UNIQUE KEY uq_kb_org_slug (`organization_id`, `slug`, active_flag);
    END IF;
  END IF;

  -- dns_blocklists
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='dns_blocklists' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE dns_blocklists ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='dns_blocklists' AND INDEX_NAME='uq_dns_blocklists_org_domain' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='dns_blocklists' AND INDEX_NAME='uq_dns_blocklists_org_domain') THEN
      ALTER TABLE dns_blocklists DROP INDEX uq_dns_blocklists_org_domain, ADD UNIQUE KEY uq_dns_blocklists_org_domain (`organization_id`, `domain`, active_flag);
    ELSE
      ALTER TABLE dns_blocklists ADD UNIQUE KEY uq_dns_blocklists_org_domain (`organization_id`, `domain`, active_flag);
    END IF;
  END IF;

  -- client_mx_profiles
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='client_mx_profiles' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE client_mx_profiles ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='client_mx_profiles' AND INDEX_NAME='uq_client_mx_profiles_client_id' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='client_mx_profiles' AND INDEX_NAME='uq_client_mx_profiles_client_id') THEN
      ALTER TABLE client_mx_profiles DROP INDEX uq_client_mx_profiles_client_id, ADD UNIQUE KEY uq_client_mx_profiles_client_id (`client_id`, active_flag);
    ELSE
      ALTER TABLE client_mx_profiles ADD UNIQUE KEY uq_client_mx_profiles_client_id (`client_id`, active_flag);
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='client_mx_profiles' AND INDEX_NAME='uq_client_mx_profiles_rfc' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='client_mx_profiles' AND INDEX_NAME='uq_client_mx_profiles_rfc') THEN
      ALTER TABLE client_mx_profiles DROP INDEX uq_client_mx_profiles_rfc, ADD UNIQUE KEY uq_client_mx_profiles_rfc (`rfc_unique_check`, active_flag);
    ELSE
      ALTER TABLE client_mx_profiles ADD UNIQUE KEY uq_client_mx_profiles_rfc (`rfc_unique_check`, active_flag);
    END IF;
  END IF;

  -- organization_mx_profiles
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='organization_mx_profiles' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE organization_mx_profiles ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='organization_mx_profiles' AND INDEX_NAME='uq_organization_mx_profiles_org_id' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='organization_mx_profiles' AND INDEX_NAME='uq_organization_mx_profiles_org_id') THEN
      ALTER TABLE organization_mx_profiles DROP INDEX uq_organization_mx_profiles_org_id, ADD UNIQUE KEY uq_organization_mx_profiles_org_id (`organization_id`, active_flag);
    ELSE
      ALTER TABLE organization_mx_profiles ADD UNIQUE KEY uq_organization_mx_profiles_org_id (`organization_id`, active_flag);
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='organization_mx_profiles' AND INDEX_NAME='uq_organization_mx_profiles_rfc' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='organization_mx_profiles' AND INDEX_NAME='uq_organization_mx_profiles_rfc') THEN
      ALTER TABLE organization_mx_profiles DROP INDEX uq_organization_mx_profiles_rfc, ADD UNIQUE KEY uq_organization_mx_profiles_rfc (`rfc`, active_flag);
    ELSE
      ALTER TABLE organization_mx_profiles ADD UNIQUE KEY uq_organization_mx_profiles_rfc (`rfc`, active_flag);
    END IF;
  END IF;

  -- concession_titles
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='concession_titles' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE concession_titles ADD COLUMN active_flag TINYINT(1) GENERATED ALWAYS AS (IF(deleted_at IS NULL, 1, NULL)) STORED COMMENT 'NULL when soft-deleted; appended to business unique keys so they ignore soft-deleted rows (migration 361)' AFTER deleted_at;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='concession_titles' AND INDEX_NAME='title_number') THEN
    ALTER TABLE concession_titles DROP INDEX title_number;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='concession_titles' AND INDEX_NAME='uq_concession_titles_title_number' AND COLUMN_NAME='active_flag') THEN
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='concession_titles' AND INDEX_NAME='uq_concession_titles_title_number') THEN
      ALTER TABLE concession_titles DROP INDEX uq_concession_titles_title_number, ADD UNIQUE KEY uq_concession_titles_title_number (`title_number`, active_flag);
    ELSE
      ALTER TABLE concession_titles ADD UNIQUE KEY uq_concession_titles_title_number (`title_number`, active_flag);
    END IF;
  END IF;
END //
DELIMITER ;
CALL migration_361_softdelete_aware_unique_keys();
DROP PROCEDURE IF EXISTS migration_361_softdelete_aware_unique_keys;
