-- =============================================================================
-- Migration 313: Seed built-in report_definitions registry — §15 fix
-- =============================================================================
-- Populates report_definitions with one row per report slug that
-- scheduledReportService.generateReportData() can dispatch on.
-- organization_id = NULL means "system-wide built-in" (visible to all orgs).
-- is_system = 1 prevents user editing/deletion.
-- Idempotent: INSERT ... WHERE NOT EXISTS.
-- =============================================================================

-- financial category
INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'aging', 'financial', 'Accounts receivable aging report — buckets invoices by days overdue', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'aging' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'financial', 'financial', 'Financial summary — invoiced, collected, payments, expenses, net income', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'financial' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'revenue-by-period', 'financial', 'Revenue breakdown by period (monthly/quarterly/yearly)', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'revenue-by-period' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'revenue-by-plan', 'financial', 'Revenue breakdown by service plan', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'revenue-by-plan' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'revenue-by-region', 'financial', 'Revenue breakdown by geographic region / service area', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'revenue-by-region' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'revenue-by-agent', 'financial', 'Revenue attributed to each sales/billing agent', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'revenue-by-agent' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'cash-flow', 'financial', 'Cash flow report — inflows and outflows by period', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'cash-flow' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'payment-methods', 'financial', 'Payment method breakdown — cash, card, transfer, etc.', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'payment-methods' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'churn-revenue', 'financial', 'Churn revenue impact — lost revenue from cancelled contracts', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'churn-revenue' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'agent-commissions', 'financial', 'Agent commission calculations based on collected payments', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'agent-commissions' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'tax-summary', 'financial', 'Tax summary — IVA and ISR totals by period', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'tax-summary' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'sat-export', 'financial', 'SAT CFDI export data for fiscal reporting', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'sat-export' AND organization_id IS NULL);

-- operational category
INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'technicians', 'operational', 'Technician productivity — jobs completed, cancelled, avg. completion time', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'technicians' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'subscriber-growth', 'operational', 'Subscriber growth — new activations and churn per month', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'subscriber-growth' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'subscriber-counts', 'operational', 'Active subscriber counts over time', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'subscriber-counts' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'arpu', 'operational', 'Average Revenue Per User (ARPU) by month', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'arpu' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'uptime-by-area', 'operational', 'Network uptime percentage broken down by service area', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'uptime-by-area' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'mttr', 'operational', 'Mean Time To Repair (MTTR) for network outages', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'mttr' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'installation-completion', 'operational', 'Installation job completion rate and lead times', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'installation-completion' AND organization_id IS NULL);

-- network category
INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'bandwidth-utilization', 'network', 'Bandwidth utilization by link or NAS device', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'bandwidth-utilization' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'top-consumers', 'network', 'Top bandwidth-consuming subscribers', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'top-consumers' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'congested-links', 'network', 'Network links with sustained high utilization (congestion)', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'congested-links' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'sfp-lifespan', 'network', 'SFP transceiver optical power levels and estimated lifespan', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'sfp-lifespan' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'optical-degradation', 'network', 'PON optical power degradation trends', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'optical-degradation' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'device-reboots', 'network', 'Device reboot frequency and uptime impact', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'device-reboots' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'snmp-poll-success', 'network', 'SNMP polling success rate by device', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'snmp-poll-success' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'alert-frequency', 'network', 'Alert frequency and type breakdown over a time window', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'alert-frequency' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'capacity-forecast', 'network', 'Capacity growth forecast based on current subscriber trends', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'capacity-forecast' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'pon-utilization', 'network', 'PON OLT port utilization summary', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'pon-utilization' AND organization_id IS NULL);

-- compliance category
INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'data-retention-compliance', 'compliance', 'Data retention policy compliance — records per table vs. retention window', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'data-retention-compliance' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'ip-assignment-log', 'compliance', 'IP address assignment audit log', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'ip-assignment-log' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'subscriber-identity', 'compliance', 'Subscriber identity verification status report', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'subscriber-identity' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'interception-readiness', 'compliance', 'Traffic interception (CALEA/lawful intercept) readiness assessment', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'interception-readiness' AND organization_id IS NULL);

INSERT INTO report_definitions (organization_id, name, category, description, is_system)
SELECT NULL, 'regulatory-export', 'compliance', 'Regulatory filing data export (IFT / authorities format)', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM report_definitions WHERE name = 'regulatory-export' AND organization_id IS NULL);
