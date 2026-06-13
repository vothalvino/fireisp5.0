-- Rollback 321: §16 Permissions seed
-- role_permissions rows cascade via FK when permission rows are deleted
DELETE FROM permissions WHERE name IN (
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
);
