-- سعة يومية اختيارية لكل ميعاد توصيل — NULL معناها بلا حد أقصى (السلوك الحالي، مفيش تغيير
-- لأي ميعاد موجود لحد ما الأدمن يحدد رقم صراحة). المواعيد نفسها (now/evening/tomorrow) نص
-- نسبي مش مرتبط بتاريخ معيّن، فـ"اليوم" هو المرجع العملي الوحيد المتاح لعدّ الطلبات — تبسيط
-- متعمّد وموثّق هنا، مش نظام تواريخ توصيل كامل (ده تغيير بنيوي أكبر بكتير من النطاق الحالي).
ALTER TABLE delivery_slots ADD COLUMN IF NOT EXISTS max_orders_per_day INTEGER;

-- ربط اختياري بين مندوب وحساب دخول فعلي — عشان المندوب يقدر يسجّل دخول ويشوف طلباته بس
-- (بدل الاعتماد على is_admin/role الحاليين). NULL يعني المندوب مسجّل إدارياً بس من غير حساب
-- دخول خاص بيه (زي كل المناديب الحاليين قبل الميزة دي).
ALTER TABLE riders ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_riders_user_id ON riders(user_id) WHERE user_id IS NOT NULL;

-- مصدر جديد لتغيير حالة الطلب: المندوب نفسه بيأكّد "خرج للتوصيل"/"تم التسليم" من شاشته
-- الخاصة، مش بس الأدمن أو النظام أو العميل.
ALTER TABLE order_status_history DROP CONSTRAINT IF EXISTS order_status_history_source_check;
ALTER TABLE order_status_history ADD CONSTRAINT order_status_history_source_check
  CHECK (source IN ('admin', 'system', 'customer', 'rider'));
