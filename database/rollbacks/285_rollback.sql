-- =============================================================================
-- Rollback 285: Remove §9.3 RF metrics / spectrum scan permissions
-- =============================================================================

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN (
    'spectrum_scans.view', 'spectrum_scans.create', 'spectrum_scans.delete',
    'rf_metrics.view'
);

DELETE FROM permissions WHERE name IN (
    'spectrum_scans.view', 'spectrum_scans.create', 'spectrum_scans.delete',
    'rf_metrics.view'
);
