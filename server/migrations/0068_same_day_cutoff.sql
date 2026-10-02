-- وقت آخر ميعاد لطلب توصيل نفس اليوم — كان نص ثابت "6 مساءً" في بانر الصفحة الرئيسية،
-- بقى قابل للتعديل من لوحة الإدارة (إعدادات التوصيل). 'HH:MM' بتوقيت 24 ساعة، محلي القاهرة.
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS same_day_cutoff_time TEXT NOT NULL DEFAULT '18:00';
