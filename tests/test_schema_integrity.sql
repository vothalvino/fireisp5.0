-- =============================================================================
-- FireISP 5.0 — Schema Integrity Tests
-- =============================================================================
-- Verifies that all expected tables, triggers, and indexes exist after applying
-- the schema.  This catches accidental drops, renames, or migration ordering
-- problems.
-- =============================================================================

SOURCE tests/test_helpers.sql;

CALL test_begin('Schema Integrity');

-- =========================================================================
-- 1. Core tables exist
-- =========================================================================
CALL assert_table_exists('users',                   'Table: users exists');
CALL assert_table_exists('clients',                 'Table: clients exists');
CALL assert_table_exists('contacts',                'Table: contacts exists');
CALL assert_table_exists('sites',                   'Table: sites exists');
CALL assert_table_exists('plans',                   'Table: plans exists');
CALL assert_table_exists('contracts',               'Table: contracts exists');
CALL assert_table_exists('nas',                     'Table: nas exists');
CALL assert_table_exists('radius',                  'Table: radius exists');
CALL assert_table_exists('devices',                 'Table: devices exists');
CALL assert_table_exists('tickets',                 'Table: tickets exists');
CALL assert_table_exists('invoices',                'Table: invoices exists');
CALL assert_table_exists('payments',                'Table: payments exists');
CALL assert_table_exists('quotes',                  'Table: quotes exists');
CALL assert_table_exists('jobs',                    'Table: jobs exists');
CALL assert_table_exists('expenses',                'Table: expenses exists');
CALL assert_table_exists('organizations',           'Table: organizations exists');
CALL assert_table_exists('files',                   'Table: files exists');
CALL assert_table_exists('ip_pools',                'Table: ip_pools exists');
CALL assert_table_exists('ip_assignments',          'Table: ip_assignments exists');
CALL assert_table_exists('audit_logs',              'Table: audit_logs exists');
CALL assert_table_exists('notifications',           'Table: notifications exists');
CALL assert_table_exists('invoice_items',           'Table: invoice_items exists');
CALL assert_table_exists('quote_items',             'Table: quote_items exists');
CALL assert_table_exists('ticket_comments',         'Table: ticket_comments exists');

-- SNMP tables
CALL assert_table_exists('snmp_metrics',            'Table: snmp_metrics exists');
CALL assert_table_exists('snmp_metrics_1hr',        'Table: snmp_metrics_1hr exists');
CALL assert_table_exists('snmp_metrics_1day',       'Table: snmp_metrics_1day exists');
CALL assert_table_exists('snmp_profiles',           'Table: snmp_profiles exists');
CALL assert_table_exists('snmp_profile_oids',       'Table: snmp_profile_oids exists');

-- Additional core tables
CALL assert_table_exists('connection_logs',         'Table: connection_logs exists');
CALL assert_table_exists('credit_notes',            'Table: credit_notes exists');
CALL assert_table_exists('credit_note_items',       'Table: credit_note_items exists');
CALL assert_table_exists('warehouses',              'Table: warehouses exists');
CALL assert_table_exists('inventory_items',         'Table: inventory_items exists');
CALL assert_table_exists('inventory_stock',         'Table: inventory_stock exists');
CALL assert_table_exists('inventory_transactions',  'Table: inventory_transactions exists');
CALL assert_table_exists('payment_allocations',     'Table: payment_allocations exists');
CALL assert_table_exists('billing_periods',         'Table: billing_periods exists');
CALL assert_table_exists('network_links',           'Table: network_links exists');
CALL assert_table_exists('settings',                'Table: settings exists');
CALL assert_table_exists('tax_rules',               'Table: tax_rules exists');
CALL assert_table_exists('client_balance_ledger',   'Table: client_balance_ledger exists');
CALL assert_table_exists('email_logs',              'Table: email_logs exists');
CALL assert_table_exists('scheduled_tasks',         'Table: scheduled_tasks exists');
CALL assert_table_exists('user_sessions',           'Table: user_sessions exists');
CALL assert_table_exists('roles',                   'Table: roles exists');
CALL assert_table_exists('permissions',             'Table: permissions exists');
CALL assert_table_exists('role_permissions',        'Table: role_permissions exists');
CALL assert_table_exists('outages',                 'Table: outages exists');
CALL assert_table_exists('vlans',                   'Table: vlans exists');
CALL assert_table_exists('tax_rates',               'Table: tax_rates exists');
CALL assert_table_exists('message_templates',       'Table: message_templates exists');
CALL assert_table_exists('api_tokens',              'Table: api_tokens exists');
CALL assert_table_exists('promotions',              'Table: promotions exists');
CALL assert_table_exists('service_areas',           'Table: service_areas exists');
CALL assert_table_exists('coverage_zones',          'Table: coverage_zones exists');
CALL assert_table_exists('sla_definitions',         'Table: sla_definitions exists');
CALL assert_table_exists('device_config_backups',   'Table: device_config_backups exists');
CALL assert_table_exists('schema_migrations',       'Table: schema_migrations exists');

