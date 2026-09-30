-- توكنات النسخ الاحتياطي (backup.ps1 على جهاز صاحب المشروع) — بديل عن جلسة تسجيل الدخول
-- العادية للسكريبت. التوكن الفعلي بيتشاف مرة واحدة بس وقت الإنشاء؛ المخزّن هنا هو الـ hash
-- بتاعه بس (SHA-256)، زي ما بيتعامل مع كلمة السر بالظبط — لو الجدول ده اتسرّب، محدش يقدر
-- يستخرج التوكن الحقيقي منه.
CREATE TABLE IF NOT EXISTS backup_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_backup_tokens_created_by ON backup_tokens(created_by);

-- المدير ("role-manager") صلاحية كاملة على كل حاجة حالياً — نفس نمط توسيع صلاحياته اللي
-- اتعمل قبل كده مع كل صلاحية جديدة (migrations 0039/0040/0046/0048/0050/0052)، عشان الدور ده
-- يفضل فعلاً مكافئ لأدمن كامل زي ما الاسم بيقول، مش يتأخر عن كل صلاحية جديدة بتتضاف.
INSERT INTO role_permissions (role_id, permission)
SELECT 'role-manager', 'backups.manage'
WHERE NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = 'role-manager' AND permission = 'backups.manage');
