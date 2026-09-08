-- "بدائل مشابهة" — روابط يدوية بين منتج ومنتجات بديلة، بترتيب أولوية. لا يوجد أي استبدال
-- تلقائي للمنتج في السلة/الطلب؛ الجدول ده مجرد مصدر بيانات لعرض اقتراحات للعميل فقط.
CREATE TABLE IF NOT EXISTS product_alternatives (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  alternative_product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, alternative_product_id),
  CHECK (product_id != alternative_product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_alternatives_product ON product_alternatives(product_id, priority);