-- MX-specific tables
CALL assert_table_exists('client_mx_profiles',      'Table: client_mx_profiles exists');
CALL assert_table_exists('organization_mx_profiles', 'Table: organization_mx_profiles exists');
CALL assert_table_exists('sat_regimen_fiscal',      'Table: sat_regimen_fiscal exists');
CALL assert_table_exists('sat_uso_cfdi',            'Table: sat_uso_cfdi exists');
CALL assert_table_exists('sat_forma_pago',          'Table: sat_forma_pago exists');
CALL assert_table_exists('sat_metodo_pago',         'Table: sat_metodo_pago exists');
CALL assert_table_exists('sat_tipo_comprobante',    'Table: sat_tipo_comprobante exists');
CALL assert_table_exists('sat_moneda',              'Table: sat_moneda exists');
CALL assert_table_exists('sat_clave_prod_serv',     'Table: sat_clave_prod_serv exists');
CALL assert_table_exists('sat_clave_unidad',        'Table: sat_clave_unidad exists');
CALL assert_table_exists('cfdi_documents',          'Table: cfdi_documents exists');
CALL assert_table_exists('cfdi_related_documents',  'Table: cfdi_related_documents exists');
CALL assert_table_exists('cfdi_payment_complements', 'Table: cfdi_payment_complements exists');
CALL assert_table_exists('cfdi_payment_complement_items', 'Table: cfdi_payment_complement_items exists');
CALL assert_table_exists('cfdi_payment_complement_item_taxes', 'Table: cfdi_payment_complement_item_taxes exists');
CALL assert_table_exists('cfdi_conceptos',          'Table: cfdi_conceptos exists');
CALL assert_table_exists('cfdi_concepto_impuestos', 'Table: cfdi_concepto_impuestos exists');
CALL assert_table_exists('concession_titles',       'Table: concession_titles exists');
CALL assert_table_exists('contract_templates_mx',   'Table: contract_templates_mx exists');
CALL assert_table_exists('regulatory_filings',      'Table: regulatory_filings exists');
CALL assert_table_exists('ift_statistical_reports', 'Table: ift_statistical_reports exists');
CALL assert_table_exists('factura_publica_invoices', 'Table: factura_publica_invoices exists');
CALL assert_table_exists('factura_publica_invoice_items', 'Table: factura_publica_invoice_items exists');

-- Migrations 101-118 tables
CALL assert_table_exists('payment_gateways',        'Table: payment_gateways exists');
CALL assert_table_exists('payment_transactions',    'Table: payment_transactions exists');
CALL assert_table_exists('recurring_payment_profiles', 'Table: recurring_payment_profiles exists');
CALL assert_table_exists('suspension_rules',        'Table: suspension_rules exists');
CALL assert_table_exists('suspension_logs',         'Table: suspension_logs exists');
CALL assert_table_exists('csd_certificates',        'Table: csd_certificates exists');
CALL assert_table_exists('pac_providers',           'Table: pac_providers exists');
CALL assert_table_exists('webhooks',                'Table: webhooks exists');
CALL assert_table_exists('webhook_deliveries',      'Table: webhook_deliveries exists');
CALL assert_table_exists('organization_users',      'Table: organization_users exists');
CALL assert_table_exists('plan_addons',             'Table: plan_addons exists');
CALL assert_table_exists('contract_addons',         'Table: contract_addons exists');
CALL assert_table_exists('speed_tests',             'Table: speed_tests exists');
CALL assert_table_exists('ticket_sla_events',       'Table: ticket_sla_events exists');
CALL assert_table_exists('sms_logs',                'Table: sms_logs exists');
CALL assert_table_exists('revenue_summary',         'Table: revenue_summary exists');
CALL assert_table_exists('network_health_snapshots', 'Table: network_health_snapshots exists');
CALL assert_table_exists('cfdi_cancellations',      'Table: cfdi_cancellations exists');

