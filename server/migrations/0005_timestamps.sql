-- كل تواريخ/أوقات النظام كانت TEXT (سلسلة ISO ثابتة مُولَّدة من JS) — بلا أي تحقق نوعي حقيقي
-- من قاعدة البيانات، ومفيش فايدة من فرز/فلترة زمنية صحيحة على مستوى SQL. TIMESTAMPTZ هو
-- النوع الصحيح لأي "لحظة زمنية حقيقية" (وقت الإنشاء، انتهاء الجلسة/الرمز...إلخ).
-- expires_at الخاص بالخصومات وexpense_date الخاصين بالمصروفات مختلفين: دول "تاريخ" فعلي
-- (يوم كامل بدون وقت/منطقة زمنية، جايين من input[type=date] في لوحة التحكم)، فبيتحوّلوا
-- لـ DATE مش TIMESTAMPTZ — ده أدق لمعناهم الفعلي وبيتجنّب أي التباس بسبب المنطقة الزمنية.
ALTER TABLE users ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;

ALTER TABLE sessions ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
ALTER TABLE sessions ALTER COLUMN expires_at TYPE TIMESTAMPTZ USING expires_at::timestamptz;

ALTER TABLE password_resets ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
ALTER TABLE password_resets ALTER COLUMN expires_at TYPE TIMESTAMPTZ USING expires_at::timestamptz;

ALTER TABLE products ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;

ALTER TABLE orders ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;

ALTER TABLE discounts ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
ALTER TABLE discounts ALTER COLUMN expires_at TYPE DATE USING NULLIF(expires_at, '')::date;

ALTER TABLE stock_movements ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;

ALTER TABLE banners ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;

ALTER TABLE expenses ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
ALTER TABLE expenses ALTER COLUMN expense_date TYPE DATE USING expense_date::date;

ALTER TABLE settlements ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
