-- store_settings صف id=1 كان بيتعمل بس من خلال src/seed.ts — سكربت اختياري (npm run
-- db:seed) لا يشتغل أبداً تلقائياً في مسار الإقلاع أو النشر (railway.json startCommand
-- بيشغّل npm run start بس، مفيش seed). أي قاعدة بيانات جديدة فعلاً (تجربة CI على قاعدة
-- فاضية، أو استعادة كارثة حقيقية من نسخة احتياطية فاضية) هتفضل من غير الصف ده، وأي
-- استعلام بيقرا SELECT ... FROM store_settings WHERE id = 1 (زي GET /api/settings)
-- هيرجع صف فاضي ويطلع 500 فوراً — ده اتأكد فعلياً بتشغيل الاختبارات ضد قاعدة بيانات
-- جديدة تماماً (مش قاعدة التطوير المحلية القديمة اللي كانت بتخفي المشكلة دي لإن الصف
-- كان موجود فيها من زمان). الحل: نضمن وجود الصف من خلال الـ migration نفسها (نفس فلسفة
-- "PostgreSQL كآلية صحة" المتّبعة في باقي المشروع) بدل الاعتماد على خطوة يدوية منفصلة.
-- ON CONFLICT DO NOTHING يخليها آمنة 100% على أي قاعدة بيانات فيها الصف بالفعل (زي
-- الإنتاج الحالي) — مفيش أي تعديل على بيانات حقيقية موجودة.
INSERT INTO store_settings (id, name, whatsapp_number, currency, minimum_order, free_shipping_threshold, delivery_fee)
VALUES (1, 'علاء الدين', '01XXXXXXXXX', 'ج.م', 100, 500, 30)
ON CONFLICT (id) DO NOTHING;
