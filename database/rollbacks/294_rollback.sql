-- Rollback 294: Remove Traffic Engineering RBAC permissions
DELETE rp FROM role_permissions rp
JOIN permissions p ON rp.permission_id = p.id
WHERE p.name IN (
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
);

DELETE FROM permissions WHERE name IN (
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
);
