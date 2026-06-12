-- =============================================================================
-- Migration 294: Traffic Engineering RBAC permissions seed — §10.4
-- =============================================================================
-- Permissions seeded (module='qos'):
--   interface_qos_policies.view/create/update/delete     (4)
--   mpls_vlan_prioritization.view/create/update/delete   (4)
--   dscp_marking_policies.view/create/update/delete      (4)
--   bandwidth_test_servers.view/create/update/delete     (4)
--   subscriber_speed_tests.view/create/update            (3)
-- Total: 19 permissions
--
-- Role matrix:
--   admin       → all 19
--   technician  → all view + create + update (no delete): 14 permissions
--   readonly    → view only (5 permissions — one .view per resource)
-- =============================================================================

INSERT INTO permissions (name, description, module)
SELECT 'interface_qos_policies.view',   'View interface QoS policies',   'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'interface_qos_policies.view');

INSERT INTO permissions (name, description, module)
SELECT 'interface_qos_policies.create', 'Create interface QoS policies', 'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'interface_qos_policies.create');

INSERT INTO permissions (name, description, module)
SELECT 'interface_qos_policies.update', 'Update interface QoS policies', 'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'interface_qos_policies.update');

INSERT INTO permissions (name, description, module)
SELECT 'interface_qos_policies.delete', 'Delete interface QoS policies', 'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'interface_qos_policies.delete');

INSERT INTO permissions (name, description, module)
SELECT 'mpls_vlan_prioritization.view',   'View MPLS/VLAN prioritization rules',   'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'mpls_vlan_prioritization.view');

INSERT INTO permissions (name, description, module)
SELECT 'mpls_vlan_prioritization.create', 'Create MPLS/VLAN prioritization rules', 'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'mpls_vlan_prioritization.create');

INSERT INTO permissions (name, description, module)
SELECT 'mpls_vlan_prioritization.update', 'Update MPLS/VLAN prioritization rules', 'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'mpls_vlan_prioritization.update');

INSERT INTO permissions (name, description, module)
SELECT 'mpls_vlan_prioritization.delete', 'Delete MPLS/VLAN prioritization rules', 'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'mpls_vlan_prioritization.delete');

INSERT INTO permissions (name, description, module)
SELECT 'dscp_marking_policies.view',   'View DSCP marking policies',   'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'dscp_marking_policies.view');

INSERT INTO permissions (name, description, module)
SELECT 'dscp_marking_policies.create', 'Create DSCP marking policies', 'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'dscp_marking_policies.create');

INSERT INTO permissions (name, description, module)
SELECT 'dscp_marking_policies.update', 'Update DSCP marking policies', 'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'dscp_marking_policies.update');

INSERT INTO permissions (name, description, module)
SELECT 'dscp_marking_policies.delete', 'Delete DSCP marking policies', 'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'dscp_marking_policies.delete');

INSERT INTO permissions (name, description, module)
SELECT 'bandwidth_test_servers.view',   'View bandwidth test servers',   'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'bandwidth_test_servers.view');

INSERT INTO permissions (name, description, module)
SELECT 'bandwidth_test_servers.create', 'Create bandwidth test servers', 'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'bandwidth_test_servers.create');

INSERT INTO permissions (name, description, module)
SELECT 'bandwidth_test_servers.update', 'Update bandwidth test servers', 'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'bandwidth_test_servers.update');

INSERT INTO permissions (name, description, module)
SELECT 'bandwidth_test_servers.delete', 'Delete bandwidth test servers', 'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'bandwidth_test_servers.delete');

INSERT INTO permissions (name, description, module)
SELECT 'subscriber_speed_tests.view',   'View subscriber speed test results', 'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'subscriber_speed_tests.view');

INSERT INTO permissions (name, description, module)
SELECT 'subscriber_speed_tests.create', 'Schedule subscriber speed tests',   'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'subscriber_speed_tests.create');

INSERT INTO permissions (name, description, module)
SELECT 'subscriber_speed_tests.update', 'Cancel or update subscriber speed test jobs', 'qos'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'subscriber_speed_tests.update');

-- admin: all 19
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'interface_qos_policies.view','interface_qos_policies.create',
  'interface_qos_policies.update','interface_qos_policies.delete',
  'mpls_vlan_prioritization.view','mpls_vlan_prioritization.create',
  'mpls_vlan_prioritization.update','mpls_vlan_prioritization.delete',
  'dscp_marking_policies.view','dscp_marking_policies.create',
  'dscp_marking_policies.update','dscp_marking_policies.delete',
  'bandwidth_test_servers.view','bandwidth_test_servers.create',
  'bandwidth_test_servers.update','bandwidth_test_servers.delete',
  'subscriber_speed_tests.view','subscriber_speed_tests.create',
  'subscriber_speed_tests.update'
)
WHERE r.name = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- technician: all view + create + update (no delete) — 14 permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'interface_qos_policies.view','interface_qos_policies.create','interface_qos_policies.update',
  'mpls_vlan_prioritization.view','mpls_vlan_prioritization.create','mpls_vlan_prioritization.update',
  'dscp_marking_policies.view','dscp_marking_policies.create','dscp_marking_policies.update',
  'bandwidth_test_servers.view','bandwidth_test_servers.create','bandwidth_test_servers.update',
  'subscriber_speed_tests.view','subscriber_speed_tests.create','subscriber_speed_tests.update'
)
WHERE r.name = 'technician'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );

-- readonly: views only (5)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
  'interface_qos_policies.view',
  'mpls_vlan_prioritization.view',
  'dscp_marking_policies.view',
  'bandwidth_test_servers.view',
  'subscriber_speed_tests.view'
)
WHERE r.name = 'readonly'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2 WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
  );
