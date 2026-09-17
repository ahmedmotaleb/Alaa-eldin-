-- توسعة محرك الخصومات: بداية جدولة (starts_at بجانب expires_at الموجود)، تحديد نطاق
-- الخصم (طلب كامل/فئة/منتج واحد بدل "الطلب كله" فقط دايماً)، حد أدنى للكمية (مش بس قيمة
-- الطلب)، خصم أول طلب، توصيل مجاني كعرض، وحد استخدام لكل عميل (بجانب max_uses الإجمالي
-- الموجود). كل عمود إضافي وله قيمة افتراضية آمنة، فمفيش أي كود/كوبون قديم بيتأثر سلوكه.
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS starts_at DATE;
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'order'
  CHECK (scope IN ('order', 'category', 'product'));
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS scope_id TEXT;
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS min_quantity INTEGER;
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS first_order_only INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS free_delivery INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discounts ADD COLUMN IF NOT EXISTS max_uses_per_customer INTEGER;

-- سجل فعلي لكل استخدام حقيقي لكود خصم مربوط بطلب حقيقي — أساس حد "لكل عميل" (بمعزل عن
-- max_uses الإجمالي القديم). الهوية بتتحدد بـ user_id لو العميل مسجّل دخول، أو رقم موبايله
-- لو زائر (نفس مبدأ التحقق من "أول طلب" أسفله) — العمودين مش NOT NULL معاً لأن أي طلب
-- عنده واحد منهم فعلياً على الأقل.
CREATE TABLE IF NOT EXISTS discount_usages (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  discount_code TEXT NOT NULL REFERENCES discounts(code) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  customer_mobile TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_discount_usages_code_user ON discount_usages(discount_code, user_id);
CREATE INDEX IF NOT EXISTS idx_discount_usages_code_mobile ON discount_usages(discount_code, customer_mobile);
