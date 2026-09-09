-- رقم موبايل العميل نفسه (مختلف عن أرقام موبايل عناوين التوصيل) — يُستخدم في صفحة "حسابي"،
-- اختياري لحد ما العميل يحدّثه بنفسه.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile TEXT;

-- عناوين محفوظة للعميل (اختيارية بالكامل) — أي حقل غير الأساسي (المحافظة/المنطقة/العنوان)
-- اختياري، ومفيش أي إجبار إن العميل يستخدم العناوين المحفوظة (الطلب كضيف يفضل شغال زي ما هو).
CREATE TABLE IF NOT EXISTS customer_addresses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  full_name TEXT,
  mobile TEXT,
  governorate TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  building TEXT NOT NULL DEFAULT '',
  floor TEXT NOT NULL DEFAULT '',
  apartment TEXT NOT NULL DEFAULT '',
  landmark TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_addresses_user ON customer_addresses(user_id);
-- عنوان افتراضي واحد بالظبط لكل عميل.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_addresses_one_default
  ON customer_addresses(user_id) WHERE is_default = 1;

-- المفضلة — منتج واحد بيظهر مرة واحدة بس لكل عميل.
CREATE TABLE IF NOT EXISTS customer_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_favorites_product ON customer_favorites(product_id);

-- تتبّع آمن لطلب الزائر: token عشوائي عالي الإنتروبيا بيتولّد وقت إنشاء الطلب (لو الطلب
-- من غير تسجيل دخول فقط)، وبيبقى الطريقة الوحيدة لفتح رابط تتبع الطلب ده تاني — رقم الطلب
-- لوحده مش كفاية. الطلبات المرتبطة بحساب (user_id مش NULL) بتفضل تعتمد على تسجيل الدخول
-- والملكية زي ما هي، مش على التوكن ده.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_tracking_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_guest_tracking_token
  ON orders(guest_tracking_token) WHERE guest_tracking_token IS NOT NULL;
