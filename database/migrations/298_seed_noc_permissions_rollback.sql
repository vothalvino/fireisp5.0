-- Rollback 298
DELETE FROM role_permissions WHERE permission_id IN (
  SELECT id FROM permissions WHERE name IN (
    'noc.view',
    'work_orders.view','work_orders.create','work_orders.update','work_orders.delete',
    'work_order_materials.view','work_order_materials.create','work_order_materials.delete',
    'technician_tracking.view','technician_tracking.ingest',
    'ticket_relations.view','ticket_relations.manage',
    'ticket_time_logs.view','ticket_time_logs.manage'
  )
);
DELETE FROM permissions WHERE name IN (
  'noc.view',
  'work_orders.view','work_orders.create','work_orders.update','work_orders.delete',
  'work_order_materials.view','work_order_materials.create','work_order_materials.delete',
  'technician_tracking.view','technician_tracking.ingest',
  'ticket_relations.view','ticket_relations.manage',
  'ticket_time_logs.view','ticket_time_logs.manage'
);
