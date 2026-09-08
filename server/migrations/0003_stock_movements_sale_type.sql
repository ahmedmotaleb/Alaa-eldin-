-- الطلب الآن بيخصم من المخزون فعلياً وبيسجّل حركة 'sale' لكل صنف في نفس معاملة إنشاء الطلب،
-- وإلغاء الطلب من لوحة التحكم بيسجّل حركة 'cancel_restore' لما يرجّع المخزون (راجع
-- server/src/services/inventoryService.ts) — القيد الحالي على stock_movements.type بيرفض أي
-- قيمة غير الأنواع الإدارية الخمسة القديمة، فلازم نضيف النوعين الجداد قبل ما نقدر ندرجهم.
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN ('restock', 'return', 'damage', 'loss', 'adjustment', 'sale', 'cancel_restore'));

-- ربط الحركة بالطلب اللي سببها (لو فيه)، وقيمة المخزون قبل/بعد — لتوثيق أدق ولضمان
-- إن استرجاع المخزون عند إلغاء الطلب يبقى idempotent (نتأكد الأول مفيش حركة cancel_restore
-- سابقة لنفس الطلب قبل ما نرجّع المخزون تاني). nullable عشان الصفوف القديمة قبل هذا الترحيل.
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS order_id TEXT REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS quantity_before INTEGER;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS quantity_after INTEGER;
CREATE INDEX IF NOT EXISTS idx_stock_movements_order ON stock_movements(order_id);
