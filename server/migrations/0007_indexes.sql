-- فهارس أداء لاستعلامات شائعة (قائمة الطلبات مرتبة بالتاريخ، فلترة بالحالة، البحث برقم
-- الموبايل، ربط عناصر الطلب بالمنتج، فلترة المنتجات المتاحة داخل قسم، البحث بالباركود).
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer_mobile ON orders(customer_mobile);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_products_available_category ON products(available, category_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode <> '';
