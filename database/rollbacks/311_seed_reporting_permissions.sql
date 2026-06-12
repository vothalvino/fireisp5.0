-- =============================================================================
-- Rollback 311: Remove reporting & analytics permissions
-- =============================================================================

DELETE FROM permissions WHERE name IN (
  'reports.view','reports.generate','reports.schedule','reports.export','reports.manage_definitions',
  'dashboard_widgets.view','dashboard_widgets.manage',
  'custom_reports.view','custom_reports.create','custom_reports.execute','custom_reports.manage'
);
