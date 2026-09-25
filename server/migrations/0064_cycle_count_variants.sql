-- الجرد الدوري (cycle counts) قبل كده كان بيغطي المنتجات على مستوى الأب بس — منتج عنده
-- متغيّرات (product_variants) كان بياخد صف واحد بمخزون الأب (اللي مش المرجع الحقيقي للمخزون
-- لما يبقى للمنتج متغيّرات، زي ما بقية أنظمة الجرد بالجملة (bulkStockService) بتفترض بالفعل).
-- variant_id هنا NULL يعني "صف بيمثّل المنتج نفسه" (منتج من غير متغيّرات)، وغير NULL يعني
-- "صف بيمثّل متغيّر مُعيّن" — نفس القاعدة المتّبعة في stock_movements.variant_id بالظبط.
ALTER TABLE cycle_count_items ADD COLUMN IF NOT EXISTS variant_id TEXT REFERENCES product_variants(id);

-- القيد القديم (cycle_count_id, product_id) كان بيمنع أكتر من صف لنفس المنتج في نفس الجرد —
-- ده غلط دلوقتي لمنتج عنده أكتر من متغيّر (المفروض صف لكل متغيّر). استبدلناه بفهرسين جزئيين:
-- واحد بيضمن صف واحد بس لكل (جرد، منتج) لما مفيش متغيّر، وواحد بيضمن صف واحد بس لكل
-- (جرد، متغيّر) لما فيه متغيّر — نفس مبدأ الفهارس الجزئية المستخدمة بالفعل في stock_movements.
ALTER TABLE cycle_count_items DROP CONSTRAINT IF EXISTS cycle_count_items_cycle_count_id_product_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cycle_count_items_product_unique
  ON cycle_count_items(cycle_count_id, product_id) WHERE variant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cycle_count_items_variant_unique
  ON cycle_count_items(cycle_count_id, variant_id) WHERE variant_id IS NOT NULL;
