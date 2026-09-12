-- جودة التجهيز (picking) — تسجيل فعلي لحالة كل صنف وقت التجهيز الفعلي، بدل قايمة تحقق
-- محلية في المتصفح بس كانت بتتمسح مع أي refresh. 'pending' الافتراضي لكل الأصناف القديمة
-- والجديدة لحد ما حد يجهّزها فعلياً.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS picked_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (picked_status IN ('pending', 'picked', 'substituted', 'unavailable'));
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS picked_note TEXT NOT NULL DEFAULT '';

-- تعليمات توصيل حرة من العميل وقت الطلب (مثال: "اترك عند الباب"، "اتصل قبل الوصول") —
-- منفصلة عن عنوان التوصيل نفسه، ومعروضة لفريق التجهيز/المندوب.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_instructions TEXT NOT NULL DEFAULT '';

-- ملاحظات داخلية على الطلب (بين فريق خدمة العملاء/التشغيل) — مش مرئية للعميل أبداً،
-- عكس delivery_instructions اللي جاية منه هو.
CREATE TABLE IF NOT EXISTS order_notes (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_by_user_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_notes_order ON order_notes(order_id);
