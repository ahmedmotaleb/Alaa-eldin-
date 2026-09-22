-- جدولة تغيير سعر بيع مستقبلي لمنتج أو متغير — تنفيذ فعلي بواسطة سكريبت كرون منفصل
-- (npm run pricing:apply-scheduled)، مش أي مؤقّت جوه السيرفر نفسه (نفس مبدأ كل معالجات
-- الكرون الموجودة في المشروع: loyaltyExpire.ts، sendAbandonedCartReminders.ts).
CREATE TABLE IF NOT EXISTS product_price_schedules (
  id TEXT PRIMARY KEY,
  product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
  variant_id TEXT REFERENCES product_variants(id) ON DELETE CASCADE,
  new_price NUMERIC(12,2) NOT NULL CHECK (new_price > 0),
  new_old_price NUMERIC(12,2),
  -- السعر الفعلي وقت إنشاء الجدولة (snapshot) — أساس فحص التعارض عند التنفيذ: لو السعر
  -- الحالي وقت التنفيذ الفعلي مختلف عن القيمة دي، معناه حد عدّل السعر يدوياً بعد إنشاء
  -- الجدولة، فالتنفيذ يترفض ويتسجّل status='conflict' بدل ما يبني فوق افتراض قديم صامت.
  expected_current_price NUMERIC(12,2) NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'cancelled', 'conflict')),
  applied_at TIMESTAMPTZ,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((product_id IS NULL) != (variant_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_product_price_schedules_pending ON product_price_schedules(starts_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_product_price_schedules_product ON product_price_schedules(product_id);
CREATE INDEX IF NOT EXISTS idx_product_price_schedules_variant ON product_price_schedules(variant_id);

-- نفس نمط توسيع قيود CHECK الإضافي المستخدم من قبل (migration 0046) — مصدر جديد لسجل تاريخ
-- السعر يمثّل التنفيذ التلقائي المجدول تحديداً، بمعزل عن التعديل اليدوي/الجماعي.
ALTER TABLE product_price_history DROP CONSTRAINT IF EXISTS product_price_history_source_check;
ALTER TABLE product_price_history ADD CONSTRAINT product_price_history_source_check
  CHECK (source IN ('manual_edit', 'bulk_csv', 'bulk_adjustment', 'rollback', 'scheduled_price'));
