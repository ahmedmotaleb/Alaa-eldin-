-- إضافة دعم المتغيرات لأوامر الشراء، استلام البضاعة، ودفعات المخزون — نفس القاعدة
-- المستخدمة بالفعل في order_items/stock_movements بالظبط (migration 0043): product_id
-- يفضل إجباري دايماً (المنتج الأب)، variant_id اختياري إضافي لو البند خاص بمتغير محدد.
-- بدون ON DELETE على variant_id (زي order_items بالظبط) — حذف متغير له تاريخ شراء/استلام
-- حقيقي لازم يترفض على مستوى قاعدة البيانات (23503)، مش يمسح لقطة تاريخية بصمت.
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS variant_id TEXT REFERENCES product_variants(id);
ALTER TABLE goods_receipt_items ADD COLUMN IF NOT EXISTS variant_id TEXT REFERENCES product_variants(id);
ALTER TABLE inventory_batches ADD COLUMN IF NOT EXISTS variant_id TEXT REFERENCES product_variants(id);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_variant ON purchase_order_items(variant_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_items_variant ON goods_receipt_items(variant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_variant ON inventory_batches(variant_id);
