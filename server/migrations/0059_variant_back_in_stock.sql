-- اشتراك "أعلمني عند التوفر" لمتغيّر محدد، مش بس المنتج الأساسي — عمود إضافي اختياري
-- بنفس مبدأ كل الأعمدة المشابهة (variant_id NULL يعني اشتراك على المنتج الأساسي نفسه).
--
-- القيد الفريد القديم UNIQUE(user_id, product_id) ما بيقدرش يميّز بين اشتراك على المنتج
-- الأساسي واشتراك على متغيّر منه لنفس المستخدم — لازم نلغيه ونستبدله بفهرس فريد يعتمد على
-- COALESCE(variant_id, '') بدل الاعتماد على العمود مباشرة، لأن NULL في Postgres ما بيتساويش
-- مع NULL في قيود UNIQUE العادية (يعني كان هيسمح باشتراكات مكررة على نفس المنتج الأساسي).
ALTER TABLE back_in_stock_subscriptions ADD COLUMN IF NOT EXISTS variant_id TEXT REFERENCES product_variants(id);

ALTER TABLE back_in_stock_subscriptions DROP CONSTRAINT IF EXISTS back_in_stock_subscriptions_user_id_product_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_back_in_stock_subscriptions_unique
  ON back_in_stock_subscriptions (user_id, product_id, COALESCE(variant_id, ''));

CREATE INDEX IF NOT EXISTS idx_back_in_stock_variant ON back_in_stock_subscriptions(variant_id);
