-- تحديث الأسعار بالجملة (Bulk Price Update): يحتاج عمود "سعر قبل الخصم" على المتغيرات
-- نفسه (مش موجود قبل كده — المتغيرات كانت بتعتمد بس على سعر واحد بدون خصم مُعلن)، عشان
-- قالب الأسعار يقدر يشمل صف متغير بالظبط زي صف منتج عادي من غير فرق في الأعمدة.
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS old_price NUMERIC(12,2) CHECK (old_price IS NULL OR old_price >= 0);

-- سجل تكلفة المنتجات (product_cost_history) كان بيتتبّع تكلفة المنتج الأساسي بس — تعديل
-- تكلفة متغير (سواء يدوي من الفورم أو من تحديث الأسعار بالجملة) محتاج نفس مستوى التتبّع،
-- مش يضيع بصمت. product_id يفضل مطلوب (يشاور للمنتج الأب دايماً، لتوافق التقارير الحالية
-- اللي بتجمّع على مستوى المنتج) — variant_id عمود إضافي اختياري بس لما يكون التغيير خاص
-- بمتغير تحديداً.
ALTER TABLE product_cost_history ADD COLUMN IF NOT EXISTS variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL;

-- نفس نمط توسيع قيود CHECK الإضافي المستخدم من قبل (migration 0026 لـ stock_movements) —
-- إضافة قيمة جديدة لمصدر تسجيل التكلفة بدل ما نعيد استخدام 'manual_adjustment' العام، عشان
-- تحليلات لاحقة تقدر تفرّق بسهولة بين تعديل يدوي لمنتج واحد وتحديث جماعي عبر ملف.
ALTER TABLE product_cost_history DROP CONSTRAINT IF EXISTS product_cost_history_source_type_check;
ALTER TABLE product_cost_history ADD CONSTRAINT product_cost_history_source_type_check
  CHECK (source_type IN ('purchase_receipt', 'manual_adjustment', 'bulk_price_update'));

-- صلاحية RBAC مخصّصة لتحديث الأسعار بالجملة — مقصودة عمداً مش نفس "products.edit" العامة،
-- عشان دور زي مسؤول المشتريات (عنده products.cost_view بس) أو موظف التجهيز ميقدروش
-- يغيّروا أسعار كتالوج كامل بالغلط حتى لو كان عندهم صلاحيات تانية على المنتجات. بتتمنح هنا
-- بس لدوري "المدير" (صلاحية كاملة أصلاً) و"مدير المخزون" (عنده products.edit بالفعل، تحديث
-- الأسعار بالجملة امتداد طبيعي لصلاحيته الحالية).
INSERT INTO role_permissions (role_id, permission)
SELECT r, 'products.pricing.bulk_update' FROM unnest(ARRAY['role-manager', 'role-inventory-manager']) AS r
ON CONFLICT DO NOTHING;
