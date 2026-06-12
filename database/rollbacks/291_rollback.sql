-- Rollback 291: Remove FUP / Data Pack RBAC permissions
DELETE rp FROM role_permissions rp
JOIN permissions p ON rp.permission_id = p.id
WHERE p.name IN (
  'data_packs.view','data_packs.create','data_packs.update','data_packs.delete',
  'data_pack_purchases.view','data_pack_purchases.create',
  'data_rollover.view','data_rollover.manage'
);

DELETE FROM permissions WHERE name IN (
  'data_packs.view','data_packs.create','data_packs.update','data_packs.delete',
  'data_pack_purchases.view','data_pack_purchases.create',
  'data_rollover.view','data_rollover.manage'
);
