-- =============================================================================
-- FireISP 5.0 — Migration 151: Add soft-delete (deleted_at) columns
-- =============================================================================
-- Adds a nullable deleted_at DATETIME column and an index to all resource
-- tables, enabling archive-on-delete instead of hard DELETE.
-- =============================================================================

-- Core resources
ALTER TABLE users ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE users ADD INDEX idx_users_deleted_at (deleted_at);

ALTER TABLE clients ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE clients ADD INDEX idx_clients_deleted_at (deleted_at);

ALTER TABLE contacts ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE contacts ADD INDEX idx_contacts_deleted_at (deleted_at);

ALTER TABLE organizations ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE organizations ADD INDEX idx_organizations_deleted_at (deleted_at);

ALTER TABLE organization_users ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE organization_users ADD INDEX idx_organization_users_deleted_at (deleted_at);

ALTER TABLE sites ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE sites ADD INDEX idx_sites_deleted_at (deleted_at);

ALTER TABLE plans ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE plans ADD INDEX idx_plans_deleted_at (deleted_at);

ALTER TABLE plan_addons ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE plan_addons ADD INDEX idx_plan_addons_deleted_at (deleted_at);

ALTER TABLE contracts ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE contracts ADD INDEX idx_contracts_deleted_at (deleted_at);

ALTER TABLE contract_addons ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE contract_addons ADD INDEX idx_contract_addons_deleted_at (deleted_at);

ALTER TABLE devices ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE devices ADD INDEX idx_devices_deleted_at (deleted_at);

ALTER TABLE tickets ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE tickets ADD INDEX idx_tickets_deleted_at (deleted_at);

ALTER TABLE ticket_comments ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE ticket_comments ADD INDEX idx_ticket_comments_deleted_at (deleted_at);

-- Financial
ALTER TABLE invoices ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE invoices ADD INDEX idx_invoices_deleted_at (deleted_at);

ALTER TABLE invoice_items ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE invoice_items ADD INDEX idx_invoice_items_deleted_at (deleted_at);

ALTER TABLE payments ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE payments ADD INDEX idx_payments_deleted_at (deleted_at);

ALTER TABLE payment_allocations ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE payment_allocations ADD INDEX idx_payment_allocations_deleted_at (deleted_at);

ALTER TABLE credit_notes ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE credit_notes ADD INDEX idx_credit_notes_deleted_at (deleted_at);

ALTER TABLE credit_note_items ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE credit_note_items ADD INDEX idx_credit_note_items_deleted_at (deleted_at);

ALTER TABLE expenses ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE expenses ADD INDEX idx_expenses_deleted_at (deleted_at);

ALTER TABLE quotes ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE quotes ADD INDEX idx_quotes_deleted_at (deleted_at);

ALTER TABLE quote_items ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE quote_items ADD INDEX idx_quote_items_deleted_at (deleted_at);

ALTER TABLE tax_rates ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE tax_rates ADD INDEX idx_tax_rates_deleted_at (deleted_at);

ALTER TABLE tax_rules ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE tax_rules ADD INDEX idx_tax_rules_deleted_at (deleted_at);

ALTER TABLE payment_gateways ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE payment_gateways ADD INDEX idx_payment_gateways_deleted_at (deleted_at);

ALTER TABLE recurring_payment_profiles ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE recurring_payment_profiles ADD INDEX idx_recurring_payment_profiles_deleted_at (deleted_at);

-- Networking
ALTER TABLE nas ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE nas ADD INDEX idx_nas_deleted_at (deleted_at);

ALTER TABLE radius ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE radius ADD INDEX idx_radius_deleted_at (deleted_at);

ALTER TABLE ip_pools ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE ip_pools ADD INDEX idx_ip_pools_deleted_at (deleted_at);

ALTER TABLE ip_assignments ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE ip_assignments ADD INDEX idx_ip_assignments_deleted_at (deleted_at);

ALTER TABLE network_links ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE network_links ADD INDEX idx_network_links_deleted_at (deleted_at);

ALTER TABLE vlans ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE vlans ADD INDEX idx_vlans_deleted_at (deleted_at);

