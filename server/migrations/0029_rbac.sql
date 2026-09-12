-- RBAC دقيق فوق نظام الأدوار الموجود (staff/admin) — إضافي بالكامل، مش بديل. مستخدم من
-- غير role_id يفضل شغال بالظبط زي ما كان (صلاحياته بتتحدد ضمنياً من is_admin/role القديمين
-- في الكود، مش من هنا) — عشان أي حساب موجود ما ينكسرش.
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id TEXT REFERENCES roles(id);

INSERT INTO roles (id, name, is_system) VALUES
  ('role-manager', 'المدير', 1),
  ('role-orders-manager', 'مدير الطلبات', 1),
  ('role-inventory-manager', 'مدير المخزون', 1),
  ('role-picker', 'موظف تجهيز', 1),
  ('role-purchasing-officer', 'مسؤول مشتريات', 1),
  ('role-rider', 'مندوب توصيل', 1)
ON CONFLICT (id) DO NOTHING;

-- المدير: صلاحية كاملة على كل حاجة.
INSERT INTO role_permissions (role_id, permission)
SELECT 'role-manager', p FROM unnest(ARRAY[
  'orders.view','orders.update_status','orders.cancel','orders.print',
  'products.view','products.create','products.edit','products.cost_view',
  'inventory.view','inventory.adjust','inventory.receive',
  'purchases.view','purchases.create','purchases.receive',
  'customers.view','discounts.manage','analytics.view',
  'wallet.view','wallet.manage','delivery.manage','marketing.manage',
  'settings.manage','users.manage','audit.view','returns.manage'
]) AS p
ON CONFLICT DO NOTHING;

-- مدير الطلبات: عمليات الطلبات/العملاء/التوصيل.
INSERT INTO role_permissions (role_id, permission)
SELECT 'role-orders-manager', p FROM unnest(ARRAY[
  'orders.view','orders.update_status','orders.cancel','orders.print',
  'customers.view','delivery.manage','returns.manage'
]) AS p
ON CONFLICT DO NOTHING;

-- مدير المخزون: منتجات/مخزون/دفعات/صلاحية.
INSERT INTO role_permissions (role_id, permission)
SELECT 'role-inventory-manager', p FROM unnest(ARRAY[
  'products.view','products.create','products.edit','products.cost_view',
  'inventory.view','inventory.adjust','inventory.receive'
]) AS p
ON CONFLICT DO NOTHING;

-- موظف تجهيز: يشوف الطلبات ويجهّزها لحد "جاهزة للتوصيل" — من غير إلغاء أو تعديل تكلفة.
INSERT INTO role_permissions (role_id, permission)
SELECT 'role-picker', p FROM unnest(ARRAY[
  'orders.view','orders.update_status','orders.print','inventory.view'
]) AS p
ON CONFLICT DO NOTHING;

-- مسؤول مشتريات: الموردين وأوامر الشراء والاستلام واقتراحات إعادة الطلب.
INSERT INTO role_permissions (role_id, permission)
SELECT 'role-purchasing-officer', p FROM unnest(ARRAY[
  'purchases.view','purchases.create','purchases.receive',
  'inventory.view','inventory.receive','products.cost_view'
]) AS p
ON CONFLICT DO NOTHING;

-- مندوب توصيل: طلباته المُسندة له بس — التقييد الفعلي (مش بس أي طلب) بيتطبّق في مسار
-- التوصيل نفسه (مرحلة لاحقة)، الصلاحية هنا بس بتفتح الباب على عمليات التوصيل عموماً.
INSERT INTO role_permissions (role_id, permission)
SELECT 'role-rider', p FROM unnest(ARRAY['orders.view','delivery.manage']) AS p
ON CONFLICT DO NOTHING;
