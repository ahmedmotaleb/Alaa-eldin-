-- قوالب رسائل واتساب جاهزة (تُستخدم من صفحة الطلب) + سجل فعلي لكل محاولة إرسال حقيقية عبر
-- WhatsApp Business Cloud API — منفصل تماماً عن رابط "wa.me" اليدوي الموجود بالفعل في
-- OrderDrawer، اللي بيفضل شغال دايماً كـ fallback حتى لو الـ API مش متصل.
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'custom',
  content TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- سجل كل محاولة إرسال فعلية (نجحت أو فشلت) عبر الـ API الحقيقي — للمراجعة والتدقيق، مش
-- لتخزين أي بيانات اعتماد (التوكن نفسه بييجي من متغيرات بيئة السيرفر، مش من قاعدة البيانات).
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  template_id TEXT REFERENCES whatsapp_templates(id) ON DELETE SET NULL,
  to_number TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  provider_message_id TEXT,
  error TEXT,
  created_by_user_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_order ON whatsapp_messages(order_id);

INSERT INTO whatsapp_templates (id, name, category, content) VALUES
  ('wa-tpl-order-confirmed', 'تأكيد الطلب', 'order_confirmation', 'مرحباً {{customerName}}، تم استلام طلبك رقم {{orderNumber}} وجاري تجهيزه. شكراً لتسوقك من علاء الدين.'),
  ('wa-tpl-ready-for-delivery', 'جاهز للتوصيل', 'ready_for_delivery', 'مرحباً {{customerName}}، طلبك رقم {{orderNumber}} جاهز وهيتم تسليمه قريباً.'),
  ('wa-tpl-out-for-delivery', 'خرج للتوصيل', 'out_for_delivery', 'مرحباً {{customerName}}، طلبك رقم {{orderNumber}} في الطريق إليك الآن.'),
  ('wa-tpl-delivered', 'تم التوصيل', 'delivered', 'مرحباً {{customerName}}، تم تسليم طلبك رقم {{orderNumber}} بنجاح. شكراً لثقتك في علاء الدين.')
ON CONFLICT (id) DO NOTHING;
