-- حالة تفعيل الحساب — منفصلة عن is_admin/role، حساب موقوف لازم يفشل تسجيل الدخول ويفقد
-- جلساته الحالية بغض النظر عن صلاحياته. الافتراضي 1 (مفعّل) عشان كل حساب موجود يفضل شغال
-- بالظبط زي ما كان.
ALTER TABLE users ADD COLUMN IF NOT EXISTS active INTEGER NOT NULL DEFAULT 1;

-- لو مفعّلة، لوحة التحكم لازم تجبر المستخدم يغيّر كلمة المرور بعد تسجيل الدخول قبل أي
-- استخدام فعلي — مستخدمة لحسابات الموظفين اللي بينشئها الأدمن بكلمة مرور مؤقتة.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password INTEGER NOT NULL DEFAULT 0;

-- وصف مختصر اختياري للدور — مطلوب في نموذج إنشاء/تعديل دور مخصص بالواجهة.
ALTER TABLE roles ADD COLUMN IF NOT EXISTS description TEXT;
