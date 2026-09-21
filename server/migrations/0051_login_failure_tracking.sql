-- تتبّع محاولات تسجيل الدخول الفاشلة لكل إيميل — أساس سياسة CAPTCHA التكيّفية (adaptive).
-- مقصود يكون في قاعدة البيانات (مش متغير في الذاكرة) عشان يفضل صحيح حتى لو السيرفر
-- اتعمله restart أو كان في أكتر من نسخة شغالة (replicas) — نفس المبدأ المتّبع في كل حالة
-- تانية في المشروع محتاجة idempotency/state موثوق (زي معالج انتهاء نقاط الولاء).
-- صف واحد لكل إيميل (مش سجل تاريخي لكل محاولة) — الغرض هنا "هل الإيميل ده لسه في نافذة
-- فشل متكرر؟"، مش تدقيق أمني تفصيلي (ده موجود بالفعل في login_failed log event).
CREATE TABLE IF NOT EXISTS login_failure_tracking (
  email TEXT PRIMARY KEY,
  failure_count INTEGER NOT NULL DEFAULT 0,
  first_failure_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_failure_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
