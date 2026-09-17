-- توسيع أنواع دفعات العمليات الجماعية لتشمل تحديث المخزون بالجملة (CSV/تعديل سريع)
-- وتحديث التكلفة بالجملة، بنفس نمط bulk_price_csv/bulk_price_adjustment الحالي.
ALTER TABLE bulk_operation_batches DROP CONSTRAINT IF EXISTS bulk_operation_batches_operation_type_check;
ALTER TABLE bulk_operation_batches ADD CONSTRAINT bulk_operation_batches_operation_type_check
  CHECK (operation_type IN ('bulk_price_csv', 'bulk_price_adjustment', 'bulk_stock_csv', 'bulk_stock_adjustment', 'bulk_cost_csv'));

-- ربط حركات المخزون بالدفعة الجماعية اللي أنشأتها — نفس مبدأ bulk_batch_id في
-- product_price_history/product_cost_history، لازم لعرض تفاصيل الدفعة والتراجع عنها.
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS bulk_batch_id TEXT REFERENCES bulk_operation_batches(id) ON DELETE SET NULL;

-- حماية الهامش: نسبة أدنى للهامش (سعر البيع مقابل التكلفة) قابلة للتعديل من الإعدادات —
-- أي تحديث سعر/تكلفة بالجملة بيتحقق منها ويحذّر (بدون منع) لو الهامش الناتج أقل منها.
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS min_margin_percent NUMERIC(5,2) NOT NULL DEFAULT 15
  CHECK (min_margin_percent >= 0 AND min_margin_percent <= 100);

-- صلاحية تحديث التكلفة بالجملة منفصلة عن صلاحية تحديث السعر بالجملة (نفس فصل الأدوار
-- المطبّق أصلاً بين products.edit وproducts.cost_view) — تحديث المخزون بالجملة بيستخدم
-- صلاحية inventory.adjust الموجودة أصلاً (ممنوحة بالفعل لـ role-manager وrole-inventory-manager).
INSERT INTO role_permissions (role_id, permission)
SELECT r, 'products.cost.bulk_update' FROM unnest(ARRAY['role-manager', 'role-inventory-manager']) AS r
ON CONFLICT DO NOTHING;