-- =========================================================================
-- 2. All triggers exist
-- =========================================================================

-- MX locale enforcement triggers (migration 087)
CALL assert_trigger_exists('trg_client_mx_profiles_bi',          'Trigger: trg_client_mx_profiles_bi exists');
CALL assert_trigger_exists('trg_client_mx_profiles_bu',          'Trigger: trg_client_mx_profiles_bu exists');
CALL assert_trigger_exists('trg_organization_mx_profiles_bi',    'Trigger: trg_organization_mx_profiles_bi exists');
CALL assert_trigger_exists('trg_organization_mx_profiles_bu',    'Trigger: trg_organization_mx_profiles_bu exists');
CALL assert_trigger_exists('trg_cfdi_documents_bi',              'Trigger: trg_cfdi_documents_bi exists');
CALL assert_trigger_exists('trg_cfdi_documents_bu',              'Trigger: trg_cfdi_documents_bu exists');
CALL assert_trigger_exists('trg_concession_titles_bi',           'Trigger: trg_concession_titles_bi exists');
CALL assert_trigger_exists('trg_concession_titles_bu',           'Trigger: trg_concession_titles_bu exists');
CALL assert_trigger_exists('trg_contract_templates_mx_bi',       'Trigger: trg_contract_templates_mx_bi exists');
CALL assert_trigger_exists('trg_contract_templates_mx_bu',       'Trigger: trg_contract_templates_mx_bu exists');
CALL assert_trigger_exists('trg_regulatory_filings_bi',          'Trigger: trg_regulatory_filings_bi exists');
CALL assert_trigger_exists('trg_regulatory_filings_bu',          'Trigger: trg_regulatory_filings_bu exists');
CALL assert_trigger_exists('trg_ift_statistical_reports_bi',     'Trigger: trg_ift_statistical_reports_bi exists');
CALL assert_trigger_exists('trg_ift_statistical_reports_bu',     'Trigger: trg_ift_statistical_reports_bu exists');
CALL assert_trigger_exists('trg_contracts_mx_template_bi',       'Trigger: trg_contracts_mx_template_bi exists');
CALL assert_trigger_exists('trg_contracts_mx_template_bu',       'Trigger: trg_contracts_mx_template_bu exists');

-- Locale downgrade guard triggers (migration 088)
CALL assert_trigger_exists('trg_clients_locale_downgrade_bu',    'Trigger: trg_clients_locale_downgrade_bu exists');
CALL assert_trigger_exists('trg_organizations_locale_downgrade_bu', 'Trigger: trg_organizations_locale_downgrade_bu exists');

-- Factura pública stamping safeguards (migration 091)
CALL assert_trigger_exists('trg_factura_publica_invoices_bu',    'Trigger: trg_factura_publica_invoices_bu exists');
CALL assert_trigger_exists('trg_factura_publica_invoice_items_bi', 'Trigger: trg_factura_publica_invoice_items_bi exists');

-- Facturar guard triggers (migration 097)
CALL assert_trigger_exists('trg_contracts_facturar_bi',          'Trigger: trg_contracts_facturar_bi exists');
CALL assert_trigger_exists('trg_contracts_facturar_bu',          'Trigger: trg_contracts_facturar_bu exists');

-- Payment allocation balance guard triggers (migration 126)
CALL assert_trigger_exists('trg_payment_alloc_payment_bi',       'Trigger: trg_payment_alloc_payment_bi exists');
CALL assert_trigger_exists('trg_payment_alloc_payment_bu',       'Trigger: trg_payment_alloc_payment_bu exists');
CALL assert_trigger_exists('trg_payment_alloc_invoice_bi',       'Trigger: trg_payment_alloc_invoice_bi exists');
CALL assert_trigger_exists('trg_payment_alloc_invoice_bu',       'Trigger: trg_payment_alloc_invoice_bu exists');

-- Inventory stock negative guard (migration 127)
CALL assert_trigger_exists('trg_inventory_stock_negative_bu',    'Trigger: trg_inventory_stock_negative_bu exists');

