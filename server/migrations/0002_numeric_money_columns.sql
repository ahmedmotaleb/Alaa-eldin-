-- كل الأعمدة المالية كانت REAL (float4 عائم) — عرضة لأخطاء تقريب ثنائية حقيقية عند الجمع/الطرح
-- المتكرر (فلوس). NUMERIC(12,2) بيخزّن القيمة عشرياً بالظبط بأقصى 12 رقم و2 خانة عشرية،
-- وهو النوع الصحيح لأي عمود فلوس. الأمان هنا: عمود REAL أصلاً بيخزّن أرقام قريبة من قيم
-- عشرية بسيطة (فلوس حقيقية مُدخلة من نماذج إدخال، مش نتيجة حسابات معقدة داخل قاعدة البيانات
-- نفسها)، فـ USING ...::numeric(12,2) بيقرّب لأقرب قرش وبيرجّع بالظبط القيمة المقصودة.

ALTER TABLE products ALTER COLUMN price TYPE NUMERIC(12,2) USING price::numeric(12,2);
ALTER TABLE products ALTER COLUMN old_price TYPE NUMERIC(12,2) USING old_price::numeric(12,2);
ALTER TABLE products ALTER COLUMN cost TYPE NUMERIC(12,2) USING cost::numeric(12,2);

ALTER TABLE orders ALTER COLUMN subtotal TYPE NUMERIC(12,2) USING subtotal::numeric(12,2);
ALTER TABLE orders ALTER COLUMN delivery_fee TYPE NUMERIC(12,2) USING delivery_fee::numeric(12,2);
ALTER TABLE orders ALTER COLUMN total TYPE NUMERIC(12,2) USING total::numeric(12,2);
ALTER TABLE orders ALTER COLUMN discount_amount TYPE NUMERIC(12,2) USING discount_amount::numeric(12,2);

ALTER TABLE order_items ALTER COLUMN unit_price TYPE NUMERIC(12,2) USING unit_price::numeric(12,2);
ALTER TABLE order_items ALTER COLUMN line_total TYPE NUMERIC(12,2) USING line_total::numeric(12,2);

ALTER TABLE discounts ALTER COLUMN value TYPE NUMERIC(12,2) USING value::numeric(12,2);
ALTER TABLE discounts ALTER COLUMN min_order TYPE NUMERIC(12,2) USING min_order::numeric(12,2);

ALTER TABLE settlements ALTER COLUMN amount TYPE NUMERIC(12,2) USING amount::numeric(12,2);

ALTER TABLE expenses ALTER COLUMN amount TYPE NUMERIC(12,2) USING amount::numeric(12,2);

ALTER TABLE store_settings ALTER COLUMN minimum_order TYPE NUMERIC(12,2) USING minimum_order::numeric(12,2);
ALTER TABLE store_settings ALTER COLUMN free_shipping_threshold TYPE NUMERIC(12,2) USING free_shipping_threshold::numeric(12,2);
ALTER TABLE store_settings ALTER COLUMN delivery_fee TYPE NUMERIC(12,2) USING delivery_fee::numeric(12,2);
