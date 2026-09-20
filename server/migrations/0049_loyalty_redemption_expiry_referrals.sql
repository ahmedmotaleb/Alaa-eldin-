-- الولاء: استخدام النقاط عند الدفع + انتهاء الصلاحية (FIFO) + إحالة العميل الجديد.
-- إضافي بالكامل — ما بيلمسش أي عمود أو صف موجود، والرصيد الحالي (SUM(points_change))
-- بيفضل زي ما هو تماماً بعد هذا الترحيل.

-- ---------- إعدادات برنامج الولاء (إضافية على store_settings الموجود) ----------
-- loyalty_points_per_egp (معدّل الاكتساب) موجود بالفعل من migration 0044 — مبنتكررش هنا.
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS loyalty_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS loyalty_point_value_egp NUMERIC(8,4) NOT NULL DEFAULT 0.05;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS loyalty_min_redeem_points INTEGER NOT NULL DEFAULT 100;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS loyalty_max_redemption_percent INTEGER NOT NULL DEFAULT 20;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS loyalty_min_order_for_redemption NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS loyalty_expiry_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS loyalty_expiry_days INTEGER NOT NULL DEFAULT 365;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS loyalty_expiry_warning_days INTEGER NOT NULL DEFAULT 30;

-- ---------- إعدادات برنامج الإحالة (إضافية) ----------
-- referral_bonus_points (مكافأة المُحيل) موجود بالفعل من migration 0044 — مبنتكررش هنا.
-- حالة "شرط التأهيل" (قيمة الطلب) ثابتة على 'delivered' عمداً (نفس الآلية الحالية بالظبط)
-- — تفعيلها على حالة تانية يحتاج إعادة بناء نقطة الربط في recordOrderStatusChange، وده
-- برة نطاق الدفعة دي (خارج "لا تعيد بناء نظام الولاء/الإحالة الموجود").
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS referral_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS referral_referred_bonus_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS referral_min_qualifying_order NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ---------- لقطة الاستخدام على الطلب نفسه (لا يُعاد حسابها لاحقاً بإعدادات جديدة) ----------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS loyalty_points_redeemed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS loyalty_discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD CONSTRAINT orders_loyalty_points_redeemed_check CHECK (loyalty_points_redeemed >= 0);
ALTER TABLE orders ADD CONSTRAINT orders_loyalty_discount_amount_check CHECK (loyalty_discount_amount >= 0);

-- ---------- توسيع أنواع حركات سجل الولاء ----------
ALTER TABLE loyalty_ledger DROP CONSTRAINT IF EXISTS loyalty_ledger_source_type_check;
ALTER TABLE loyalty_ledger ADD CONSTRAINT loyalty_ledger_source_type_check
  CHECK (source_type IN (
    'order_delivered', 'referral_bonus', 'manual_adjustment',
    'redeemed', 'redemption_reversal', 'earned_reversal', 'expired'
  ));

-- منع أكتر من حركة "استخدام نقاط" أو "استرجاع استخدام" أو "إلغاء اكتساب" واحدة لنفس الطلب —
-- نفس مبدأ idx_loyalty_ledger_order_delivered الموجود بالفعل (migration 0044)، بس لكل نوع
-- حركة جديد بمفرده.
CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_ledger_redeemed_order
  ON loyalty_ledger(source_order_id) WHERE source_type = 'redeemed';
CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_ledger_redemption_reversal_order
  ON loyalty_ledger(source_order_id) WHERE source_type = 'redemption_reversal';
CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_ledger_earned_reversal_order
  ON loyalty_ledger(source_order_id) WHERE source_type = 'earned_reversal';

-- ---------- دفعات النقاط (lots) — محاسبة الانتهاء بترتيب FIFO ----------
-- سجل loyalty_ledger يفضل هو مصدر الحقيقة الوحيد للرصيد الظاهر للعميل (SUM(points_change)) —
-- الجدول ده مسؤول بس عن "امتى تنتهي كل مجموعة نقاط اتكسبت"، مش عن الرصيد نفسه. كل حركة
-- موجبة (اكتساب/مكافأة/تعديل يدوي موجب/استرجاع استخدام) بتنشئ دفعة جديدة هنا؛ كل حركة سالبة
-- (استخدام/تعديل يدوي سالب/إلغاء اكتساب) بتستهلك من الدفعات الأقدم أولاً (FIFO)، فمفيش نقاط
-- اتصرفت فعلاً تقدر "تنتهي" لاحقاً — القيمة المتبقية بترجع صفر بمجرد ما تتصرف.
CREATE TABLE IF NOT EXISTS loyalty_point_lots (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_ledger_id INTEGER NOT NULL REFERENCES loyalty_ledger(id) ON DELETE CASCADE,
  original_points INTEGER NOT NULL CHECK (original_points > 0),
  remaining_points INTEGER NOT NULL CHECK (remaining_points >= 0),
  earned_at TIMESTAMPTZ NOT NULL,
  -- NULL = الدفعة دي ما بتنتهيش (انتهاء الصلاحية كان معطّل وقت الاكتساب، أو تعديل إداري
  -- "لا تنتهي" صريح، أو دفعة قديمة قبل هذه الميزة أصلاً — راجع تعبئة البيانات تحت).
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT loyalty_point_lots_remaining_le_original CHECK (remaining_points <= original_points)
);
CREATE INDEX IF NOT EXISTS idx_loyalty_point_lots_user ON loyalty_point_lots(user_id, earned_at);
CREATE INDEX IF NOT EXISTS idx_loyalty_point_lots_expiry ON loyalty_point_lots(expires_at) WHERE remaining_points > 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_point_lots_source_ledger ON loyalty_point_lots(source_ledger_id);

