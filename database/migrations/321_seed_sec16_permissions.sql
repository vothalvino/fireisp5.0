-- =============================================================================
-- Migration 321: §16 Permissions seed
-- =============================================================================
-- Seeds permissions for all §16 modules plus backfills permissions for
-- tables that already exist with routes but had no permissions seeded:
--   concession_titles, regulatory_filings, ift_statistical_reports,
--   contract_templates_mx
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Module: subscriber_consents
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'subscriber_consents.view', 'View subscriber consent records (Aviso de Privacidad)', 'subscriber_consents'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'subscriber_consents.view');

INSERT INTO permissions (name, description, module)
SELECT 'subscriber_consents.create', 'Record new subscriber consent', 'subscriber_consents'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'subscriber_consents.create');

INSERT INTO permissions (name, description, module)
SELECT 'subscriber_consents.manage', 'Update and delete subscriber consent records', 'subscriber_consents'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'subscriber_consents.manage');

-- ---------------------------------------------------------------------------
-- Module: dsar_requests
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'dsar_requests.view', 'View DSAR requests and their status', 'dsar_requests'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'dsar_requests.view');

INSERT INTO permissions (name, description, module)
SELECT 'dsar_requests.create', 'Submit new DSAR requests', 'dsar_requests'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'dsar_requests.create');

INSERT INTO permissions (name, description, module)
SELECT 'dsar_requests.manage', 'Update, fulfill, and close DSAR requests', 'dsar_requests'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'dsar_requests.manage');

-- ---------------------------------------------------------------------------
-- Module: identity_verification
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'identity_verification.view', 'View identity verification records (INE/CURP)', 'identity_verification'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'identity_verification.view');

INSERT INTO permissions (name, description, module)
SELECT 'identity_verification.create', 'Submit identity verification records', 'identity_verification'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'identity_verification.create');

INSERT INTO permissions (name, description, module)
SELECT 'identity_verification.manage', 'Update and delete identity verification records', 'identity_verification'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'identity_verification.manage');

-- ---------------------------------------------------------------------------
-- Module: gov_data_requests (sensitive — admin only)
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'gov_data_requests.view', 'View government data requests (lawful interception log — admin only)', 'gov_data_requests'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'gov_data_requests.view');

INSERT INTO permissions (name, description, module)
SELECT 'gov_data_requests.create', 'Log new government data requests', 'gov_data_requests'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'gov_data_requests.create');

INSERT INTO permissions (name, description, module)
SELECT 'gov_data_requests.manage', 'Update and fulfill government data requests', 'gov_data_requests'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'gov_data_requests.manage');

-- ---------------------------------------------------------------------------
-- Module: phone_number_inventory
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'phone_number_inventory.view', 'View VoIP/DID phone number inventory', 'phone_number_inventory'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'phone_number_inventory.view');

INSERT INTO permissions (name, description, module)
SELECT 'phone_number_inventory.manage', 'Create, update, and delete phone number inventory entries', 'phone_number_inventory'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'phone_number_inventory.manage');

-- ---------------------------------------------------------------------------
-- Module: number_portability
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'number_portability.view', 'View number portability (MNP/FNP) records', 'number_portability'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'number_portability.view');

INSERT INTO permissions (name, description, module)
SELECT 'number_portability.manage', 'Create and update number portability records', 'number_portability'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'number_portability.manage');

-- ---------------------------------------------------------------------------
-- Module: numbering_blocks
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'numbering_blocks.view', 'View IFT/CRT numbering block assignments', 'numbering_blocks'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'numbering_blocks.view');

INSERT INTO permissions (name, description, module)
SELECT 'numbering_blocks.manage', 'Create and update numbering block assignments', 'numbering_blocks'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'numbering_blocks.manage');

-- ---------------------------------------------------------------------------
-- Module: uso_obligations
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'uso_obligations.view', 'View Universal Service Obligation records', 'uso_obligations'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'uso_obligations.view');

INSERT INTO permissions (name, description, module)
SELECT 'uso_obligations.manage', 'Create and update USO obligation records', 'uso_obligations'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'uso_obligations.manage');

-- ---------------------------------------------------------------------------
-- Module: rural_coverage
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'rural_coverage.view', 'View rural coverage deployment reports', 'rural_coverage'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'rural_coverage.view');

INSERT INTO permissions (name, description, module)
SELECT 'rural_coverage.manage', 'Create and update rural coverage reports', 'rural_coverage'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'rural_coverage.manage');

-- ---------------------------------------------------------------------------
-- Module: service_modification_notices
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'service_modification_notices.view', 'View service modification notices', 'service_modification_notices'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'service_modification_notices.view');

INSERT INTO permissions (name, description, module)
SELECT 'service_modification_notices.create', 'Create service modification notices', 'service_modification_notices'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'service_modification_notices.create');

INSERT INTO permissions (name, description, module)
SELECT 'service_modification_notices.manage', 'Update and delete service modification notices', 'service_modification_notices'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'service_modification_notices.manage');

-- ---------------------------------------------------------------------------
-- Module: data_residency
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'data_residency.view', 'View data residency and localization configuration', 'data_residency'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'data_residency.view');

INSERT INTO permissions (name, description, module)
SELECT 'data_residency.manage', 'Update data residency configuration', 'data_residency'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'data_residency.manage');

-- ---------------------------------------------------------------------------
-- Module: report_access_logs
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'report_access_logs.view', 'View audit log of report and data access events', 'report_access_logs'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'report_access_logs.view');

-- ---------------------------------------------------------------------------
-- Module: audit_export
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'audit_export.view', 'Export audit logs for regulatory compliance', 'audit_export'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'audit_export.view');

