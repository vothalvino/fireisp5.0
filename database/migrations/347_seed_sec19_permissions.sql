-- =============================================================================
-- Migration 347 — §19 Permissions Seed (Multi-Tenancy / Reseller Support)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- §19.1 Reseller Hierarchy & Pricing permissions
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
  ('resellers.view',           'View reseller records',                         'resellers'),
  ('resellers.create',         'Create new resellers',                          'resellers'),
  ('resellers.update',         'Update reseller details and branding',          'resellers'),
  ('resellers.delete',         'Delete reseller records',                       'resellers'),
  ('resellers.suspend',        'Suspend or reactivate a reseller',              'resellers'),
  ('reseller_plan_prices.view',   'View reseller custom plan prices',           'resellers'),
  ('reseller_plan_prices.manage', 'Set or update reseller plan price overrides','resellers'),
  ('reseller_commissions.view',   'View commission earnings records',           'resellers'),
  ('reseller_commissions.approve','Approve or mark commissions as paid',        'resellers'),

-- ---------------------------------------------------------------------------
-- §19.2 Resource Allocation permissions
-- ---------------------------------------------------------------------------
  ('reseller_ip_pool_allocations.view',   'View reseller IP pool allocations',  'resellers'),
  ('reseller_ip_pool_allocations.manage', 'Assign/remove IP pools for resellers','resellers'),
  ('reseller_bandwidth_quotas.view',   'View reseller bandwidth quotas',        'resellers'),
  ('reseller_bandwidth_quotas.manage', 'Set reseller bandwidth quotas',         'resellers'),
  ('reseller_olt_port_assignments.view',   'View reseller OLT port assignments','resellers'),
  ('reseller_olt_port_assignments.manage', 'Assign/remove OLT ports for resellers','resellers'),
  ('reseller_billing_entities.view',   'View reseller billing entities',        'resellers'),
  ('reseller_billing_entities.manage', 'Create/update reseller billing entities','resellers'),

-- ---------------------------------------------------------------------------
-- §19.3 Reseller Portal permissions
-- ---------------------------------------------------------------------------
  ('reseller_portal.dashboard',        'Access reseller dashboard aggregates', 'resellers'),
  ('reseller_portal.manage_customers', 'Create/suspend/cancel reseller customers','resellers'),
  ('reseller_portal.invoices',         'View and generate reseller invoices',  'resellers'),
  ('reseller_portal.inventory',        'View reseller assigned inventory',     'resellers');

-- ---------------------------------------------------------------------------
-- Grant all §19 permissions to admin role
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin'
  AND p.name IN (
    'resellers.view', 'resellers.create', 'resellers.update',
    'resellers.delete', 'resellers.suspend',
    'reseller_plan_prices.view', 'reseller_plan_prices.manage',
    'reseller_commissions.view', 'reseller_commissions.approve',
    'reseller_ip_pool_allocations.view', 'reseller_ip_pool_allocations.manage',
    'reseller_bandwidth_quotas.view', 'reseller_bandwidth_quotas.manage',
    'reseller_olt_port_assignments.view', 'reseller_olt_port_assignments.manage',
    'reseller_billing_entities.view', 'reseller_billing_entities.manage',
    'reseller_portal.dashboard', 'reseller_portal.manage_customers',
    'reseller_portal.invoices', 'reseller_portal.inventory'
  );

-- Grant reseller_admin role: portal + own resource management (no cross-reseller admin)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'reseller_admin'
  AND p.name IN (
    'resellers.view',
    'reseller_plan_prices.view',
    'reseller_commissions.view',
    'reseller_ip_pool_allocations.view',
    'reseller_bandwidth_quotas.view',
    'reseller_olt_port_assignments.view',
    'reseller_billing_entities.view',
    'reseller_portal.dashboard',
    'reseller_portal.manage_customers',
    'reseller_portal.invoices',
    'reseller_portal.inventory'
  );

-- Grant super_admin: full reseller management
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'super_admin'
  AND p.name IN (
    'resellers.view', 'resellers.create', 'resellers.update',
    'resellers.delete', 'resellers.suspend',
    'reseller_plan_prices.view', 'reseller_plan_prices.manage',
    'reseller_commissions.view', 'reseller_commissions.approve',
    'reseller_ip_pool_allocations.view', 'reseller_ip_pool_allocations.manage',
    'reseller_bandwidth_quotas.view', 'reseller_bandwidth_quotas.manage',
    'reseller_olt_port_assignments.view', 'reseller_olt_port_assignments.manage',
    'reseller_billing_entities.view', 'reseller_billing_entities.manage',
    'reseller_portal.dashboard', 'reseller_portal.manage_customers',
    'reseller_portal.invoices', 'reseller_portal.inventory'
  );
