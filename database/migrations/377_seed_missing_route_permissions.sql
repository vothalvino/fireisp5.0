-- =============================================================================
-- Migration 377: Seed missing route permissions (Pattern G backfill)
-- =============================================================================
-- Every slug below is referenced by a live `requirePermission(...)` route guard
-- but had no `permissions` row, so every account except legacy users.role='admin'
-- received a silent 403 on those endpoints (src/middleware/rbac.js does exact
-- slug matching against role_permissions; an unseeded slug can never be granted).
--
-- 126 slugs across 42 modules, including the full SAT fiscal surface
-- (cfdi_documents, facturas_publicas, csd_certificates, pac_providers), billing
-- (quotes, credit_notes, payment gateways), network ops, and platform admin.
-- Also seeds sms.view/sms.send for the corrected slugs in src/routes/sms.js
-- (previously the un-seedable bare names 'read'/'write').
--
-- Grants follow the established matrix (119/205/321/335):
--   super_admin        — every action incl. platform-level ops
--   admin              — every action EXCEPT platform-level ops
--                        (organizations.create/delete, roles.manage stay
--                        super_admin-only; the /organizations router is not
--                        org-scoped and roles/role_permissions are global)
--   billing            — full billing family incl. SAT fiscal modules + exports
--   technician         — full field/network ops modules (minus inventory.delete,
--                        which also guards warehouse deletion — admin-level)
--   noc_operator       — network view/update, full outages, monitoring views
--                        (incl. the 236-era connection_logs.summary and
--                        ip_pools.utilization its dashboards require)
--   support            — customer-facing views + SMS send
--   readonly, auditor  — every *.view / *.export EXCEPT credential-bearing
--                        modules (api_tokens, webhooks, device_config_backups,
--                        payment_gateways, pac_providers, csd_certificates),
--                        mirroring 335's security exception
--   reseller_admin     — intentionally none (reseller surface uses its own
--                        scoped routes; grant explicitly when needed)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Permissions
-- ---------------------------------------------------------------------------

-- Module: api_tokens
INSERT INTO permissions (name, description, module)
SELECT 'api_tokens.view', 'View API tokens', 'api_tokens'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'api_tokens.view');
INSERT INTO permissions (name, description, module)
SELECT 'api_tokens.create', 'Create API tokens', 'api_tokens'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'api_tokens.create');
INSERT INTO permissions (name, description, module)
SELECT 'api_tokens.update', 'Update API tokens', 'api_tokens'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'api_tokens.update');
INSERT INTO permissions (name, description, module)
SELECT 'api_tokens.delete', 'Delete API tokens', 'api_tokens'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'api_tokens.delete');

-- Module: cfdi_documents
INSERT INTO permissions (name, description, module)
SELECT 'cfdi_documents.view', 'View CFDI documents (SAT fiscal invoices)', 'cfdi_documents'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'cfdi_documents.view');
INSERT INTO permissions (name, description, module)
SELECT 'cfdi_documents.create', 'Create CFDI documents (SAT fiscal invoices)', 'cfdi_documents'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'cfdi_documents.create');
INSERT INTO permissions (name, description, module)
SELECT 'cfdi_documents.update', 'Update CFDI documents (SAT fiscal invoices)', 'cfdi_documents'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'cfdi_documents.update');

-- Module: connection_logs
INSERT INTO permissions (name, description, module)
SELECT 'connection_logs.view', 'View subscriber connection logs', 'connection_logs'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'connection_logs.view');

-- Module: coverage_zones
INSERT INTO permissions (name, description, module)
SELECT 'coverage_zones.view', 'View coverage zones', 'coverage_zones'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'coverage_zones.view');
INSERT INTO permissions (name, description, module)
SELECT 'coverage_zones.create', 'Create coverage zones', 'coverage_zones'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'coverage_zones.create');
INSERT INTO permissions (name, description, module)
SELECT 'coverage_zones.update', 'Update coverage zones', 'coverage_zones'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'coverage_zones.update');
INSERT INTO permissions (name, description, module)
SELECT 'coverage_zones.delete', 'Delete coverage zones', 'coverage_zones'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'coverage_zones.delete');

