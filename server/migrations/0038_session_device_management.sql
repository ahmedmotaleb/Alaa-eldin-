-- إدارة الجلسات والأجهزة: بيانات وصفية إضافية على جدول sessions الموجود (مفيش fingerprinting
-- تدخّلي، بس معلومات كافية تساعد المستخدم يتعرّف على أجهزته المسجّل دخول منها).
--
-- id هنا معرّف عام آمن للجلسة (مش السر نفسه) — عمود محسوب (GENERATED) من md5(token)، عشان
-- الـ API يقدر يرجّعه للمستخدم يستخدمه في DELETE /sessions/:id من غير ما يرجّع التوكن السري
-- الحقيقي (اللي هو نفسه اللي جوه كوكي الجلسة) في أي رد JSON أبداً.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS id TEXT GENERATED ALWAYS AS (md5(token)) STORED;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_id ON sessions(id);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_name TEXT;
-- تجزئة أحادية الاتجاه لعنوان IP (مش العنوان نفسه) — لأغراض تدقيق أمني بس، مش بتتعرض في أي API.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_hash TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sessions_user_last_seen ON sessions(user_id, last_seen_at DESC);
