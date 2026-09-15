-- صلاحية جديدة "استيراد المخزون من CSV" (inventory.import) — منفصلة عمداً عن products.edit
-- لأنها بوابة أوسع بكتير (رفع ملف يقدر ينشئ/يعدّل عدد كبير من المنتجات دفعة واحدة)، فمينفعش
-- نفترض إن أي حد عنده products.edit لازم يقدر كمان يستورد ملفات كاملة.
INSERT INTO role_permissions (role_id, permission) VALUES
  ('role-manager', 'inventory.import'),
  ('role-inventory-manager', 'inventory.import')
ON CONFLICT DO NOTHING;
