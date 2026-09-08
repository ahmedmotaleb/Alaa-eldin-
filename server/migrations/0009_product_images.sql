-- صور المنتجات الحقيقية بدل الاعتماد الكامل على الإيموجي. الإيموجي (products.emoji) بيفضل
-- موجود كما هو كاحتياط (fallback) — المنتجات القديمة اللي معهاش صور تفضل شغالة زي ما هي
-- من غير أي ترحيل إجباري. هذا الجدول إضافي بالكامل (additive) وما بيغيّرش أي عمود موجود.

CREATE TABLE IF NOT EXISTS product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  storage_key TEXT NOT NULL DEFAULT '',
  alt_text TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_product_sort ON product_images(product_id, sort_order);

-- يضمن صورة أساسية واحدة بالظبط لكل منتج (partial unique index — بيسمح بأي عدد من
-- الصور غير الأساسية، لكن يمنع صورتين أساسيتين لنفس المنتج في نفس الوقت).
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_images_one_primary
  ON product_images(product_id) WHERE is_primary = 1;
