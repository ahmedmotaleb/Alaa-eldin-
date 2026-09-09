-- إعداد اختياري: هل تظهر للعميل الكمية الدقيقة المتبقية لما المخزون يبقى منخفض
-- ("متبقي 3 فقط") ولا تفضل رسالة عامة ("مخزون منخفض") بس؟ افتراضياً متوقف (رسالة عامة).
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS show_exact_low_stock INTEGER NOT NULL DEFAULT 0;