-- Module: credit_notes
INSERT INTO permissions (name, description, module)
SELECT 'credit_notes.view', 'View credit notes', 'credit_notes'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'credit_notes.view');
INSERT INTO permissions (name, description, module)
SELECT 'credit_notes.create', 'Create credit notes', 'credit_notes'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'credit_notes.create');
INSERT INTO permissions (name, description, module)
SELECT 'credit_notes.update', 'Update credit notes', 'credit_notes'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'credit_notes.update');
INSERT INTO permissions (name, description, module)
SELECT 'credit_notes.delete', 'Delete credit notes', 'credit_notes'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'credit_notes.delete');

-- Module: csd_certificates
INSERT INTO permissions (name, description, module)
SELECT 'csd_certificates.view', 'View CSD certificates (SAT digital seals)', 'csd_certificates'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'csd_certificates.view');
INSERT INTO permissions (name, description, module)
SELECT 'csd_certificates.create', 'Create CSD certificates (SAT digital seals)', 'csd_certificates'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'csd_certificates.create');
INSERT INTO permissions (name, description, module)
SELECT 'csd_certificates.update', 'Update CSD certificates (SAT digital seals)', 'csd_certificates'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'csd_certificates.update');
INSERT INTO permissions (name, description, module)
SELECT 'csd_certificates.delete', 'Delete CSD certificates (SAT digital seals)', 'csd_certificates'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'csd_certificates.delete');

-- Module: device_config_backups
INSERT INTO permissions (name, description, module)
SELECT 'device_config_backups.view', 'View device configuration backups', 'device_config_backups'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'device_config_backups.view');
INSERT INTO permissions (name, description, module)
SELECT 'device_config_backups.create', 'Create device configuration backups', 'device_config_backups'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'device_config_backups.create');
INSERT INTO permissions (name, description, module)
SELECT 'device_config_backups.update', 'Update device configuration backups', 'device_config_backups'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'device_config_backups.update');
INSERT INTO permissions (name, description, module)
SELECT 'device_config_backups.delete', 'Delete device configuration backups', 'device_config_backups'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'device_config_backups.delete');

-- Module: facturas_publicas
INSERT INTO permissions (name, description, module)
SELECT 'facturas_publicas.view', 'View facturas publicas (CFDI to public)', 'facturas_publicas'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'facturas_publicas.view');
INSERT INTO permissions (name, description, module)
SELECT 'facturas_publicas.create', 'Create facturas publicas (CFDI to public)', 'facturas_publicas'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'facturas_publicas.create');
INSERT INTO permissions (name, description, module)
SELECT 'facturas_publicas.update', 'Update facturas publicas (CFDI to public)', 'facturas_publicas'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'facturas_publicas.update');

-- Module: files
INSERT INTO permissions (name, description, module)
SELECT 'files.view', 'View stored files', 'files'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'files.view');
INSERT INTO permissions (name, description, module)
SELECT 'files.create', 'Create stored files', 'files'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'files.create');
INSERT INTO permissions (name, description, module)
SELECT 'files.update', 'Update stored files', 'files'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'files.update');
INSERT INTO permissions (name, description, module)
SELECT 'files.delete', 'Delete stored files', 'files'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'files.delete');

-- Module: ip_assignments
INSERT INTO permissions (name, description, module)
SELECT 'ip_assignments.view', 'View IP address assignments', 'ip_assignments'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ip_assignments.view');
INSERT INTO permissions (name, description, module)
SELECT 'ip_assignments.create', 'Create IP address assignments', 'ip_assignments'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ip_assignments.create');
INSERT INTO permissions (name, description, module)
SELECT 'ip_assignments.update', 'Update IP address assignments', 'ip_assignments'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ip_assignments.update');
INSERT INTO permissions (name, description, module)
SELECT 'ip_assignments.delete', 'Delete IP address assignments', 'ip_assignments'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ip_assignments.delete');

-- Module: ip_pools
INSERT INTO permissions (name, description, module)
SELECT 'ip_pools.view', 'View IP address pools', 'ip_pools'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ip_pools.view');
INSERT INTO permissions (name, description, module)
SELECT 'ip_pools.create', 'Create IP address pools', 'ip_pools'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ip_pools.create');
INSERT INTO permissions (name, description, module)
SELECT 'ip_pools.update', 'Update IP address pools', 'ip_pools'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ip_pools.update');
INSERT INTO permissions (name, description, module)
SELECT 'ip_pools.delete', 'Delete IP address pools', 'ip_pools'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ip_pools.delete');

