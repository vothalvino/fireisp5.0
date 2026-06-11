-- =============================================================================
-- Rollback 234: Remove RADIUS accounting Phase C permissions
-- =============================================================================
-- Reverses migration 234. Removes role assignments first (child rows), then
-- removes the permission records themselves.
-- =============================================================================

DELETE FROM role_permissions WHERE permission_id IN (
    SELECT id FROM permissions WHERE name IN (
        'radius.accounting_ingest',
        'radius.cdr_export',
        'radius.coa',
        'radius.mac_move_events.view',
        'nas.health'
    )
);

DELETE FROM permissions WHERE name IN (
    'radius.accounting_ingest',
    'radius.cdr_export',
    'radius.coa',
    'radius.mac_move_events.view',
    'nas.health'
);
