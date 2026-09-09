-- مناطق التوصيل: بديل عن رسوم توصيل واحدة ثابتة لكل المحافظات — كل محافظة بقى ليها رسوم
-- توصيل مستقلة (ومفتاحها هو اسم المحافظة نفسه، زي ما هو مخزّن فعلاً في customer_addresses
-- وorders.customer_governorate، عشان من غير أي هجرة بيانات قديمة). بتتفعّل/تتعطّل مستقلة
-- عن بعض بدل ما تتحذف (لو أدمن عايز يوقف التوصيل لمحافظة معينة مؤقتاً).
CREATE TABLE IF NOT EXISTS delivery_zones (
  governorate TEXT PRIMARY KEY,
  delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- مواعيد التوصيل: كانت قايمة ثابتة في كود الواجهة الأمامية بس — دلوقتي مُدارة من السيرفر
-- (الأدمن يقدر يضيف/يعدّل ميعاد) وبيتم التحقق منها فعلياً وقت الطلب، مش مجرد شكل واجهة.
CREATE TABLE IF NOT EXISTS delivery_slots (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- تعبئة أولية: كل المحافظات الـ27 برسوم التوصيل الثابتة الحالية (store_settings.delivery_fee)
-- كنقطة بداية — الأدمن يقدر يعدّل كل واحدة لوحدها بعد كده من غير أي تأثير على الباقي.
INSERT INTO delivery_zones (governorate, delivery_fee, sort_order)
SELECT g.name, COALESCE((SELECT delivery_fee FROM store_settings WHERE id = 1), 0), g.ord
FROM (VALUES
  ('القاهرة', 0), ('الجيزة', 1), ('القليوبية', 2), ('الإسكندرية', 3), ('البحيرة', 4),
  ('مطروح', 5), ('كفر الشيخ', 6), ('الدقهلية', 7), ('دمياط', 8), ('الشرقية', 9),
  ('الغربية', 10), ('المنوفية', 11), ('بورسعيد', 12), ('الإسماعيلية', 13), ('السويس', 14),
  ('شمال سيناء', 15), ('جنوب سيناء', 16), ('الفيوم', 17), ('بني سويف', 18), ('المنيا', 19),
  ('أسيوط', 20), ('سوهاج', 21), ('قنا', 22), ('الأقصر', 23), ('أسوان', 24),
  ('البحر الأحمر', 25), ('الوادي الجديد', 26)
) AS g(name, ord)
ON CONFLICT (governorate) DO NOTHING;

-- ملحوظة الشحن المجاني على ميعاد "بكرة صباحاً" اتشالت من النص هنا — كانت رقم ثابت (500 ج.م)
-- مكتوب في الواجهة من غير أي علاقة حقيقية بـ store_settings.free_shipping_threshold الفعلي؛
-- دلوقتي النص قابل للتعديل من لوحة التحكم فمفيش داعي لرقم وهمي فيه.
INSERT INTO delivery_slots (id, label, note, sort_order) VALUES
  ('now', 'أقرب وقت (خلال ساعتين)', 'اليوم قبل 8 مساءً', 0),
  ('evening', 'اليوم مساءً — 6:00 إلى 9:00', 'مناسب لو مش موجود دلوقتي', 1),
  ('tomorrow', 'بكرة صباحاً — 9:00 إلى 12:00', '', 2)
ON CONFLICT (id) DO NOTHING;
