-- Rollback: 361_softdelete_aware_unique_keys
-- Restores each original single-/multi-column UNIQUE key (without active_flag) and
-- drops the active_flag generated column. NOTE: restoring the stricter key will
-- FAIL if rows now share a value across live + soft-deleted rows (which 362
-- intentionally allows). Resolve duplicates before rolling back.

DROP PROCEDURE IF EXISTS rollback_361_softdelete_aware_unique_keys;
DELIMITER //
CREATE PROCEDURE rollback_361_softdelete_aware_unique_keys()
BEGIN
  -- nas
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='nas' AND INDEX_NAME='uq_nas_ip_address' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE nas DROP INDEX uq_nas_ip_address, ADD UNIQUE KEY uq_nas_ip_address (`ip_address`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='nas' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE nas DROP COLUMN active_flag;
  END IF;

  -- radius
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='radius' AND INDEX_NAME='uq_radius_username' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE radius DROP INDEX uq_radius_username, ADD UNIQUE KEY uq_radius_username (`username`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='radius' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE radius DROP COLUMN active_flag;
  END IF;

  -- users
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND INDEX_NAME='uq_users_email' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE users DROP INDEX uq_users_email, ADD UNIQUE KEY uq_users_email (`email`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE users DROP COLUMN active_flag;
  END IF;

  -- client_custom_fields
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='client_custom_fields' AND INDEX_NAME='uq_client_custom_fields_client_key' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE client_custom_fields DROP INDEX uq_client_custom_fields_client_key, ADD UNIQUE KEY uq_client_custom_fields_client_key (`client_id`, `field_key`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='client_custom_fields' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE client_custom_fields DROP COLUMN active_flag;
  END IF;

  -- service_orders
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='service_orders' AND INDEX_NAME='uq_service_orders_org_number' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE service_orders DROP INDEX uq_service_orders_org_number, ADD UNIQUE KEY uq_service_orders_org_number (`organization_id`, `order_number`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='service_orders' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE service_orders DROP COLUMN active_flag;
  END IF;

  -- devices
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='devices' AND INDEX_NAME='uq_devices_serial_number' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE devices DROP INDEX uq_devices_serial_number, ADD UNIQUE KEY uq_devices_serial_number (`serial_number`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='devices' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE devices DROP COLUMN active_flag;
  END IF;

  -- invoices
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='invoices' AND INDEX_NAME='uq_invoices_org_number' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE invoices DROP INDEX uq_invoices_org_number, ADD UNIQUE KEY uq_invoices_org_number (`organization_id`, `invoice_number`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='invoices' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE invoices DROP COLUMN active_flag;
  END IF;

  -- payment_allocations
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_allocations' AND INDEX_NAME='uq_payment_allocations_payment_invoice' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE payment_allocations DROP INDEX uq_payment_allocations_payment_invoice, ADD UNIQUE KEY uq_payment_allocations_payment_invoice (`payment_id`, `invoice_id`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payment_allocations' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE payment_allocations DROP COLUMN active_flag;
  END IF;

  -- quotes
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='quotes' AND INDEX_NAME='uq_quotes_org_number' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE quotes DROP INDEX uq_quotes_org_number, ADD UNIQUE KEY uq_quotes_org_number (`organization_id`, `quote_number`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='quotes' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE quotes DROP COLUMN active_flag;
  END IF;

  -- ip_pools
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ip_pools' AND INDEX_NAME='uq_ip_pools_network_mask_ver' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE ip_pools DROP INDEX uq_ip_pools_network_mask_ver, ADD UNIQUE KEY uq_ip_pools_network_mask_ver (`network`, `subnet_mask`, `ip_version`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ip_pools' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE ip_pools DROP COLUMN active_flag;
  END IF;

  -- ip_assignments
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ip_assignments' AND INDEX_NAME='uq_ip_assignments_ip' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE ip_assignments DROP INDEX uq_ip_assignments_ip, ADD UNIQUE KEY uq_ip_assignments_ip (`ip_address`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ip_assignments' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE ip_assignments DROP COLUMN active_flag;
  END IF;

  -- snmp_profiles
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='snmp_profiles' AND INDEX_NAME='uq_snmp_profiles_name' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE snmp_profiles DROP INDEX uq_snmp_profiles_name, ADD UNIQUE KEY uq_snmp_profiles_name (`name`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='snmp_profiles' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE snmp_profiles DROP COLUMN active_flag;
  END IF;

  -- snmp_profile_oids
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='snmp_profile_oids' AND INDEX_NAME='uq_profile_oid' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE snmp_profile_oids DROP INDEX uq_profile_oid, ADD UNIQUE KEY uq_profile_oid (`profile_id`, `oid`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='snmp_profile_oids' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE snmp_profile_oids DROP COLUMN active_flag;
  END IF;

  -- device_groups
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='device_groups' AND INDEX_NAME='uq_device_groups_org_name' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE device_groups DROP INDEX uq_device_groups_org_name, ADD UNIQUE KEY uq_device_groups_org_name (`organization_id`, `name`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='device_groups' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE device_groups DROP COLUMN active_flag;
  END IF;

  -- inventory_items
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items' AND INDEX_NAME='uq_inventory_items_sku' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE inventory_items DROP INDEX uq_inventory_items_sku, ADD UNIQUE KEY uq_inventory_items_sku (`sku`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE inventory_items DROP COLUMN active_flag;
  END IF;

  -- inventory_stock
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_stock' AND INDEX_NAME='uq_inventory_stock_location' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE inventory_stock DROP INDEX uq_inventory_stock_location, ADD UNIQUE KEY uq_inventory_stock_location (`item_id`, `warehouse_id`, `aisle`, `col`, `shelf`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_stock' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE inventory_stock DROP COLUMN active_flag;
  END IF;

  -- credit_notes
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='credit_notes' AND INDEX_NAME='uq_credit_notes_org_number' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE credit_notes DROP INDEX uq_credit_notes_org_number, ADD UNIQUE KEY uq_credit_notes_org_number (`organization_id`, `credit_note_number`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='credit_notes' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE credit_notes DROP COLUMN active_flag;
  END IF;

  -- roles
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='roles' AND INDEX_NAME='uq_roles_name' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE roles DROP INDEX uq_roles_name, ADD UNIQUE KEY uq_roles_name (`name`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='roles' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE roles DROP COLUMN active_flag;
  END IF;

  -- vlans
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='vlans' AND INDEX_NAME='uq_vlans_site_vlan' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE vlans DROP INDEX uq_vlans_site_vlan, ADD UNIQUE KEY uq_vlans_site_vlan (`site_id`, `vlan_id`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='vlans' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE vlans DROP COLUMN active_flag;
  END IF;

  -- message_templates
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='message_templates' AND INDEX_NAME='uq_message_templates_org_name_channel' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE message_templates DROP INDEX uq_message_templates_org_name_channel, ADD UNIQUE KEY uq_message_templates_org_name_channel (`organization_id`, `name`, `channel`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='message_templates' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE message_templates DROP COLUMN active_flag;
  END IF;

  -- promotions
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='promotions' AND INDEX_NAME='uq_promotions_org_code' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE promotions DROP INDEX uq_promotions_org_code, ADD UNIQUE KEY uq_promotions_org_code (`organization_id`, `code`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='promotions' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE promotions DROP COLUMN active_flag;
  END IF;

  -- device_config_backups
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='device_config_backups' AND INDEX_NAME='uq_device_config_backups_device_version' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE device_config_backups DROP INDEX uq_device_config_backups_device_version, ADD UNIQUE KEY uq_device_config_backups_device_version (`device_id`, `version`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='device_config_backups' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE device_config_backups DROP COLUMN active_flag;
  END IF;

  -- ift_statistical_reports
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ift_statistical_reports' AND INDEX_NAME='uq_ift_statistical_reports_org_period' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE ift_statistical_reports DROP INDEX uq_ift_statistical_reports_org_period, ADD UNIQUE KEY uq_ift_statistical_reports_org_period (`organization_id`, `report_period`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ift_statistical_reports' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE ift_statistical_reports DROP COLUMN active_flag;
  END IF;

  -- pac_providers
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pac_providers' AND INDEX_NAME='uq_pac_providers_org_provider_env' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE pac_providers DROP INDEX uq_pac_providers_org_provider_env, ADD UNIQUE KEY uq_pac_providers_org_provider_env (`organization_id`, `provider_name`, `environment`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pac_providers' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE pac_providers DROP COLUMN active_flag;
  END IF;

  -- firerelay_nodes
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='firerelay_nodes' AND INDEX_NAME='idx_firerelay_nodes_api_url' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE firerelay_nodes DROP INDEX idx_firerelay_nodes_api_url, ADD UNIQUE KEY idx_firerelay_nodes_api_url (`api_url`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='firerelay_nodes' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE firerelay_nodes DROP COLUMN active_flag;
  END IF;

  -- organization_users
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='organization_users' AND INDEX_NAME='uq_organization_users_org_user' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE organization_users DROP INDEX uq_organization_users_org_user, ADD UNIQUE KEY uq_organization_users_org_user (`organization_id`, `user_id`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='organization_users' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE organization_users DROP COLUMN active_flag;
  END IF;

  -- olt_ports
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='olt_ports' AND INDEX_NAME='uq_olt_ports_device_port' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE olt_ports DROP INDEX uq_olt_ports_device_port, ADD UNIQUE KEY uq_olt_ports_device_port (`olt_device_id`, `port_index`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='olt_ports' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE olt_ports DROP COLUMN active_flag;
  END IF;

  -- onu_profiles
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='onu_profiles' AND INDEX_NAME='uq_onu_profiles_org_name' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE onu_profiles DROP INDEX uq_onu_profiles_org_name, ADD UNIQUE KEY uq_onu_profiles_org_name (`organization_id`, `name`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='onu_profiles' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE onu_profiles DROP COLUMN active_flag;
  END IF;

  -- onu_details
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='onu_details' AND INDEX_NAME='uq_onu_details_device_id' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE onu_details DROP INDEX uq_onu_details_device_id, ADD UNIQUE KEY uq_onu_details_device_id (`device_id`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='onu_details' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE onu_details DROP COLUMN active_flag;
  END IF;

  -- onu_whitelist
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='onu_whitelist' AND INDEX_NAME='uq_onu_whitelist_olt_entry' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE onu_whitelist DROP INDEX uq_onu_whitelist_olt_entry, ADD UNIQUE KEY uq_onu_whitelist_olt_entry (`olt_device_id`, `entry_type`, `entry_value`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='onu_whitelist' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE onu_whitelist DROP COLUMN active_flag;
  END IF;

  -- odf_ports
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='odf_ports' AND INDEX_NAME='uq_odf_ports_frame_port' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE odf_ports DROP INDEX uq_odf_ports_frame_port, ADD UNIQUE KEY uq_odf_ports_frame_port (`odf_frame_id`, `port_number`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='odf_ports' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE odf_ports DROP COLUMN active_flag;
  END IF;

  -- cpe_devices
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cpe_devices' AND INDEX_NAME='uq_cpe_devices_serial_oui' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE cpe_devices DROP INDEX uq_cpe_devices_serial_oui, ADD UNIQUE KEY uq_cpe_devices_serial_oui (`serial_number`, `oui`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cpe_devices' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE cpe_devices DROP COLUMN active_flag;
  END IF;

  -- cpe_firmware_versions
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cpe_firmware_versions' AND INDEX_NAME='uq_cpe_fw_ver' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE cpe_firmware_versions DROP INDEX uq_cpe_fw_ver, ADD UNIQUE KEY uq_cpe_fw_ver (`manufacturer`, `model_name`, `version`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cpe_firmware_versions' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE cpe_firmware_versions DROP COLUMN active_flag;
  END IF;

  -- portal_kb_articles
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='portal_kb_articles' AND INDEX_NAME='uq_kb_org_slug' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE portal_kb_articles DROP INDEX uq_kb_org_slug, ADD UNIQUE KEY uq_kb_org_slug (`organization_id`, `slug`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='portal_kb_articles' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE portal_kb_articles DROP COLUMN active_flag;
  END IF;

  -- dns_blocklists
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='dns_blocklists' AND INDEX_NAME='uq_dns_blocklists_org_domain' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE dns_blocklists DROP INDEX uq_dns_blocklists_org_domain, ADD UNIQUE KEY uq_dns_blocklists_org_domain (`organization_id`, `domain`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='dns_blocklists' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE dns_blocklists DROP COLUMN active_flag;
  END IF;

  -- client_mx_profiles
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='client_mx_profiles' AND INDEX_NAME='uq_client_mx_profiles_client_id' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE client_mx_profiles DROP INDEX uq_client_mx_profiles_client_id, ADD UNIQUE KEY uq_client_mx_profiles_client_id (`client_id`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='client_mx_profiles' AND INDEX_NAME='uq_client_mx_profiles_rfc' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE client_mx_profiles DROP INDEX uq_client_mx_profiles_rfc, ADD UNIQUE KEY uq_client_mx_profiles_rfc (`rfc_unique_check`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='client_mx_profiles' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE client_mx_profiles DROP COLUMN active_flag;
  END IF;

  -- organization_mx_profiles
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='organization_mx_profiles' AND INDEX_NAME='uq_organization_mx_profiles_org_id' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE organization_mx_profiles DROP INDEX uq_organization_mx_profiles_org_id, ADD UNIQUE KEY uq_organization_mx_profiles_org_id (`organization_id`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='organization_mx_profiles' AND INDEX_NAME='uq_organization_mx_profiles_rfc' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE organization_mx_profiles DROP INDEX uq_organization_mx_profiles_rfc, ADD UNIQUE KEY uq_organization_mx_profiles_rfc (`rfc`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='organization_mx_profiles' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE organization_mx_profiles DROP COLUMN active_flag;
  END IF;

  -- concession_titles
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='concession_titles' AND INDEX_NAME='uq_concession_titles_title_number' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE concession_titles DROP INDEX uq_concession_titles_title_number, ADD UNIQUE KEY uq_concession_titles_title_number (`title_number`);
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='concession_titles' AND COLUMN_NAME='active_flag') THEN
    ALTER TABLE concession_titles DROP COLUMN active_flag;
  END IF;
END //
DELIMITER ;
CALL rollback_361_softdelete_aware_unique_keys();
DROP PROCEDURE IF EXISTS rollback_361_softdelete_aware_unique_keys;
