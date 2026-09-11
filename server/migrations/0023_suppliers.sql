-- الموردين — كل الحقول عدا الاسم اختيارية تماماً (مطابقة للطلب الصريح: لا تُلزم بحقول
-- زيادة عن الاسم). "active" بيتحكم في ظهور المورد في اختيارات أوامر الشراء الجديدة بس —
-- أوامر الشراء القديمة بتاعته تفضل زي ما هي.
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  tax_number TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);
CREATE INDEX IF NOT EXISTS idx_suppliers_mobile ON suppliers(mobile) WHERE mobile <> '';
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(active);

-- ربط منتج بمورد (أو أكتر) — يُستخدم لاحقاً في اقتراحات الشراء وأوامر الشراء وتاريخ
-- التكلفة. منتج من غير أي مورد مربوط يفضل شغال عادي في كل حتة تانية بالتطبيق.
CREATE TABLE IF NOT EXISTS supplier_products (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_sku TEXT NOT NULL DEFAULT '',
  last_cost NUMERIC(12,2),
  lead_time_days INTEGER,
  minimum_order_qty INTEGER,
  preferred INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_products_product ON supplier_products(product_id);
CREATE INDEX IF NOT EXISTS idx_supplier_products_supplier ON supplier_products(supplier_id);
-- مورد "مفضّل" واحد بس لكل منتج (بيُستخدم كافتراضي في أوامر الشراء واقتراحات إعادة الطلب).
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_products_one_preferred
  ON supplier_products(product_id) WHERE preferred = 1;