-- Module: network_health
INSERT INTO permissions (name, description, module)
SELECT 'network_health.view', 'View network health rollups', 'network_health'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'network_health.view');

-- Module: network_links
INSERT INTO permissions (name, description, module)
SELECT 'network_links.view', 'View network links', 'network_links'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'network_links.view');
INSERT INTO permissions (name, description, module)
SELECT 'network_links.create', 'Create network links', 'network_links'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'network_links.create');
INSERT INTO permissions (name, description, module)
SELECT 'network_links.update', 'Update network links', 'network_links'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'network_links.update');
INSERT INTO permissions (name, description, module)
SELECT 'network_links.delete', 'Delete network links', 'network_links'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'network_links.delete');

-- Module: outages
INSERT INTO permissions (name, description, module)
SELECT 'outages.view', 'View network outages', 'outages'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'outages.view');
INSERT INTO permissions (name, description, module)
SELECT 'outages.create', 'Create network outages', 'outages'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'outages.create');
INSERT INTO permissions (name, description, module)
SELECT 'outages.update', 'Update network outages', 'outages'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'outages.update');
INSERT INTO permissions (name, description, module)
SELECT 'outages.delete', 'Delete network outages', 'outages'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'outages.delete');

-- Module: pac_providers
INSERT INTO permissions (name, description, module)
SELECT 'pac_providers.view', 'View PAC stamping providers', 'pac_providers'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'pac_providers.view');
INSERT INTO permissions (name, description, module)
SELECT 'pac_providers.create', 'Create PAC stamping providers', 'pac_providers'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'pac_providers.create');
INSERT INTO permissions (name, description, module)
SELECT 'pac_providers.update', 'Update PAC stamping providers', 'pac_providers'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'pac_providers.update');
INSERT INTO permissions (name, description, module)
SELECT 'pac_providers.delete', 'Delete PAC stamping providers', 'pac_providers'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'pac_providers.delete');

-- Module: payment_gateways
INSERT INTO permissions (name, description, module)
SELECT 'payment_gateways.view', 'View payment gateway configurations', 'payment_gateways'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'payment_gateways.view');
INSERT INTO permissions (name, description, module)
SELECT 'payment_gateways.create', 'Create payment gateway configurations', 'payment_gateways'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'payment_gateways.create');
INSERT INTO permissions (name, description, module)
SELECT 'payment_gateways.update', 'Update payment gateway configurations', 'payment_gateways'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'payment_gateways.update');
INSERT INTO permissions (name, description, module)
SELECT 'payment_gateways.delete', 'Delete payment gateway configurations', 'payment_gateways'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'payment_gateways.delete');

-- Module: payment_transactions
INSERT INTO permissions (name, description, module)
SELECT 'payment_transactions.view', 'View payment gateway transactions', 'payment_transactions'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'payment_transactions.view');

-- Module: promotions
INSERT INTO permissions (name, description, module)
SELECT 'promotions.view', 'View promotions', 'promotions'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'promotions.view');
INSERT INTO permissions (name, description, module)
SELECT 'promotions.create', 'Create promotions', 'promotions'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'promotions.create');
INSERT INTO permissions (name, description, module)
SELECT 'promotions.update', 'Update promotions', 'promotions'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'promotions.update');
INSERT INTO permissions (name, description, module)
SELECT 'promotions.delete', 'Delete promotions', 'promotions'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'promotions.delete');

-- Module: quotes
INSERT INTO permissions (name, description, module)
SELECT 'quotes.view', 'View sales quotes', 'quotes'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'quotes.view');
INSERT INTO permissions (name, description, module)
SELECT 'quotes.create', 'Create sales quotes', 'quotes'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'quotes.create');
INSERT INTO permissions (name, description, module)
SELECT 'quotes.update', 'Update sales quotes', 'quotes'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'quotes.update');
INSERT INTO permissions (name, description, module)
SELECT 'quotes.delete', 'Delete sales quotes', 'quotes'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'quotes.delete');

-- Module: recurring_payment_profiles
INSERT INTO permissions (name, description, module)
SELECT 'recurring_payment_profiles.view', 'View recurring payment profiles', 'recurring_payment_profiles'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'recurring_payment_profiles.view');
INSERT INTO permissions (name, description, module)
SELECT 'recurring_payment_profiles.create', 'Create recurring payment profiles', 'recurring_payment_profiles'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'recurring_payment_profiles.create');
INSERT INTO permissions (name, description, module)
SELECT 'recurring_payment_profiles.update', 'Update recurring payment profiles', 'recurring_payment_profiles'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'recurring_payment_profiles.update');
INSERT INTO permissions (name, description, module)
SELECT 'recurring_payment_profiles.delete', 'Delete recurring payment profiles', 'recurring_payment_profiles'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'recurring_payment_profiles.delete');

