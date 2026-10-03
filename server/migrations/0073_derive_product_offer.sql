-- products.offer كان عمود عادي محتاج يتحدّث يدوياً من كل مسار كتابة سعر (تعديل يدوي،
-- استيراد CSV، تحديث أسعار بالجملة، rollback العمليات الجماعية، تنفيذ الجدولة) — وده
-- بالضبط سبب "عروض شبح" (phantom offers): أي مسار واحد نسي يحدّثه يسيب offer=1 قديم
-- مع old_price بقى NULL أو أصغر من السعر الحالي، أو العكس (خصم حقيقي بـ offer=0).
--
-- الحل الجذري بدل مزامنة كل مسار كتابة لوحده (وفضل عرضة لمسار جديد يُنسى منه في المستقبل):
-- نحوّل offer لعمود GENERATED حقيقي محسوب دايماً من old_price/price في قاعدة البيانات
-- نفسها — مستحيل يبقى غير متزامن تاني (PostgreSQL بيرفض أي INSERT/UPDATE يحاول يحدد قيمة
-- له صراحة)، وأي صف قديم فيه offer شبح بيتصحح تلقائياً فور ما العمود يتضاف من جديد (إعادة
-- حساب كاملة للجدول وقت ALTER، بدون أي خطوة تنضيف يدوية منفصلة مطلوبة).
DROP INDEX IF EXISTS idx_products_offer;

ALTER TABLE products DROP COLUMN offer;

ALTER TABLE products ADD COLUMN offer INTEGER NOT NULL GENERATED ALWAYS AS (
  CASE WHEN old_price IS NOT NULL AND old_price > price THEN 1 ELSE 0 END
) STORED;

CREATE INDEX IF NOT EXISTS idx_products_offer ON products(offer) WHERE offer = 1;

-- "إنهاء العرض" من لوحة التحكم (مسح old_price بس، من غير تغيير السعر الحالي) بيحتاج قيمة
-- مصدر جديدة مميزة في سجل تاريخ السعر، بنفس نمط توسيع القيد المستخدم في migration 0056.
ALTER TABLE product_price_history DROP CONSTRAINT IF EXISTS product_price_history_source_check;
ALTER TABLE product_price_history ADD CONSTRAINT product_price_history_source_check
  CHECK (source IN ('manual_edit', 'bulk_csv', 'bulk_adjustment', 'rollback', 'scheduled_price', 'end_offer'));
