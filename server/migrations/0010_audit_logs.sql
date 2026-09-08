-- سجل تدقيق دائم لإجراءات الإدارة (مش نفس لوجات السيرفر الخام اللي تفضل في Railway فقط).
-- old_values/new_values JSONB عشان نقدر نسجل قيمة قبل/بعد لأي حقل اتغيّر من غير ما نلزم
-- بشكل ثابت مسبقاً. الجدول ده للقراءة فقط من واجهة الإدارة — مفيش أي endpoint تعديل/حذف عليه.

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL DEFAULT '',
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin ON audit_logs(admin_user_id);