-- ---------- الإحالة: حالة "مؤهّل" + تفاصيل طلب التأهيل + مكافأة العميل الجديد ----------
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_status_check;
ALTER TABLE referrals ADD CONSTRAINT referrals_status_check CHECK (status IN ('pending', 'qualified', 'rewarded'));
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS qualifying_order_id TEXT REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS qualifying_order_value NUMERIC(12,2);
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referrer_reward_points INTEGER;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referred_reward_points INTEGER;

-- ---------- تعبئة تاريخية (backfill) للدفعات من سجل الولاء الموجود فعلاً ----------
-- قاعدة بيانات الإنتاج ممكن يكون فيها حركات ولاء حقيقية بالفعل (اكتساب/مكافأة إحالة/تعديل
-- يدوي) — من غير الخطوة دي، مفيش أي دفعة (lot) هتمثّلها، فالمعالج المستقبلي لانتهاء الصلاحية
-- (loyalty:expire) مش هيلاقي حاجة يشتغل عليها للعملاء القدامى، ونظام FIFO هيبدأ فاضي بدل ما
-- يعكس التاريخ الفعلي. الحركات دي بتتعاد تشغيلها هنا بترتيب زمني لكل عميل: كل حركة موجبة
-- بتنشئ دفعة جديدة (expires_at = NULL دايماً هنا — مفيش سياسة انتهاء كانت مطبّقة عليها وقت
-- اكتسابها فعلياً، فأعدل وأأمن قرار إنها ما تنتهيش أبداً بأثر رجعي بسبب ميزة جديدة)، وكل حركة
-- سالبة (التعديل اليدوي السالب هو الوحيد الموجود فعلياً في الإنتاج قبل هذا الترحيل) بتستهلك
-- من الدفعات الأقدم أولاً. الخطوة دي بتتنفذ مرة واحدة بس (جدول schema_migrations بيمنع
-- إعادة تشغيل نفس الملف)، وجوه نفس معاملة الترحيل الواحدة (تراجع كامل تلقائي لو أي حاجة فشلت).
DO $$
DECLARE
  ledger_row RECORD;
  remaining_to_consume INTEGER;
  lot_row RECORD;
  consume_amount INTEGER;
BEGIN
  FOR ledger_row IN
    SELECT id, user_id, points_change, created_at
    FROM loyalty_ledger
    ORDER BY user_id, created_at, id
  LOOP
    IF ledger_row.points_change > 0 THEN
      INSERT INTO loyalty_point_lots (user_id, source_ledger_id, original_points, remaining_points, earned_at, expires_at)
      VALUES (ledger_row.user_id, ledger_row.id, ledger_row.points_change, ledger_row.points_change, ledger_row.created_at, NULL);
    ELSIF ledger_row.points_change < 0 THEN
      remaining_to_consume := -ledger_row.points_change;
      FOR lot_row IN
        SELECT id, remaining_points FROM loyalty_point_lots
        WHERE user_id = ledger_row.user_id AND remaining_points > 0
        ORDER BY earned_at, id
      LOOP
        EXIT WHEN remaining_to_consume <= 0;
        consume_amount := LEAST(remaining_to_consume, lot_row.remaining_points);
        UPDATE loyalty_point_lots SET remaining_points = remaining_points - consume_amount WHERE id = lot_row.id;
        remaining_to_consume := remaining_to_consume - consume_amount;
      END LOOP;
      -- لو حركة سالبة تاريخية كانت أكبر من كل رصيد الدفعات وقتها (حالة نادرة جداً، ممكن لو
      -- تعديل يدوي سالب اتسجل بعد نقاش تشغيلي تعديلي)، الفائض بيتجاهل بصمت هنا — الهدف
      -- إعادة بناء توزيع تقريبي متوافق مع الرصيد الحالي، مش إعادة التحقق من كل قرار تاريخي.
    END IF;
  END LOOP;
END $$;
