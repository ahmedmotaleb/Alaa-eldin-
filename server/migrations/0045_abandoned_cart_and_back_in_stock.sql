-- السلة المهجورة (Phase 7): مرآة بسيطة لمحتوى سلة العميل المسجّل دخول فقط — العميل الزائر
-- (بدون حساب) مفيش أي وسيلة نوصله بيها أصلاً، فمفيش داعي نخزّن سلته. صف واحد لكل مستخدم
-- (يتحدّث فوق نفسه، مش سجل تاريخي)، لأن الغرض الوحيد منه هو "هل لسه سلته فيها حاجة من
-- زمان ومحدش خلّصها؟"، مش تتبّع تاريخي لكل تغيير.
CREATE TABLE IF NOT EXISTS cart_snapshots (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  items JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reminder_sent_at TIMESTAMPTZ
);

-- التنبيه عند التوفر (Phase 8): اشتراك صريح لكل (مستخدم، منتج) — بمجرد ما يتبعت التنبيه
-- الصف بيتمسح تماماً (مش يتعلّم كـ "notified")، عشان العميل يقدر يشترك تاني بسهولة لو
-- المنتج نفد تاني بعدين من غير أي تعارض unique قديم.
CREATE TABLE IF NOT EXISTS back_in_stock_subscriptions (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_back_in_stock_product ON back_in_stock_subscriptions(product_id);
