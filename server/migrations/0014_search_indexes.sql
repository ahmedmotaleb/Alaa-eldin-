-- دعم بحث حقيقي على مستوى قاعدة البيانات (اسم المنتج/العلامة التجارية/اسم القسم) بدل الفلترة
-- الكاملة على الفرونت إند. pg_trgm بيوفر فهرسة "trigram" تسمح بمطابقة تقريبية (fuzzy) وفهرسة
-- ILIKE بكفاءة أعلى من full table scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_brand_trgm ON products USING gin (brand gin_trgm_ops) WHERE brand <> '';
CREATE INDEX IF NOT EXISTS idx_categories_name_trgm ON categories USING gin (name gin_trgm_ops);

-- فهارس فرز/فلترة شائعة على قائمة المنتجات العامة (الأحدث، الأكثر مبيعاً، حسب العلامة التجارية).
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_order_count ON products(order_count DESC);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand) WHERE brand <> '';
