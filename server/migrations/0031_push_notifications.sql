-- اشتراكات دفع فعلية (Web Push API قياسي في المتصفح، مش مرتبط بأي مزوّد خارجي محتاج توكن —
-- مفتاح VAPID بيتولّد ذاتياً في السيرفر). مستخدم واحد ممكن يكون عنده أكتر من جهاز/متصفح
-- مشترك، فالمفتاح الفريد هو الـ endpoint نفسه مش user_id.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

-- تفضيلات إشعارات لكل مستخدم — صف واحد لكل مستخدم، بيتنشأ بأول قيمة افتراضية معقولة
-- (تحديثات الطلب مفعّلة، العروض التسويقية معطّلة) أول ما المستخدم يحاول يشترك.
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  order_updates INTEGER NOT NULL DEFAULT 1,
  promotions INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
