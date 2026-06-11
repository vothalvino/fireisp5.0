-- =============================================================================
-- Rollback 283: Remove §9.2 PTP/PTMP link planning permissions
-- =============================================================================

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN (
    'ptp_links.view', 'ptp_links.update',
    'link_planning.view', 'link_planning.create', 'link_planning.update', 'link_planning.delete',
    'link_failover.view', 'link_failover.manage'
);

DELETE FROM permissions WHERE name IN (
    'ptp_links.view', 'ptp_links.update',
    'link_planning.view', 'link_planning.create', 'link_planning.update', 'link_planning.delete',
    'link_failover.view', 'link_failover.manage'
);
