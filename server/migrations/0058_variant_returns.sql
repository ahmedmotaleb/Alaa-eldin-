-- نفس مبدأ migration 0057 بالظبط: إضافة دعم المتغيرات لمرتجعات العملاء والموردين —
-- product_id يفضل إجباري (المنتج الأب)، variant_id اختياري إضافي لو البند خاص بمتغير محدد.
-- بدون ON DELETE على variant_id (زي كل الأعمدة المشابهة) — حذف متغير له تاريخ مرتجع حقيقي
-- لازم يترفض على مستوى قاعدة البيانات (23503)، مش يمسح لقطة تاريخية بصمت.
ALTER TABLE customer_return_items ADD COLUMN IF NOT EXISTS variant_id TEXT REFERENCES product_variants(id);
ALTER TABLE supplier_return_items ADD COLUMN IF NOT EXISTS variant_id TEXT REFERENCES product_variants(id);

CREATE INDEX IF NOT EXISTS idx_customer_return_items_variant ON customer_return_items(variant_id);
CREATE INDEX IF NOT EXISTS idx_supplier_return_items_variant ON supplier_return_items(variant_id);