-- Module: revenue_summary
INSERT INTO permissions (name, description, module)
SELECT 'revenue_summary.view', 'View revenue summary reports', 'revenue_summary'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'revenue_summary.view');

-- Module: roles
INSERT INTO permissions (name, description, module)
SELECT 'roles.view', 'View RBAC roles', 'roles'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'roles.view');
INSERT INTO permissions (name, description, module)
SELECT 'roles.manage', 'Manage RBAC roles', 'roles'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'roles.manage');

-- Module: scheduled_tasks
INSERT INTO permissions (name, description, module)
SELECT 'scheduled_tasks.view', 'View scheduled tasks', 'scheduled_tasks'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'scheduled_tasks.view');
INSERT INTO permissions (name, description, module)
SELECT 'scheduled_tasks.create', 'Create scheduled tasks', 'scheduled_tasks'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'scheduled_tasks.create');
INSERT INTO permissions (name, description, module)
SELECT 'scheduled_tasks.update', 'Update scheduled tasks', 'scheduled_tasks'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'scheduled_tasks.update');
INSERT INTO permissions (name, description, module)
SELECT 'scheduled_tasks.delete', 'Delete scheduled tasks', 'scheduled_tasks'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'scheduled_tasks.delete');

-- Module: service_areas
INSERT INTO permissions (name, description, module)
SELECT 'service_areas.view', 'View service areas', 'service_areas'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'service_areas.view');
INSERT INTO permissions (name, description, module)
SELECT 'service_areas.create', 'Create service areas', 'service_areas'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'service_areas.create');
INSERT INTO permissions (name, description, module)
SELECT 'service_areas.update', 'Update service areas', 'service_areas'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'service_areas.update');
INSERT INTO permissions (name, description, module)
SELECT 'service_areas.delete', 'Delete service areas', 'service_areas'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'service_areas.delete');

-- Module: sites
INSERT INTO permissions (name, description, module)
SELECT 'sites.view', 'View infrastructure sites', 'sites'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'sites.view');
INSERT INTO permissions (name, description, module)
SELECT 'sites.create', 'Create infrastructure sites', 'sites'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'sites.create');
INSERT INTO permissions (name, description, module)
SELECT 'sites.update', 'Update infrastructure sites', 'sites'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'sites.update');
INSERT INTO permissions (name, description, module)
SELECT 'sites.delete', 'Delete infrastructure sites', 'sites'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'sites.delete');

-- Module: sla_definitions
INSERT INTO permissions (name, description, module)
SELECT 'sla_definitions.view', 'View SLA definitions', 'sla_definitions'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'sla_definitions.view');
INSERT INTO permissions (name, description, module)
SELECT 'sla_definitions.create', 'Create SLA definitions', 'sla_definitions'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'sla_definitions.create');
INSERT INTO permissions (name, description, module)
SELECT 'sla_definitions.update', 'Update SLA definitions', 'sla_definitions'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'sla_definitions.update');
INSERT INTO permissions (name, description, module)
SELECT 'sla_definitions.delete', 'Delete SLA definitions', 'sla_definitions'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'sla_definitions.delete');

-- Module: sms
INSERT INTO permissions (name, description, module)
SELECT 'sms.view', 'View SMS messages', 'sms'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'sms.view');
INSERT INTO permissions (name, description, module)
SELECT 'sms.send', 'Send SMS messages', 'sms'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'sms.send');

-- Module: snmp_profiles
INSERT INTO permissions (name, description, module)
SELECT 'snmp_profiles.view', 'View SNMP profiles', 'snmp_profiles'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'snmp_profiles.view');
INSERT INTO permissions (name, description, module)
SELECT 'snmp_profiles.create', 'Create SNMP profiles', 'snmp_profiles'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'snmp_profiles.create');
INSERT INTO permissions (name, description, module)
SELECT 'snmp_profiles.update', 'Update SNMP profiles', 'snmp_profiles'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'snmp_profiles.update');
INSERT INTO permissions (name, description, module)
SELECT 'snmp_profiles.delete', 'Delete SNMP profiles', 'snmp_profiles'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'snmp_profiles.delete');

