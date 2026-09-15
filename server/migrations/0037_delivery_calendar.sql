-- Phase 94: تقويم توصيل حقيقي مبني على تاريخ فعلي، بدل الاعتماد على تاريخ إنشاء الطلب فقط.
-- كل التواريخ هنا "تواريخ تقويمية" (DATE بدون منطقة زمنية) بتتفسّر دايماً بتوقيت القاهرة
-- (Africa/Cairo) من كود التطبيق (راجع server/src/cairoDate.ts) — مفيش أي خلط مع تاريخ UTC.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_date DATE NULL;
-- الطلبات القديمة (قبل الميزة دي) بتفضل NULL هنا بأمان — مفيش أي تعديل على بياناتها.

ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS delivery_days_ahead INTEGER NOT NULL DEFAULT 7;
-- عدد الأيام القادمة اللي بتتعرض للعميل كخيارات توصيل (افتراضي 7).

ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS delivery_closed_weekdays TEXT NOT NULL DEFAULT '';
-- أيام الأسبوع المغلقة بشكل افتراضي (متكرر كل أسبوع) — نص مفصول بفواصل لأرقام ISO
-- weekday (1=الاثنين ... 7=الأحد)، مثال '5' لو الجمعة مقفولة. فاضي = كل الأيام مفتوحة افتراضياً.

-- استثناءات على القاعدة الأسبوعية لتاريخ محدد بعينه (عطلة رسمية، أو فتح استثنائي يوم
-- عادة مقفول). وجود صف هنا لتاريخ معيّن بيتجاوز قاعدة delivery_closed_weekdays تماماً لنفس
-- التاريخ ده: active = true يعني "متاح" حتى لو يوم الأسبوع ده مقفول افتراضياً، active = false
-- يعني "مقفول" حتى لو يوم الأسبوع ده مفتوح افتراضياً.
CREATE TABLE IF NOT EXISTS delivery_date_overrides (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_date DATE NOT NULL UNIQUE,
  active BOOLEAN NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- سعة استثنائية لميعاد معيّن في تاريخ معيّن (اختياري) — لو مفيش صف هنا، السعة الافتراضية
-- بتيجي من delivery_slots.max_orders_per_day زي ما كان قبل كده.
CREATE TABLE IF NOT EXISTS delivery_slot_date_capacity (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  delivery_date DATE NOT NULL,
  delivery_slot_id TEXT NOT NULL REFERENCES delivery_slots(id) ON DELETE CASCADE,
  max_orders INTEGER NOT NULL CHECK (max_orders >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (delivery_date, delivery_slot_id)
);

-- بيسرّع عدّ الطلبات الحالية لميعاد+تاريخ معيّن وقت فحص السعة (يُستبعد الملغي دايماً).
CREATE INDEX IF NOT EXISTS idx_orders_delivery_date_slot
  ON orders (delivery_date, delivery_slot)
  WHERE status != 'cancelled';
