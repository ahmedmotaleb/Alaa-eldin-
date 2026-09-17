-- متغيرات المنتج (Phase 3, نطاق MVP مُتفق عليه صراحة مع المستخدم): كل منتج حالي يفضل
-- كما هو تماماً — "منتج بدون متغيرات" يعني مفيش أي صف في الجدول ده، مش تغيير مدمر على
-- products. متغير = SKU/باركود/سعر/تكلفة/مخزون مستقل بالكامل عن باقي المتغيرات وعن المنتج
-- الأب نفسه. المخزون هنا عداد بسيط (مش متتبّع بدفعات/FEFO زي المنتج الأساسي) — قرار نطاق
-- صريح لهذه الدفعة، موثّق في رسالة الـ commit.
CREATE TABLE IF NOT EXISTS product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  barcode TEXT NOT NULL DEFAULT '',
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  cost NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  available INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_sku ON product_variants(sku) WHERE sku IS NOT NULL AND sku <> '';

-- variant_id فاضي (NULL) يعني "الصنف ده كان للمنتج الأساسي بدون اختيار متغير" — بالظبط
-- سلوك كل الطلبات الحالية والمستقبلية للمنتجات اللي معندهاش متغيرات، بدون أي تغيير. اسم
-- المتغير بيتحفظ كلقطة (زي name الموجود بالفعل للمنتج نفسه) عشان يفضل ثابت في تاريخ الطلب
-- حتى لو اتغيّر اسم المتغير أو اتحذف لاحقاً.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id TEXT REFERENCES product_variants(id);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_name TEXT;

-- نفس المبدأ لحركات المخزون — product_id فاضل دايماً بيشاور للمنتج الأب (عشان أي تقرير/
-- تحليل موجود بيتجمّع على مستوى المنتج يفضل شغال بدون تعديل)، variant_id بعد كده بيحدد
-- المتغير بالتحديد لو الحركة كانت بتاعته.
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS variant_id TEXT REFERENCES product_variants(id);