-- Module: speed_tests
INSERT INTO permissions (name, description, module)
SELECT 'speed_tests.view', 'View speed tests', 'speed_tests'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'speed_tests.view');
INSERT INTO permissions (name, description, module)
SELECT 'speed_tests.create', 'Create speed tests', 'speed_tests'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'speed_tests.create');
INSERT INTO permissions (name, description, module)
SELECT 'speed_tests.update', 'Update speed tests', 'speed_tests'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'speed_tests.update');
INSERT INTO permissions (name, description, module)
SELECT 'speed_tests.delete', 'Delete speed tests', 'speed_tests'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'speed_tests.delete');

-- Module: suspension_rules
INSERT INTO permissions (name, description, module)
SELECT 'suspension_rules.view', 'View suspension rules', 'suspension_rules'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'suspension_rules.view');
INSERT INTO permissions (name, description, module)
SELECT 'suspension_rules.create', 'Create suspension rules', 'suspension_rules'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'suspension_rules.create');
INSERT INTO permissions (name, description, module)
SELECT 'suspension_rules.update', 'Update suspension rules', 'suspension_rules'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'suspension_rules.update');
INSERT INTO permissions (name, description, module)
SELECT 'suspension_rules.delete', 'Delete suspension rules', 'suspension_rules'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'suspension_rules.delete');

-- Module: tax_rates
INSERT INTO permissions (name, description, module)
SELECT 'tax_rates.view', 'View tax rates', 'tax_rates'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'tax_rates.view');
INSERT INTO permissions (name, description, module)
SELECT 'tax_rates.create', 'Create tax rates', 'tax_rates'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'tax_rates.create');
INSERT INTO permissions (name, description, module)
SELECT 'tax_rates.update', 'Update tax rates', 'tax_rates'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'tax_rates.update');
INSERT INTO permissions (name, description, module)
SELECT 'tax_rates.delete', 'Delete tax rates', 'tax_rates'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'tax_rates.delete');

-- Module: tax_rules
INSERT INTO permissions (name, description, module)
SELECT 'tax_rules.view', 'View tax rules', 'tax_rules'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'tax_rules.view');
INSERT INTO permissions (name, description, module)
SELECT 'tax_rules.create', 'Create tax rules', 'tax_rules'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'tax_rules.create');
INSERT INTO permissions (name, description, module)
SELECT 'tax_rules.update', 'Update tax rules', 'tax_rules'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'tax_rules.update');
INSERT INTO permissions (name, description, module)
SELECT 'tax_rules.delete', 'Delete tax rules', 'tax_rules'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'tax_rules.delete');

-- Module: vlans
INSERT INTO permissions (name, description, module)
SELECT 'vlans.view', 'View VLANs', 'vlans'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'vlans.view');
INSERT INTO permissions (name, description, module)
SELECT 'vlans.create', 'Create VLANs', 'vlans'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'vlans.create');
INSERT INTO permissions (name, description, module)
SELECT 'vlans.update', 'Update VLANs', 'vlans'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'vlans.update');
INSERT INTO permissions (name, description, module)
SELECT 'vlans.delete', 'Delete VLANs', 'vlans'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'vlans.delete');

-- Module: webhooks
INSERT INTO permissions (name, description, module)
SELECT 'webhooks.view', 'View webhooks', 'webhooks'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'webhooks.view');
INSERT INTO permissions (name, description, module)
SELECT 'webhooks.create', 'Create webhooks', 'webhooks'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'webhooks.create');
INSERT INTO permissions (name, description, module)
SELECT 'webhooks.update', 'Update webhooks', 'webhooks'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'webhooks.update');
INSERT INTO permissions (name, description, module)
SELECT 'webhooks.delete', 'Delete webhooks', 'webhooks'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'webhooks.delete');

