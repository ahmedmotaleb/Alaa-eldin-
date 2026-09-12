-- SKU مستقل تماماً عن الباركود (barcode الموجود بالفعل هو رقم شريطي للمسح الفعلي، أما SKU
-- فرمز داخلي لإدارة المخزون/المشتريات) — اختياري للمنتجات القديمة، وفريد بس لما يكون موجود.
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku_unique ON products(sku) WHERE sku IS NOT NULL AND sku <> '';

CREATE SEQUENCE IF NOT EXISTS product_sku_seq START 100001;
