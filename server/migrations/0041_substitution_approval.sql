-- تفضيل العميل وقت الدفع لما صنف يبقى مش متوفر وقت التجهيز: استبدال بمنتج مشابه تلقائياً،
-- أو الاتصال به للموافقة الأول، أو حذف الصنف مباشرة. 'contact_me' هو الافتراضي الأكثر أماناً
-- (ما بيغيّرش حاجة من غير موافقة العميل) للطلبات القديمة والجديدة اللي متحددتش صراحة.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS substitution_preference TEXT NOT NULL DEFAULT 'contact_me'
  CHECK (substitution_preference IN ('replace_similar', 'contact_me', 'remove_item'));

-- لقطة فعلية للبديل المقترح (اسم/وحدة/سعر وقت الاقتراح، مش مرجع حي بيتغير مع تغيير سعر
-- المنتج لاحقاً) — نفس مبدأ order_items.name/unit_price الحالي للصنف الأصلي.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS replacement_product_id TEXT REFERENCES products(id);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS replacement_name TEXT NOT NULL DEFAULT '';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS replacement_unit TEXT NOT NULL DEFAULT '';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS replacement_quantity INTEGER;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS replacement_unit_price NUMERIC(12,2);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS replacement_line_total NUMERIC(12,2);

-- محور منفصل عن picked_status الحالي عمداً: picked_status بيوصف نتيجة التجهيز الفعلية،
-- substitution_status بيوصف حالة *مسار الموافقة* على البديل المقترح. صنف "بانتظار موافقة
-- العميل" لسه picked_status='pending' لحد ما يتقرر مصيره.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS substitution_status TEXT NOT NULL DEFAULT 'none'
  CHECK (substitution_status IN ('none', 'proposed', 'approved', 'rejected'));
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS substitution_proposed_by_user_id TEXT REFERENCES users(id);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS substitution_proposed_at TIMESTAMPTZ;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS substitution_decided_at TIMESTAMPTZ;

-- نوع حركة مخزون جديد: استرجاع رصيد الصنف الأصلي بعد اعتماد استبداله بمنتج تاني فعلياً —
-- منفصل عن 'cancel_restore' (اللي معناه الطلب كله اتلغى) عشان يفضل واضح في تقارير المخزون
-- إن ده استرجاع جزئي بسبب استبدال، مش إلغاء طلب.
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN ('restock', 'return', 'damage', 'loss', 'adjustment', 'sale', 'cancel_restore', 'expired', 'supplier_return', 'substitution_restore'));