-- Standalone actions on already-seeded modules
INSERT INTO permissions (name, description, module)
SELECT 'clients.export', 'Export clients as CSV', 'clients'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'clients.export');
INSERT INTO permissions (name, description, module)
SELECT 'contracts.export', 'Export contracts as CSV', 'contracts'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'contracts.export');
INSERT INTO permissions (name, description, module)
SELECT 'invoices.export', 'Export invoices as CSV', 'invoices'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'invoices.export');
INSERT INTO permissions (name, description, module)
SELECT 'payments.export', 'Export payments as CSV', 'payments'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'payments.export');
INSERT INTO permissions (name, description, module)
SELECT 'expenses.delete', 'Delete expenses', 'expenses'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'expenses.delete');
INSERT INTO permissions (name, description, module)
SELECT 'inventory.delete', 'Delete inventory items', 'inventory'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'inventory.delete');
INSERT INTO permissions (name, description, module)
SELECT 'organizations.create', 'Create organizations', 'organizations'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'organizations.create');
INSERT INTO permissions (name, description, module)
SELECT 'organizations.delete', 'Delete organizations', 'organizations'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'organizations.delete');

-- ---------------------------------------------------------------------------
-- 2. Role grants
-- ---------------------------------------------------------------------------

-- admin: 123 grants
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'api_tokens.create', 'api_tokens.delete', 'api_tokens.update',
  'api_tokens.view', 'cfdi_documents.create', 'cfdi_documents.update',
  'cfdi_documents.view', 'clients.export', 'connection_logs.view',
  'contracts.export', 'coverage_zones.create', 'coverage_zones.delete',
  'coverage_zones.update', 'coverage_zones.view', 'credit_notes.create',
  'credit_notes.delete', 'credit_notes.update', 'credit_notes.view',
  'csd_certificates.create', 'csd_certificates.delete', 'csd_certificates.update',
  'csd_certificates.view', 'device_config_backups.create', 'device_config_backups.delete',
  'device_config_backups.update', 'device_config_backups.view', 'expenses.delete',
  'facturas_publicas.create', 'facturas_publicas.update', 'facturas_publicas.view',
  'files.create', 'files.delete', 'files.update',
  'files.view', 'inventory.delete', 'invoices.export',
  'ip_assignments.create', 'ip_assignments.delete', 'ip_assignments.update',
  'ip_assignments.view', 'ip_pools.create', 'ip_pools.delete',
  'ip_pools.update', 'ip_pools.view', 'network_health.view',
  'network_links.create', 'network_links.delete', 'network_links.update',
  'network_links.view', 'outages.create', 'outages.delete',
  'outages.update', 'outages.view', 'pac_providers.create',
  'pac_providers.delete', 'pac_providers.update', 'pac_providers.view',
  'payment_gateways.create', 'payment_gateways.delete', 'payment_gateways.update',
  'payment_gateways.view', 'payment_transactions.view', 'payments.export',
  'promotions.create', 'promotions.delete', 'promotions.update',
  'promotions.view', 'quotes.create', 'quotes.delete',
  'quotes.update', 'quotes.view', 'recurring_payment_profiles.create',
  'recurring_payment_profiles.delete', 'recurring_payment_profiles.update', 'recurring_payment_profiles.view',
  'revenue_summary.view', 'roles.view', 'scheduled_tasks.create',
  'scheduled_tasks.delete', 'scheduled_tasks.update', 'scheduled_tasks.view',
  'service_areas.create', 'service_areas.delete', 'service_areas.update',
  'service_areas.view', 'sites.create', 'sites.delete',
  'sites.update', 'sites.view', 'sla_definitions.create',
  'sla_definitions.delete', 'sla_definitions.update', 'sla_definitions.view',
  'sms.send', 'sms.view', 'snmp_profiles.create',
  'snmp_profiles.delete', 'snmp_profiles.update', 'snmp_profiles.view',
  'speed_tests.create', 'speed_tests.delete', 'speed_tests.update',
  'speed_tests.view', 'suspension_rules.create', 'suspension_rules.delete',
  'suspension_rules.update', 'suspension_rules.view', 'tax_rates.create',
  'tax_rates.delete', 'tax_rates.update', 'tax_rates.view',
  'tax_rules.create', 'tax_rules.delete', 'tax_rules.update',
  'tax_rules.view', 'vlans.create', 'vlans.delete',
  'vlans.update', 'vlans.view', 'webhooks.create',
  'webhooks.delete', 'webhooks.update', 'webhooks.view'
)
WHERE r.name = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- super_admin: 126 grants
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'api_tokens.create', 'api_tokens.delete', 'api_tokens.update',
  'api_tokens.view', 'cfdi_documents.create', 'cfdi_documents.update',
  'cfdi_documents.view', 'clients.export', 'connection_logs.view',
  'contracts.export', 'coverage_zones.create', 'coverage_zones.delete',
  'coverage_zones.update', 'coverage_zones.view', 'credit_notes.create',
  'credit_notes.delete', 'credit_notes.update', 'credit_notes.view',
  'csd_certificates.create', 'csd_certificates.delete', 'csd_certificates.update',
  'csd_certificates.view', 'device_config_backups.create', 'device_config_backups.delete',
  'device_config_backups.update', 'device_config_backups.view', 'expenses.delete',
  'facturas_publicas.create', 'facturas_publicas.update', 'facturas_publicas.view',
  'files.create', 'files.delete', 'files.update',
  'files.view', 'inventory.delete', 'invoices.export',
  'ip_assignments.create', 'ip_assignments.delete', 'ip_assignments.update',
  'ip_assignments.view', 'ip_pools.create', 'ip_pools.delete',
  'ip_pools.update', 'ip_pools.view', 'network_health.view',
  'network_links.create', 'network_links.delete', 'network_links.update',
  'network_links.view', 'organizations.create', 'organizations.delete',
  'outages.create', 'outages.delete', 'outages.update',
  'outages.view', 'pac_providers.create', 'pac_providers.delete',
  'pac_providers.update', 'pac_providers.view', 'payment_gateways.create',
  'payment_gateways.delete', 'payment_gateways.update', 'payment_gateways.view',
  'payment_transactions.view', 'payments.export', 'promotions.create',
  'promotions.delete', 'promotions.update', 'promotions.view',
  'quotes.create', 'quotes.delete', 'quotes.update',
  'quotes.view', 'recurring_payment_profiles.create', 'recurring_payment_profiles.delete',
  'recurring_payment_profiles.update', 'recurring_payment_profiles.view', 'revenue_summary.view',
  'roles.manage', 'roles.view', 'scheduled_tasks.create',
  'scheduled_tasks.delete', 'scheduled_tasks.update', 'scheduled_tasks.view',
  'service_areas.create', 'service_areas.delete', 'service_areas.update',
  'service_areas.view', 'sites.create', 'sites.delete',
  'sites.update', 'sites.view', 'sla_definitions.create',
  'sla_definitions.delete', 'sla_definitions.update', 'sla_definitions.view',
  'sms.send', 'sms.view', 'snmp_profiles.create',
  'snmp_profiles.delete', 'snmp_profiles.update', 'snmp_profiles.view',
  'speed_tests.create', 'speed_tests.delete', 'speed_tests.update',
  'speed_tests.view', 'suspension_rules.create', 'suspension_rules.delete',
  'suspension_rules.update', 'suspension_rules.view', 'tax_rates.create',
  'tax_rates.delete', 'tax_rates.update', 'tax_rates.view',
  'tax_rules.create', 'tax_rules.delete', 'tax_rules.update',
  'tax_rules.view', 'vlans.create', 'vlans.delete',
  'vlans.update', 'vlans.view', 'webhooks.create',
  'webhooks.delete', 'webhooks.update', 'webhooks.view'
)
WHERE r.name = 'super_admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- billing: 55 grants
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'cfdi_documents.create', 'cfdi_documents.update', 'cfdi_documents.view',
  'clients.export', 'contracts.export', 'credit_notes.create',
  'credit_notes.delete', 'credit_notes.update', 'credit_notes.view',
  'csd_certificates.create', 'csd_certificates.delete', 'csd_certificates.update',
  'csd_certificates.view', 'expenses.delete', 'facturas_publicas.create',
  'facturas_publicas.update', 'facturas_publicas.view', 'files.create',
  'files.view', 'invoices.export', 'pac_providers.create',
  'pac_providers.delete', 'pac_providers.update', 'pac_providers.view',
  'payment_gateways.create', 'payment_gateways.delete', 'payment_gateways.update',
  'payment_gateways.view', 'payment_transactions.view', 'payments.export',
  'promotions.create', 'promotions.delete', 'promotions.update',
  'promotions.view', 'quotes.create', 'quotes.delete',
  'quotes.update', 'quotes.view', 'recurring_payment_profiles.create',
  'recurring_payment_profiles.delete', 'recurring_payment_profiles.update', 'recurring_payment_profiles.view',
  'revenue_summary.view', 'suspension_rules.create', 'suspension_rules.delete',
  'suspension_rules.update', 'suspension_rules.view', 'tax_rates.create',
  'tax_rates.delete', 'tax_rates.update', 'tax_rates.view',
  'tax_rules.create', 'tax_rules.delete', 'tax_rules.update',
  'tax_rules.view'
)
WHERE r.name = 'billing'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- support: 14 grants
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'cfdi_documents.view', 'connection_logs.view', 'credit_notes.view',
  'facturas_publicas.view', 'files.create', 'files.view',
  'network_health.view', 'outages.view', 'promotions.view',
  'quotes.view', 'sla_definitions.view', 'sms.send',
  'sms.view', 'speed_tests.view'
)
WHERE r.name = 'support'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- technician: 50 grants
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'connection_logs.view', 'coverage_zones.create', 'coverage_zones.delete',
  'coverage_zones.update', 'coverage_zones.view', 'device_config_backups.create',
  'device_config_backups.delete', 'device_config_backups.update', 'device_config_backups.view',
  'files.create', 'files.view', 'ip_assignments.create',
  'ip_assignments.delete', 'ip_assignments.update', 'ip_assignments.view',
  'ip_pools.create', 'ip_pools.delete', 'ip_pools.update',
  'ip_pools.view', 'network_health.view', 'network_links.create',
  'network_links.delete', 'network_links.update', 'network_links.view',
  'outages.create', 'outages.delete', 'outages.update',
  'outages.view', 'service_areas.create', 'service_areas.delete',
  'service_areas.update', 'service_areas.view', 'sites.create',
  'sites.delete', 'sites.update', 'sites.view',
  'sla_definitions.view', 'snmp_profiles.create', 'snmp_profiles.delete',
  'snmp_profiles.update', 'snmp_profiles.view', 'speed_tests.create',
  'speed_tests.delete', 'speed_tests.update', 'speed_tests.view',
  'suspension_rules.view', 'vlans.create', 'vlans.delete',
  'vlans.update', 'vlans.view'
)
WHERE r.name = 'technician'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- noc_operator: 26 grants
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'connection_logs.summary', 'connection_logs.view', 'device_config_backups.create',
  'device_config_backups.view', 'ip_assignments.update', 'ip_assignments.view',
  'ip_pools.update', 'ip_pools.utilization', 'ip_pools.view',
  'network_health.view', 'network_links.update', 'network_links.view',
  'outages.create', 'outages.delete', 'outages.update',
  'outages.view', 'scheduled_tasks.view', 'sites.update',
  'sites.view', 'sla_definitions.view', 'snmp_profiles.update',
  'snmp_profiles.view', 'speed_tests.create', 'speed_tests.view',
  'vlans.update', 'vlans.view'
)
WHERE r.name = 'noc_operator'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- readonly: 32 grants
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'cfdi_documents.view', 'clients.export', 'connection_logs.view',
  'contracts.export', 'coverage_zones.view', 'credit_notes.view',
  'facturas_publicas.view', 'files.view', 'invoices.export',
  'ip_assignments.view', 'ip_pools.view', 'network_health.view',
  'network_links.view', 'outages.view', 'payment_transactions.view',
  'payments.export', 'promotions.view', 'quotes.view',
  'recurring_payment_profiles.view', 'revenue_summary.view', 'roles.view',
  'scheduled_tasks.view', 'service_areas.view', 'sites.view',
  'sla_definitions.view', 'sms.view', 'snmp_profiles.view',
  'speed_tests.view', 'suspension_rules.view', 'tax_rates.view',
  'tax_rules.view', 'vlans.view'
)
WHERE r.name = 'readonly'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- auditor: 32 grants
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'cfdi_documents.view', 'clients.export', 'connection_logs.view',
  'contracts.export', 'coverage_zones.view', 'credit_notes.view',
  'facturas_publicas.view', 'files.view', 'invoices.export',
  'ip_assignments.view', 'ip_pools.view', 'network_health.view',
  'network_links.view', 'outages.view', 'payment_transactions.view',
  'payments.export', 'promotions.view', 'quotes.view',
  'recurring_payment_profiles.view', 'revenue_summary.view', 'roles.view',
  'scheduled_tasks.view', 'service_areas.view', 'sites.view',
  'sla_definitions.view', 'sms.view', 'snmp_profiles.view',
  'speed_tests.view', 'suspension_rules.view', 'tax_rates.view',
  'tax_rules.view', 'vlans.view'
)
WHERE r.name = 'auditor'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );
