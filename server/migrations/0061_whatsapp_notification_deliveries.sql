-- "الإشعار المنطقي" الواحد لكل (طلب، نوع إشعار تلقائي) — منفصل تماماً عن whatsapp_messages
-- (اللي بيفضل يسجّل كل محاولة إرسال فعلية، تلقائية أو يدوية، بدون أي تعديل هدام هنا).
-- الجدول ده مسؤول بس عن ضمان إن مفيش أكتر من عملية سيرفر واحدة (حتى لو نسخ متعددة على
-- Railway) تكسب حق بدء إرسال تلقائي واحد لنفس الطلب في نفس اللحظة — عن طريق ملكية
-- (ownership) بإيجار زمني محدود (lease)، مش مجرد "SELECT قبل الإرسال".
--
-- owner_token: قيمة عشوائية غير متوقعة (UUID) بيولّدها كل محاولة ادّعاء ملكية — أي تحديث
-- لاحق لحالة الصف (sent/failed) لازم يتحقق إن owner_token لسه هو نفسه المُسجَّل، وإلا يبقى
-- معناه إن الملكية ضاعت لعملية تانية (انتهى الإيجار) ومفيش حق للكتابة فوق حالتها.
--
-- lease_expires_at: أطول عمداً من مهلة اتصال Meta نفسها (10 ثواني) بفارق كبير (90 ثانية)،
-- عشان مفيش سيناريو طبيعي يخلي الإيجار ينتهي أثناء ما الطلب الفعلي لسه بيتنفّذ.
CREATE TABLE IF NOT EXISTS whatsapp_notification_deliveries (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  owner_token TEXT,
  claimed_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- الضمان الفعلي على مستوى قاعدة البيانات: إشعار تلقائي منطقي واحد بالظبط لكل طلب+نوع —
  -- مش فحص تطبيقي وحده، القيد ده نفسه هو اللي بيمنع صفين لنفس (order_id, notification_type).
  UNIQUE (order_id, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_notification_deliveries_retry
  ON whatsapp_notification_deliveries(status, attempt_count) WHERE status = 'failed';
