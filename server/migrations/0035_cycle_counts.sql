-- جرد دوري (cycle count) — عد فعلي لمخزون منتجات (كل المنتجات أو قسم معين) ومطابقته مع
-- رقم المخزون المسجّل في النظام، مع تسوية الفروقات (reconciliation) كحركة مخزون موثّقة.
CREATE TABLE IF NOT EXISTS cycle_counts (
  id TEXT PRIMARY KEY,
  category_id TEXT REFERENCES categories(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed', 'cancelled')),
  note TEXT NOT NULL DEFAULT '',
  created_by_user_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- system_quantity: لقطة (snapshot) من مخزون النظام وقت إنشاء الجرد — للعرض/المقارنة بس.
-- counted_quantity: الكمية الفعلية المعدودة (NULL لحد ما حد يدخلها). التسوية الفعلية عند
-- الإكمال بتستخدم مخزون النظام *وقت الإكمال* (الحالي، مش اللقطة القديمة) عشان أي حركة بيع/
-- تجديد حصلت بين إنشاء الجرد وإكماله متتجاهلش أو تتمسح بالغلط.
CREATE TABLE IF NOT EXISTS cycle_count_items (
  id TEXT PRIMARY KEY,
  cycle_count_id TEXT NOT NULL REFERENCES cycle_counts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  system_quantity INTEGER NOT NULL,
  counted_quantity INTEGER,
  UNIQUE (cycle_count_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_cycle_count_items_cycle ON cycle_count_items(cycle_count_id);
