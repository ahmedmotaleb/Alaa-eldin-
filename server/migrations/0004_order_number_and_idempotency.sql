-- orders.id يتولّد من السيرفر من الآن (UUID عشوائي) بدل ما يبعته العميل — العميل ممكن
-- يبعت أي id عشوائي/متضارب/يحاول يخمّن id طلب حد تاني. order_number هو الرقم المعروض
-- للعميل فعلياً (قصير، قابل للقراءة والنطق في واتساب/تليفون)، يتولّد ذرياً من sequence
-- فمفيش خطر تضارب حتى مع طلبات متزامنة. الصفوف القديمة (قبل هذا الترحيل) بيتحفظلها
-- order_number = نفس الـ id القديم (اللي كان أصلاً معروض للعميل كرقم الطلب)، عشان
-- التاريخ يفضل صحيح ومفيش بيانات بتتفقد.
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 100001;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_number TEXT;
UPDATE orders SET order_number = id WHERE order_number IS NULL;
ALTER TABLE orders ALTER COLUMN order_number SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_order_number_unique') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_order_number_unique UNIQUE (order_number);
  END IF;
END $$;

-- مفتاح idempotency اختياري (nullable — الطلبات القديمة قبل هذا الترحيل مفيهاش، ومفيش
-- مشكلة، مقيّد unique بس لما يكون موجود فعلاً عشان أكتر من صف NULL يفضل مسموح).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