-- RADIUS consistency trigger (migration 128)
CALL assert_trigger_exists('trg_contracts_radius_consistency_bu', 'Trigger: trg_contracts_radius_consistency_bu exists');

-- =========================================================================
-- 3. Key indexes exist (migration 129 + inline definitions)
-- =========================================================================
CALL assert_index_exists('users',        'uq_users_email',                  'Index: users.uq_users_email');
CALL assert_index_exists('clients',      'idx_clients_locale',              'Index: clients.idx_clients_locale');
CALL assert_index_exists('clients',      'idx_clients_status',              'Index: clients.idx_clients_status');
CALL assert_index_exists('contracts',    'idx_contracts_client_id',         'Index: contracts.idx_contracts_client_id');
CALL assert_index_exists('contracts',    'idx_contracts_status',            'Index: contracts.idx_contracts_status');
CALL assert_index_exists('contracts',    'idx_contracts_connection_type',   'Index: contracts.idx_contracts_connection_type');
CALL assert_index_exists('contracts',    'idx_contracts_facturar',          'Index: contracts.idx_contracts_facturar');
CALL assert_index_exists('invoices',     'uq_invoices_number',             'Index: invoices.uq_invoices_number');
CALL assert_index_exists('invoices',     'idx_invoices_client_id',         'Index: invoices.idx_invoices_client_id');
CALL assert_index_exists('invoices',     'idx_invoices_status',            'Index: invoices.idx_invoices_status');
CALL assert_index_exists('invoices',     'idx_invoices_due_date',          'Index: invoices.idx_invoices_due_date');
CALL assert_index_exists('payments',     'idx_payments_client_id',         'Index: payments.idx_payments_client_id');
CALL assert_index_exists('payments',     'idx_payments_payment_date',      'Index: payments.idx_payments_payment_date');
CALL assert_index_exists('nas',          'uq_nas_ip_address',              'Index: nas.uq_nas_ip_address');
CALL assert_index_exists('radius',       'uq_radius_username',             'Index: radius.uq_radius_username');
CALL assert_index_exists('devices',      'uq_devices_serial_number',       'Index: devices.uq_devices_serial_number');
CALL assert_index_exists('tickets',      'idx_tickets_status',             'Index: tickets.idx_tickets_status');
CALL assert_index_exists('ip_assignments', 'uq_ip_assignments_ip',         'Index: ip_assignments.uq_ip_assignments_ip');

-- =========================================================================
-- 4. Key columns exist with expected properties
-- =========================================================================
CALL assert_column_exists('contracts', 'facturar',                'Column: contracts.facturar');
CALL assert_column_exists('contracts', 'connection_type',         'Column: contracts.connection_type');
CALL assert_column_exists('contracts', 'contract_template_mx_id', 'Column: contracts.contract_template_mx_id');
CALL assert_column_exists('clients',   'locale',                  'Column: clients.locale');
CALL assert_column_exists('organizations', 'locale',              'Column: organizations.locale');
CALL assert_column_exists('payments',  'sat_forma_pago',          'Column: payments.sat_forma_pago');
CALL assert_column_exists('payments',  'clabe',                   'Column: payments.clabe');
CALL assert_column_exists('cfdi_documents', 'exportacion',        'Column: cfdi_documents.exportacion');
CALL assert_column_exists('cfdi_documents', 'uuid',               'Column: cfdi_documents.uuid');
CALL assert_column_exists('cfdi_payment_complement_items', 'objeto_imp_dr', 'Column: cfdi_payment_complement_items.objeto_imp_dr');
CALL assert_column_exists('inventory_stock', 'quantity',          'Column: inventory_stock.quantity');
CALL assert_column_exists('invoices', 'currency',                 'Column: invoices.currency');
CALL assert_column_exists('expenses', 'currency',                 'Column: expenses.currency');

-- =========================================================================
-- 5. Stored function exists
-- =========================================================================
-- fn_predominant_forma_pago (migration 091)
SET @fn_count = 0;
SELECT COUNT(*) INTO @fn_count
FROM   INFORMATION_SCHEMA.ROUTINES
WHERE  ROUTINE_SCHEMA = DATABASE()
  AND  ROUTINE_NAME   = 'fn_predominant_forma_pago'
  AND  ROUTINE_TYPE   = 'FUNCTION';
CALL assert_true(@fn_count = 1, 'Function: fn_predominant_forma_pago exists');

CALL test_summary();