ALTER TABLE outages ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE outages ADD INDEX idx_outages_deleted_at (deleted_at);

ALTER TABLE snmp_profiles ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE snmp_profiles ADD INDEX idx_snmp_profiles_deleted_at (deleted_at);

ALTER TABLE snmp_profile_oids ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE snmp_profile_oids ADD INDEX idx_snmp_profile_oids_deleted_at (deleted_at);

ALTER TABLE speed_tests ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE speed_tests ADD INDEX idx_speed_tests_deleted_at (deleted_at);

ALTER TABLE device_config_backups ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE device_config_backups ADD INDEX idx_device_config_backups_deleted_at (deleted_at);

ALTER TABLE firerelay_nodes ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE firerelay_nodes ADD INDEX idx_firerelay_nodes_deleted_at (deleted_at);

ALTER TABLE firerelay_client_routing ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE firerelay_client_routing ADD INDEX idx_firerelay_client_routing_deleted_at (deleted_at);

-- Infrastructure
ALTER TABLE service_areas ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE service_areas ADD INDEX idx_service_areas_deleted_at (deleted_at);

ALTER TABLE coverage_zones ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE coverage_zones ADD INDEX idx_coverage_zones_deleted_at (deleted_at);

ALTER TABLE warehouses ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE warehouses ADD INDEX idx_warehouses_deleted_at (deleted_at);

ALTER TABLE inventory_items ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE inventory_items ADD INDEX idx_inventory_items_deleted_at (deleted_at);

ALTER TABLE inventory_stock ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE inventory_stock ADD INDEX idx_inventory_stock_deleted_at (deleted_at);

ALTER TABLE files ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE files ADD INDEX idx_files_deleted_at (deleted_at);

ALTER TABLE notifications ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE notifications ADD INDEX idx_notifications_deleted_at (deleted_at);

ALTER TABLE message_templates ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE message_templates ADD INDEX idx_message_templates_deleted_at (deleted_at);

ALTER TABLE promotions ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE promotions ADD INDEX idx_promotions_deleted_at (deleted_at);

ALTER TABLE sla_definitions ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE sla_definitions ADD INDEX idx_sla_definitions_deleted_at (deleted_at);

ALTER TABLE suspension_rules ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE suspension_rules ADD INDEX idx_suspension_rules_deleted_at (deleted_at);

-- Auth & Security
ALTER TABLE api_tokens ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE api_tokens ADD INDEX idx_api_tokens_deleted_at (deleted_at);

ALTER TABLE roles ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE roles ADD INDEX idx_roles_deleted_at (deleted_at);

ALTER TABLE webhooks ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE webhooks ADD INDEX idx_webhooks_deleted_at (deleted_at);

ALTER TABLE alert_rules ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE alert_rules ADD INDEX idx_alert_rules_deleted_at (deleted_at);

-- MX Compliance
ALTER TABLE client_mx_profiles ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE client_mx_profiles ADD INDEX idx_client_mx_profiles_deleted_at (deleted_at);

ALTER TABLE organization_mx_profiles ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE organization_mx_profiles ADD INDEX idx_organization_mx_profiles_deleted_at (deleted_at);

ALTER TABLE contract_templates_mx ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE contract_templates_mx ADD INDEX idx_contract_templates_mx_deleted_at (deleted_at);

ALTER TABLE concession_titles ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE concession_titles ADD INDEX idx_concession_titles_deleted_at (deleted_at);

ALTER TABLE regulatory_filings ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE regulatory_filings ADD INDEX idx_regulatory_filings_deleted_at (deleted_at);

ALTER TABLE ift_statistical_reports ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE ift_statistical_reports ADD INDEX idx_ift_statistical_reports_deleted_at (deleted_at);

ALTER TABLE csd_certificates ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE csd_certificates ADD INDEX idx_csd_certificates_deleted_at (deleted_at);

ALTER TABLE pac_providers ADD COLUMN deleted_at DATETIME DEFAULT NULL;
ALTER TABLE pac_providers ADD INDEX idx_pac_providers_deleted_at (deleted_at);
