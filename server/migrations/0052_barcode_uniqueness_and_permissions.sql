-- باركود فريد فعلياً على مستوى قاعدة البيانات (كان قبل كده مجرد نص حر بدون أي ضمان تفرّد) —
-- index جزئي (بس للقيم غير الفاضية) بنفس أسلوب SKU تماماً (راجع 0028_sku.sql)، عشان منتجين
-- (أو منتج ومتغيّر) ما يقدروش يشاركوا نفس الباركود بالغلط.
--
-- ملحوظة أمان نشر مهمة: قاعدة بيانات الإنتاج فيها بيانات حقيقية مُدخلة يدوياً على مدار وقت
-- طويل من غير أي قيد تفرّد على الباركود — من الناحية النظرية ممكن يكون فيه بالفعل منتجين
-- (أو منتج ومتغيّر) بنفس قيمة الباركود بالصدفة. لو ده حصل، إنشاء index فريد عادي هيفشل
-- ويوقف كل عملية النشر (كل ملف ترحيل بيتنفذ جوه معاملة واحدة). عشان كده الإنشاء هنا محاط
-- بـ DO block بيمسك استثناء unique_violation ويسجّل تحذير واضح بدل ما يوقف النشر بالكامل —
-- لو ده حصل فعلاً، لازم صاحب المشروع يحل التعارض يدوياً (UPDATE على أحد الصفين) بعدين يشغّل
-- أمر الـ CREATE INDEX يدوياً، والكود بيفضل شغال طبيعي في الحالتين (توليد باركود جديد
-- بيتحقق دايماً من التفرّد على مستوى التطبيق كمان، مش على الـ index بس).
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique ON products(barcode) WHERE barcode <> '';
EXCEPTION
  WHEN unique_violation THEN
    RAISE WARNING 'idx_products_barcode_unique skipped: duplicate non-empty barcode values already exist in products.barcode — resolve manually, then run: CREATE UNIQUE INDEX idx_products_barcode_unique ON products(barcode) WHERE barcode <> '''' ';
END $$;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_barcode_unique ON product_variants(barcode) WHERE barcode <> '';
EXCEPTION
  WHEN unique_violation THEN
    RAISE WARNING 'idx_product_variants_barcode_unique skipped: duplicate non-empty barcode values already exist in product_variants.barcode — resolve manually, then run: CREATE UNIQUE INDEX idx_product_variants_barcode_unique ON product_variants(barcode) WHERE barcode <> '''' ';
END $$;

-- sequence واحد مشترك بين المنتجات والمتغيرات عشان الرقم المولّد يفضل فريد عالمياً بدون أي
-- تنسيق بين الجدولين وقت التوليد — نفس مبدأ product_sku_seq/order_number_seq الحالي بالظبط.
CREATE SEQUENCE IF NOT EXISTS product_barcode_seq START 100001;

-- صلاحيات طباعة/توليد الباركود — منفصلة عمداً عن products.edit العامة، لأن طباعة ملصقات
-- سعر عملية مختلفة تماماً عن تعديل بيانات المنتج (وممكن يكون مطلوب صلاحية الطباعة بس
-- لموظف مالوش صلاحية تعديل المنتج بالكامل، زي موظف التجهيز).
INSERT INTO role_permissions (role_id, permission)
SELECT 'role-manager', p FROM unnest(ARRAY[
  'products.barcode.view', 'products.barcode.generate', 'products.barcode.print'
]) AS p
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission)
SELECT 'role-inventory-manager', p FROM unnest(ARRAY[
  'products.barcode.view', 'products.barcode.generate', 'products.barcode.print'
]) AS p
ON CONFLICT DO NOTHING;

-- موظف التجهيز محتاج يطبع ملصقات لمنتجات موجودة بالفعل (مثلاً بعد جرد أو تلف ملصق) لكن
-- ملوش صلاحية توليد باركود جديد (ده قرار أدق يخص إدارة المخزون بس).
INSERT INTO role_permissions (role_id, permission)
SELECT 'role-picker', p FROM unnest(ARRAY[
  'products.barcode.view', 'products.barcode.print'
]) AS p
ON CONFLICT DO NOTHING;
