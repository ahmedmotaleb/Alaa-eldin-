-- تغيير رقم واتساب خدمة العملاء (store_settings.whatsapp_number) لازم يتم عبر كود تأكيد
-- (OTP) يتبعت للرقم الجديد فعلياً قبل ما يبقى نشط — الرقم القديم المؤكد يفضل شغال لحد ما
-- التحقق ينجح (راجع whatsappNumberVerificationService.ts). otp_hash بس (مش الكود نفسه نص صريح).
CREATE TABLE IF NOT EXISTS whatsapp_number_verifications (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES users(id),
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

-- بيسرّع البحث عن "هل عند هذا الأدمن تحقق معلّق فعلاً؟" (مطلوب في كل طلب/إعادة إرسال).
CREATE INDEX IF NOT EXISTS idx_whatsapp_number_verifications_admin_pending
  ON whatsapp_number_verifications (admin_user_id)
  WHERE verified_at IS NULL AND cancelled_at IS NULL;
