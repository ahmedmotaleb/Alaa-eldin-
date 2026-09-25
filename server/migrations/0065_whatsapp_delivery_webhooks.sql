-- لحد دلوقتي، "sent" جوه whatsapp_messages.status معناها بس "Meta API قبلت الطلب" — مفيش أي
-- تأكيد حقيقي إن الرسالة وصلت فعلياً لجهاز العميل أو اتقرت. ده فرق جوهري تم توضيحه صراحة في
-- واجهة الأدمن (acceptance ≠ delivery) بس فضل مينفعش يتأكد بدون webhook حقيقي من Meta. الجدول
-- ده سجل append-only لكل حدث حالة (sent/delivered/read/failed) بييجي من webhook واتساب —
-- بيحتفظ بالـ payload الخام كمان لأي تدقيق لاحق، ومحمي من التكرار (Meta بتوعد بس بـ
-- at-least-once delivery، ممكن نفس الحدث يوصل أكتر من مرة) عبر قيد فريد على
-- (provider_message_id, status, event_timestamp).
CREATE TABLE whatsapp_message_status_events (
  id TEXT PRIMARY KEY,
  provider_message_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  event_timestamp TIMESTAMPTZ NOT NULL,
  recipient_wa_id TEXT,
  error_code TEXT,
  error_title TEXT,
  raw_payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_message_id, status, event_timestamp)
);
CREATE INDEX idx_whatsapp_message_status_events_provider_message
  ON whatsapp_message_status_events(provider_message_id);

-- عمود مُلخّص (denormalized) على whatsapp_messages نفسها — يفضل يتحدّث بس من الـ webhook ده،
-- أبداً من مسار الإرسال نفسه (اللي بيعرف بس "اتقبلت من Meta"، مش "اتسلّمت"). محمي من
-- التحديث الرجعي (event متأخر وصل بعد حدث أحدث منه — Meta مش دايماً بتضمن ترتيب التسليم)
-- عبر مقارنة event_timestamp نفسه وقت التحديث (راجع whatsappWebhookService.ts)، مش وقت وصول
-- الطلب للسيرفر.
ALTER TABLE whatsapp_messages ADD COLUMN delivery_status TEXT
  CHECK (delivery_status IS NULL OR delivery_status IN ('sent', 'delivered', 'read', 'failed'));
ALTER TABLE whatsapp_messages ADD COLUMN delivery_status_updated_at TIMESTAMPTZ;
