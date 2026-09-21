-- فهارس دعم البحث الشامل بالأدمن (Ctrl+K) — pg_trgm بالفعل مفعّل من migration 0014.
-- برضو بنعمل فهرسة عادية (btree) على order_number/po_number عشان مطابقة "يبدأ بـ" السريعة
-- (المطابقة التامة أصلاً مغطاة بقيود UNIQUE الموجودة عليهم).

CREATE INDEX IF NOT EXISTS idx_orders_order_number_trgm ON orders USING gin (order_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_orders_customer_full_name_trgm ON orders USING gin (customer_full_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_users_full_name_trgm ON users USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_email_trgm ON users USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile) WHERE mobile IS NOT NULL AND mobile <> '';

CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm ON suppliers USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_po_number_trgm ON purchase_orders USING gin (po_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_product_variants_name_trgm ON product_variants USING gin (name gin_trgm_ops);
