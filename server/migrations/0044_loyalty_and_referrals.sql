-- الولاء (Phase 5): سجل حركات فعلي (ledger) غير قابل للتعديل — نفس نمط product_cost_history
-- الموجود بالفعل — مش عمود loyalty_balance واحد قابل للتحرير على users. الرصيد الحالي دايماً
-- هو SUM(points_change)، مفيش أي مكان بيكتب فوق رصيد قديم.
CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points_change INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('order_delivered', 'referral_bonus', 'manual_adjustment')),
  source_order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by_admin_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_user ON loyalty_ledger(user_id, created_at DESC);
-- منع منح نقاط مضاعف لنفس الطلب (مثلاً لو تحديث حالة الطلب اتكرر) — طلب واحد يمنح مرة واحدة بس.
CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_ledger_order_delivered
  ON loyalty_ledger(source_order_id) WHERE source_type = 'order_delivered';

-- الإحالة (Phase 6): كود قصير قابل للمشاركة لكل مستخدم — يتولّد أول مرة يُطلب فيها (lazy)،
-- مش عمود إضافي على users نفسه.
CREATE TABLE IF NOT EXISTS referral_codes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- سجل من أحال مين — المستخدم بيتحال مرة واحدة بس (أول كود إحالة يُستخدم وقت التسجيل هو
-- المعتمد). المكافأة (نقاط ولاء للمُحيل عبر loyalty_ledger — مش نظام مكافآت ثالث منفصل)
-- بتتمنح لما "المُحال" يوصل لأول طلب "delivered" فعلي بس، مش عند التسجيل نفسه.
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referrer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'rewarded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rewarded_at TIMESTAMPTZ,
  CONSTRAINT referrals_no_self_referral CHECK (referrer_user_id <> referred_user_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id, status);

-- معدّل اكتساب النقاط (نقطة لكل كام جنيه) ومكافأة الإحالة الثابتة — قابلة للتعديل من لوحة
-- التحكم، بنفس نمط إضافة أعمدة store_settings الحالي (migration 0015/0037).
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS loyalty_points_per_egp NUMERIC(6,3) NOT NULL DEFAULT 0.1;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS referral_bonus_points INTEGER NOT NULL DEFAULT 50;
