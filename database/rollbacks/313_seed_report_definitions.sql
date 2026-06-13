-- =============================================================================
-- Rollback 313: Remove seeded built-in report_definitions
-- =============================================================================

DELETE FROM report_definitions
WHERE organization_id IS NULL
  AND is_system = 1
  AND name IN (
    'aging', 'financial', 'revenue-by-period', 'revenue-by-plan', 'revenue-by-region',
    'revenue-by-agent', 'cash-flow', 'payment-methods', 'churn-revenue', 'agent-commissions',
    'tax-summary', 'sat-export', 'technicians', 'subscriber-growth', 'subscriber-counts',
    'arpu', 'uptime-by-area', 'mttr', 'installation-completion', 'bandwidth-utilization',
    'top-consumers', 'congested-links', 'sfp-lifespan', 'optical-degradation', 'device-reboots',
    'snmp-poll-success', 'alert-frequency', 'capacity-forecast', 'pon-utilization',
    'data-retention-compliance', 'ip-assignment-log', 'subscriber-identity',
    'interception-readiness', 'regulatory-export'
  );
