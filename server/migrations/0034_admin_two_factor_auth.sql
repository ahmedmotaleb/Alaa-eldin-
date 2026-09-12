-- مصادقة ثنائية (TOTP) اختيارية لحسابات لوحة التحكم — totp_secret بيتخزّن كنص عادي (base32)
-- عمداً، مش مشفّر بـ hash، لأن التحقق بيحتاج القيمة الأصلية عشان يحسب الكود الحالي؛ الحماية
-- الفعلية هي حصر الوصول لقاعدة البيانات نفسها، زي أي سر تاني في السيستم.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled INTEGER NOT NULL DEFAULT 0;

-- أكواد احتياطية لمرة واحدة (لو المستخدم فقد جهاز المصادقة) — مخزّنة كـ hash زي كلمة المرور
-- بالظبط، مش نص عادي.
CREATE TABLE IF NOT EXISTS user_backup_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_backup_codes_user ON user_backup_codes(user_id);

-- حالة وسيطة بين "كلمة المرور صحيحة" و"الجلسة الفعلية اتعملت" — لحساب مفعّل عليه المصادقة
-- الثنائية. عمرها قصير جداً (دقايق) ومحدودة الاستخدام لمرة واحدة بس.
CREATE TABLE IF NOT EXISTS pending_two_factor_logins (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
