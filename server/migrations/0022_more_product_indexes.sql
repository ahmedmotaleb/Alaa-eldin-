-- فهارس إضافية بعد مراجعة أنماط الاستعلام الفعلية بعد كل الميزات اللي اتضافت لحد دلوقتي:
--
-- idx_products_category: فلترة/عدّ المنتجات بقسم مُحدّد لوحده (من غير شرط available) —
-- زي صفحة قسم في المتجر (ProductListScreen مع category بس) وعدّاد المنتجات في كل قسم
-- (GET /api/categories). الفهرس المركّب الموجود idx_products_available_category عموده
-- الأول available، فما بيفدش استعلام بيفلتر على category_id لوحده.
--
-- idx_products_offer / idx_products_bestseller: فهارس جزئية (partial) — عروض اليوم
-- والأكثر مبيعاً في الصفحة الرئيسية بيتفلتروا بـ offer=1 / bestseller=1 لوحدهم (من غير
-- available) في كل زيارة للصفحة الرئيسية، وده استعلام متكرر جداً كان من غير فهرس مخصص له.
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_offer ON products(offer) WHERE offer = 1;
CREATE INDEX IF NOT EXISTS idx_products_bestseller ON products(bestseller) WHERE bestseller = 1;