-- ---------------------------------------------------------------------------
-- Backfill: concession_titles (table exists, no permissions seeded yet)
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'concession_titles.view', 'View IFT concession title records', 'concession_titles'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'concession_titles.view');

INSERT INTO permissions (name, description, module)
SELECT 'concession_titles.create', 'Create concession title records', 'concession_titles'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'concession_titles.create');

INSERT INTO permissions (name, description, module)
SELECT 'concession_titles.update', 'Update concession title records', 'concession_titles'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'concession_titles.update');

INSERT INTO permissions (name, description, module)
SELECT 'concession_titles.delete', 'Delete concession title records', 'concession_titles'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'concession_titles.delete');

-- ---------------------------------------------------------------------------
-- Backfill: regulatory_filings (table exists, no permissions seeded yet)
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'regulatory_filings.view', 'View regulatory filing records', 'regulatory_filings'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'regulatory_filings.view');

INSERT INTO permissions (name, description, module)
SELECT 'regulatory_filings.create', 'Create regulatory filing records', 'regulatory_filings'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'regulatory_filings.create');

INSERT INTO permissions (name, description, module)
SELECT 'regulatory_filings.update', 'Update regulatory filing records', 'regulatory_filings'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'regulatory_filings.update');

INSERT INTO permissions (name, description, module)
SELECT 'regulatory_filings.delete', 'Delete regulatory filing records', 'regulatory_filings'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'regulatory_filings.delete');

-- ---------------------------------------------------------------------------
-- Backfill: ift_statistical_reports (table exists, no permissions seeded yet)
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'ift_statistical_reports.view', 'View IFT statistical report submissions', 'ift_statistical_reports'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ift_statistical_reports.view');

INSERT INTO permissions (name, description, module)
SELECT 'ift_statistical_reports.create', 'Create IFT statistical report submissions', 'ift_statistical_reports'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ift_statistical_reports.create');

INSERT INTO permissions (name, description, module)
SELECT 'ift_statistical_reports.update', 'Update IFT statistical report submissions', 'ift_statistical_reports'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ift_statistical_reports.update');

INSERT INTO permissions (name, description, module)
SELECT 'ift_statistical_reports.delete', 'Delete IFT statistical report submissions', 'ift_statistical_reports'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'ift_statistical_reports.delete');

-- ---------------------------------------------------------------------------
-- Backfill: contract_templates_mx (table exists, no permissions seeded yet)
-- ---------------------------------------------------------------------------
INSERT INTO permissions (name, description, module)
SELECT 'contract_templates_mx.view', 'View Mexican contract templates', 'contract_templates_mx'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'contract_templates_mx.view');

INSERT INTO permissions (name, description, module)
SELECT 'contract_templates_mx.create', 'Create Mexican contract templates', 'contract_templates_mx'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'contract_templates_mx.create');

INSERT INTO permissions (name, description, module)
SELECT 'contract_templates_mx.update', 'Update Mexican contract templates', 'contract_templates_mx'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'contract_templates_mx.update');

INSERT INTO permissions (name, description, module)
SELECT 'contract_templates_mx.delete', 'Delete Mexican contract templates', 'contract_templates_mx'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'contract_templates_mx.delete');

-- ---------------------------------------------------------------------------
-- Role assignments
-- ---------------------------------------------------------------------------

-- admin: all new permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'subscriber_consents.view','subscriber_consents.create','subscriber_consents.manage',
  'dsar_requests.view','dsar_requests.create','dsar_requests.manage',
  'identity_verification.view','identity_verification.create','identity_verification.manage',
  'gov_data_requests.view','gov_data_requests.create','gov_data_requests.manage',
  'phone_number_inventory.view','phone_number_inventory.manage',
  'number_portability.view','number_portability.manage',
  'numbering_blocks.view','numbering_blocks.manage',
  'uso_obligations.view','uso_obligations.manage',
  'rural_coverage.view','rural_coverage.manage',
  'service_modification_notices.view','service_modification_notices.create','service_modification_notices.manage',
  'data_residency.view','data_residency.manage',
  'report_access_logs.view',
  'audit_export.view',
  'concession_titles.view','concession_titles.create','concession_titles.update','concession_titles.delete',
  'regulatory_filings.view','regulatory_filings.create','regulatory_filings.update','regulatory_filings.delete',
  'ift_statistical_reports.view','ift_statistical_reports.create','ift_statistical_reports.update','ift_statistical_reports.delete',
  'contract_templates_mx.view','contract_templates_mx.create','contract_templates_mx.update','contract_templates_mx.delete'
)
WHERE r.name = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- billing: subset of permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'subscriber_consents.view','subscriber_consents.create',
  'dsar_requests.view','dsar_requests.create',
  'identity_verification.view',
  'service_modification_notices.view','service_modification_notices.create',
  'data_residency.view',
  'report_access_logs.view',
  'audit_export.view',
  'concession_titles.view',
  'regulatory_filings.view','regulatory_filings.create',
  'ift_statistical_reports.view','ift_statistical_reports.create',
  'contract_templates_mx.view','contract_templates_mx.create'
)
WHERE r.name = 'billing'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- technician: operational read-only subset
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'subscriber_consents.view',
  'identity_verification.view',
  'phone_number_inventory.view',
  'numbering_blocks.view',
  'rural_coverage.view'
)
WHERE r.name = 'technician'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- support: customer-facing read/create subset
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'subscriber_consents.view',
  'dsar_requests.view',
  'service_modification_notices.view'
)
WHERE r.name = 'support'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- readonly: audit/compliance read-only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'subscriber_consents.view',
  'identity_verification.view',
  'report_access_logs.view',
  'audit_export.view',
  'concession_titles.view',
  'regulatory_filings.view',
  'ift_statistical_reports.view'
)
WHERE r.name = 'readonly'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );
