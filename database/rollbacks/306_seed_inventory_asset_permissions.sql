-- Rollback 306: Remove inventory & asset management permissions
DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT id FROM permissions
  WHERE name IN (
    'vendors.view','vendors.create','vendors.update','vendors.delete',
    'purchase_orders.view','purchase_orders.create','purchase_orders.update','purchase_orders.delete','purchase_orders.receive',
    'assets.view','assets.create','assets.update','assets.delete','assets.assign','assets.dispose','assets.scan',
    'rma.view','rma.create','rma.update','rma.close'
  )
);

DELETE FROM permissions
WHERE name IN (
  'vendors.view','vendors.create','vendors.update','vendors.delete',
  'purchase_orders.view','purchase_orders.create','purchase_orders.update','purchase_orders.delete','purchase_orders.receive',
  'assets.view','assets.create','assets.update','assets.delete','assets.assign','assets.dispose','assets.scan',
  'rma.view','rma.create','rma.update','rma.close'
);
