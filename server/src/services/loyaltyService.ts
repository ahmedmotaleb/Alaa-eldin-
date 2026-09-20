import type { PoolClient } from 'pg'
import { pool, withTransaction } from '../db.js'
import { toPiastres, toEgp } from './pricingService.js'

export type LoyaltySourceType =
  | 'order_delivered' | 'referral_bonus' | 'manual_adjustment'
  | 'redeemed' | 'redemption_reversal' | 'earned_reversal' | 'expired'

export interface LoyaltyLedgerEntry {
  id: number
  pointsChange: number
  sourceType: LoyaltySourceType
  sourceOrderId: string | null
  note: string
  createdAt: string
}

const SELECT_LEDGER = `
  SELECT id, points_change as "pointsChange", source_type as "sourceType",
         source_order_id as "sourceOrderId", note, created_at as "createdAt"
  FROM loyalty_ledger
`

export async function getLoyaltyBalance(userId: string): Promise<number> {
  const { rows } = await pool.query<{ balance: string | null }>(
    'SELECT SUM(points_change)::int as balance FROM loyalty_ledger WHERE user_id = $1',
    [userId]
  )
  return Number(rows[0]?.balance ?? 0)
}

export async function listLoyaltyLedger(userId: string, page = 1, limit = 20): Promise<{ entries: LoyaltyLedgerEntry[], total: number }> {
  const offset = (page - 1) * limit
  const [{ rows: entries }, { rows: countRows }] = await Promise.all([
    pool.query<LoyaltyLedgerEntry>(
      `${SELECT_LEDGER} WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ),
    pool.query<{ n: string }>('SELECT COUNT(*) as n FROM loyalty_ledger WHERE user_id = $1', [userId])
  ])
  return { entries, total: Number(countRows[0]?.n ?? 0) }
}

export type LoyaltyExpiryPolicy = 'default' | 'never'

// تعديل يدوي من الإدارة (زيادة أو خصم نقاط) — نفس مبدأ product_cost_history: سجل جديد
// دايماً، مفيش أي تعديل أو حذف لسجل قديم. تعديل موجب بينشئ دفعة (lot) جديدة زي أي اكتساب
// تاني — expiryPolicy='never' بيمنع انتهاءها بغض النظر عن إعدادات المتجر العامة (مفيد
// لنقاط تعويضية لا يصح انتهاؤها بصمت).
export async function adjustLoyaltyPointsManually(
  userId: string, pointsChange: number, note: string, adminUserId: string, expiryPolicy: LoyaltyExpiryPolicy = 'default'
): Promise<void> {
  await withTransaction(async client => {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO loyalty_ledger (user_id, points_change, source_type, note, created_by_admin_id)
       VALUES ($1, $2, 'manual_adjustment', $3, $4) RETURNING id`,
      [userId, pointsChange, note, adminUserId]
    )
    if (pointsChange > 0) {
      await createLoyaltyLot(client, userId, rows[0].id, pointsChange, expiryPolicy === 'never')
    } else if (pointsChange < 0) {
      await consumeLoyaltyPointsFifo(client, userId, -pointsChange)
    }
  })
}

export interface LoyaltySettings {
  loyaltyEnabled: boolean
  loyaltyPointsPerEgp: number
  loyaltyPointValueEgp: number
  loyaltyMinRedeemPoints: number
  loyaltyMaxRedemptionPercent: number
  loyaltyMinOrderForRedemption: number
  loyaltyExpiryEnabled: boolean
  loyaltyExpiryDays: number
  loyaltyExpiryWarningDays: number
  referralEnabled: boolean
  referralBonusPoints: number
  referralReferredBonusPoints: number
  referralMinQualifyingOrder: number
}

export async function getLoyaltySettings(client: PoolClient | typeof pool = pool): Promise<LoyaltySettings> {
  const { rows } = await client.query<{
    loyaltyEnabled: number, loyaltyPointsPerEgp: number, loyaltyPointValueEgp: number,
    loyaltyMinRedeemPoints: number, loyaltyMaxRedemptionPercent: number, loyaltyMinOrderForRedemption: number,
    loyaltyExpiryEnabled: number, loyaltyExpiryDays: number, loyaltyExpiryWarningDays: number,
    referralEnabled: number, referralBonusPoints: number, referralReferredBonusPoints: number, referralMinQualifyingOrder: number
  }>(`
    SELECT loyalty_enabled as "loyaltyEnabled", loyalty_points_per_egp as "loyaltyPointsPerEgp",
           loyalty_point_value_egp as "loyaltyPointValueEgp", loyalty_min_redeem_points as "loyaltyMinRedeemPoints",
           loyalty_max_redemption_percent as "loyaltyMaxRedemptionPercent",
           loyalty_min_order_for_redemption as "loyaltyMinOrderForRedemption",
           loyalty_expiry_enabled as "loyaltyExpiryEnabled", loyalty_expiry_days as "loyaltyExpiryDays",
           loyalty_expiry_warning_days as "loyaltyExpiryWarningDays",
           referral_enabled as "referralEnabled", referral_bonus_points as "referralBonusPoints",
           referral_referred_bonus_points as "referralReferredBonusPoints",
           referral_min_qualifying_order as "referralMinQualifyingOrder"
    FROM store_settings WHERE id = 1
  `)
  const row = rows[0]
  return {
    loyaltyEnabled: !!row?.loyaltyEnabled,
    loyaltyPointsPerEgp: Number(row?.loyaltyPointsPerEgp ?? 0),
    loyaltyPointValueEgp: Number(row?.loyaltyPointValueEgp ?? 0),
    loyaltyMinRedeemPoints: Number(row?.loyaltyMinRedeemPoints ?? 0),
    loyaltyMaxRedemptionPercent: Number(row?.loyaltyMaxRedemptionPercent ?? 0),
    loyaltyMinOrderForRedemption: Number(row?.loyaltyMinOrderForRedemption ?? 0),
    loyaltyExpiryEnabled: !!row?.loyaltyExpiryEnabled,
    loyaltyExpiryDays: Number(row?.loyaltyExpiryDays ?? 0),
    loyaltyExpiryWarningDays: Number(row?.loyaltyExpiryWarningDays ?? 0),
    referralEnabled: !!row?.referralEnabled,
    referralBonusPoints: Number(row?.referralBonusPoints ?? 0),
    referralReferredBonusPoints: Number(row?.referralReferredBonusPoints ?? 0),
    referralMinQualifyingOrder: Number(row?.referralMinQualifyingOrder ?? 0)
  }
}

// كل حركة موجبة في السجل بتنشئ "دفعة" (lot) هنا فوراً — الدفعة دي بس اللي بتحدد امتى النقاط
// دي تنتهي (لو انتهاء الصلاحية مفعّل وقت الاكتساب)، الرصيد الظاهر للعميل يفضل دايماً
// SUM(points_change) من السجل نفسه.
export async function createLoyaltyLot(client: PoolClient, userId: string, sourceLedgerId: number, points: number, neverExpires = false): Promise<void> {
  if (points <= 0) return
  let expiresAt: string | null = null
  if (!neverExpires) {
    const settings = await getLoyaltySettings(client)
    if (settings.loyaltyExpiryEnabled && settings.loyaltyExpiryDays > 0) {
      expiresAt = new Date(Date.now() + settings.loyaltyExpiryDays * 86400000).toISOString()
    }
  }
  await client.query(
    `INSERT INTO loyalty_point_lots (user_id, source_ledger_id, original_points, remaining_points, earned_at, expires_at)
     VALUES ($1, $2, $3, $3, now(), $4)`,
    [userId, sourceLedgerId, points, expiresAt]
  )
}

// بتقفل كل دفعات المستخدم اللي لسه فيها رصيد (FOR UPDATE) وترجع مجموعها — القفل ده هو خط
// الدفاع الحقيقي ضد "الصرف المزدوج" وقت تنافس طلبين في نفس اللحظة على نفس الرصيد (راجع
// checkoutValidation/orderService: القفل ده لازم يحصل جوه نفس معاملة إنشاء الطلب قبل أي
// قرار استخدام نقاط). المكالمة التانية المتزامنة هتستنى على القفل ده لحد ما الأولى تخلص
// commit/rollback، وبعدين هتقرأ الرصيد المحدّث فعلياً - مش نسخة قديمة من الذاكرة.
export async function lockLoyaltyLotsAndGetBalance(client: PoolClient, userId: string): Promise<{ balance: number, lockedLotIds: number[] }> {
  const { rows } = await client.query<{ id: number, remainingPoints: number }>(
    `SELECT id, remaining_points as "remainingPoints" FROM loyalty_point_lots
     WHERE user_id = $1 AND remaining_points > 0 ORDER BY earned_at, id FOR UPDATE`,
    [userId]
  )
  const balance = rows.reduce((sum, r) => sum + r.remainingPoints, 0)
  return { balance, lockedLotIds: rows.map(r => r.id) }
}

// استهلاك FIFO فعلي: أقدم دفعة أولاً. بيفترض إن الرصيد كافٍ فعلاً (المُنادي لازم يتحقق من
// الرصيد الكافي قبل ما ينادي الدالة دي) وإن الصفوف متقفلة بالفعل جوه نفس المعاملة
// (lockLoyaltyLotsAndGetBalance اتنادت قبل كده).
export async function consumeLoyaltyPointsFifo(client: PoolClient, userId: string, amount: number): Promise<void> {
  if (amount <= 0) return
  let remainingToConsume = amount
  const { rows: lots } = await client.query<{ id: number, remainingPoints: number }>(
    `SELECT id, remaining_points as "remainingPoints" FROM loyalty_point_lots
     WHERE user_id = $1 AND remaining_points > 0 ORDER BY earned_at, id FOR UPDATE`,
    [userId]
  )
  for (const lot of lots) {
    if (remainingToConsume <= 0) break
    const consume = Math.min(remainingToConsume, lot.remainingPoints)
    await client.query('UPDATE loyalty_point_lots SET remaining_points = remaining_points - $1 WHERE id = $2', [consume, lot.id])
    remainingToConsume -= consume
  }
  // لو الرصيد مش كافي فعلاً (خطأ برمجي في المُنادي، مش سيناريو طبيعي) بنسيب remainingToConsume
  // موجب من غير ما نطلع استثناء هنا — التحقق من كفاية الرصيد مسؤولية calculateLoyaltyRedemption
  // قبل الوصول للدالة دي أصلاً، فوصولها هنا برصيد غير كافي معناه خطأ في تسلسل الاستدعاء نفسه.
}

export interface LoyaltyRedemptionInput {
  requestedPoints: number
  balance: number
  eligibleSubtotal: number
  settings: LoyaltySettings
}

export type LoyaltyRedemptionResult =
  | { ok: true, pointsToRedeem: number, discountAmount: number }
  | { ok: false, error: 'invalid_points' | 'loyalty_disabled' | 'below_minimum_redeem_points' | 'order_below_minimum_for_redemption' | 'loyalty_balance_changed' | 'redemption_exceeds_limit', details?: Record<string, unknown> }

// دالة صرفة بالكامل (بدون قاعدة بيانات) — قابلة للاختبار المباشر. لازم يتحقق منها هنا فقط،
// أي قيمة جايه من العميل (رصيد، قيمة النقطة، نسبة الحد الأقصى) بيتم تجاهلها تماماً؛ الرصيد
// والإعدادات دايماً بييجوا من قاعدة البيانات (راجع lockLoyaltyLotsAndGetBalance/getLoyaltySettings).
export function calculateLoyaltyRedemption(input: LoyaltyRedemptionInput): LoyaltyRedemptionResult {
  const { requestedPoints, balance, eligibleSubtotal, settings } = input

  if (!Number.isInteger(requestedPoints) || requestedPoints < 0 || !Number.isFinite(requestedPoints)) {
    return { ok: false, error: 'invalid_points' }
  }
  if (requestedPoints === 0) return { ok: true, pointsToRedeem: 0, discountAmount: 0 }
  if (!settings.loyaltyEnabled) return { ok: false, error: 'loyalty_disabled' }
  if (requestedPoints < settings.loyaltyMinRedeemPoints) {
    return { ok: false, error: 'below_minimum_redeem_points', details: { minimum: settings.loyaltyMinRedeemPoints } }
  }
  if (settings.loyaltyMinOrderForRedemption > 0 && eligibleSubtotal < settings.loyaltyMinOrderForRedemption) {
    return { ok: false, error: 'order_below_minimum_for_redemption', details: { minimumOrder: settings.loyaltyMinOrderForRedemption } }
  }
  if (requestedPoints > balance) {
    return { ok: false, error: 'loyalty_balance_changed', details: { balance } }
  }

  // كل الحساب هنا بالقرش الصحيح (piastres) عشان نتجنب أخطاء تقريب float المتراكمة، بنفس
  // مبدأ pricingService.ts — بس قيمة النقطة نفسها ممكن تكون كسر قرش (مثلاً 0.0333 جنيه)
  // فبنسيبها كما هي (من غير تقريب مبكر) في القسمة عشان الحد الأقصى بالنقاط يطلع دقيق.
  const pointValuePiastresExact = settings.loyaltyPointValueEgp * 100
  const maxDiscountPiastres = Math.floor(toPiastres(eligibleSubtotal) * settings.loyaltyMaxRedemptionPercent / 100)
  const maxPointsByPercent = pointValuePiastresExact > 0 ? Math.floor(maxDiscountPiastres / pointValuePiastresExact) : 0
  const maxAllowedPoints = Math.min(balance, maxPointsByPercent)

  if (requestedPoints > maxAllowedPoints) {
    return { ok: false, error: 'redemption_exceeds_limit', details: { maxAllowedPoints } }
  }

  const discountAmount = toEgp(Math.round(requestedPoints * pointValuePiastresExact))
  return { ok: true, pointsToRedeem: requestedPoints, discountAmount }
}

// المرحلة الأولى من الاستخدام جوه معاملة إنشاء الطلب: قفل الدفعات + التحقق قبل ما الطلب
// نفسه يتعمل (راجع orderService.createOrder). لازم تتنادى قبل إدراج صف الطلب، عشان لو
// الاستخدام مرفوض الطلب كله يترفض من غير أي أثر جانبي.
export async function lockAndValidateLoyaltyRedemption(
  client: PoolClient, userId: string | null, requestedPoints: number, eligibleSubtotal: number
): Promise<LoyaltyRedemptionResult> {
  if (requestedPoints === 0) return { ok: true, pointsToRedeem: 0, discountAmount: 0 }
  if (!userId) return { ok: false, error: 'loyalty_disabled' } // زائر بدون حساب — لا يوجد رصيد يُستخدم أصلاً.

  const settings = await getLoyaltySettings(client)
  const { balance } = await lockLoyaltyLotsAndGetBalance(client, userId)
  return calculateLoyaltyRedemption({ requestedPoints, balance, eligibleSubtotal, settings })
}

// المرحلة الثانية: بعد ما الطلب اتعمل فعلاً وأخد id حقيقي — بتسجّل حركة الاستخدام السالبة
// في السجل وتستهلك الدفعات المقفولة بالفعل من المرحلة الأولى. الفهرس الفريد الجزئي على
// (source_order_id) WHERE source_type='redeemed' بيمنع أي محاولة تسجيل حركة استخدام تانية
// لنفس الطلب (رغم إن استدعاء الدالة دي مرتين لنفس الطلب مش متوقع أصلاً في التدفق الطبيعي).
export async function commitLoyaltyRedemption(client: PoolClient, userId: string, orderId: string, pointsToRedeem: number): Promise<void> {
  if (pointsToRedeem <= 0) return
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO loyalty_ledger (user_id, points_change, source_type, source_order_id, note)
     VALUES ($1, $2, 'redeemed', $3, $4) RETURNING id`,
    [userId, -pointsToRedeem, orderId, `استخدام نقاط في الطلب رقم ${orderId}`]
  )
  if (!rows[0]) return
  await consumeLoyaltyPointsFifo(client, userId, pointsToRedeem)
}

// إلغاء طلب استخدم نقاط قبل التسليم — بيرجّع النقاط كدفعة جديدة (تاريخ اكتساب = الآن، بنفس
// سياسة الانتهاء الحالية) بدل محاولة إحياء الدفعة الأصلية اللي استُهلكت وقتها، وده أبسط
// وأنصف للعميل (مايحصلش على دفعة أقرب لتاريخ انتهاء قديم بسبب إلغاء مش غلطته). Idempotent
// عن طريق الفهرس الفريد الجزئي على redemption_reversal لكل طلب — تكرار استدعاء الدالة على
// نفس الطلب هيلاقي صف موجود بالفعل ومش هيضيف تاني.
export async function restoreRedeemedPointsForOrder(client: PoolClient, orderId: string): Promise<void> {
  const { rows: redeemedRows } = await client.query<{ userId: string, points: number }>(
    `SELECT user_id as "userId", -points_change as points FROM loyalty_ledger WHERE source_order_id = $1 AND source_type = 'redeemed'`,
    [orderId]
  )
  const redeemed = redeemedRows[0]
  if (!redeemed || redeemed.points <= 0) return

  const { rows: existingReversal } = await client.query(
    `SELECT 1 FROM loyalty_ledger WHERE source_order_id = $1 AND source_type = 'redemption_reversal'`,
    [orderId]
  )
  if (existingReversal[0]) return

  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO loyalty_ledger (user_id, points_change, source_type, source_order_id, note)
     VALUES ($1, $2, 'redemption_reversal', $3, $4) RETURNING id`,
    [redeemed.userId, redeemed.points, orderId, `استرجاع نقاط بعد إلغاء الطلب رقم ${orderId}`]
  )
  await createLoyaltyLot(client, redeemed.userId, rows[0].id, redeemed.points)
}

// إلغاء اكتساب النقاط لطلب اتحسبله نقاط قبل كده (لو حصل فعلاً — حالياً غير قابلة للوصول
// عملياً عبر إلغاء الأدمن العادي، لأن الطلب "المُسلَّم" حالة نهائية ما بترجعش لـ "ملغى" في
// آلة الحالات الحالية؛ المسار الحقيقي اللي بيوصلها فعلياً هو مرتجع/استرداد كامل بعد التسليم
// — راجع customerReturnService.ts). بتستهلك FIFO من الرصيد الحالي (مش لازم تكون نفس الدفعة
// الأصلية بالظبط) — لو العميل صرف النقاط دي فعلاً في حاجة تانية، الاستهلاك هياخد من أي رصيد
// متاح دلوقتي، وده السلوك الصحيح لأي دفتر حسابات عام.
export async function reverseEarnedPointsForOrder(client: PoolClient, orderId: string): Promise<void> {
  const { rows: earnedRows } = await client.query<{ userId: string, points: number }>(
    `SELECT user_id as "userId", points_change as points FROM loyalty_ledger WHERE source_order_id = $1 AND source_type = 'order_delivered'`,
    [orderId]
  )
  const earned = earnedRows[0]
  if (!earned || earned.points <= 0) return

  const { rows: existingReversal } = await client.query(
    `SELECT 1 FROM loyalty_ledger WHERE source_order_id = $1 AND source_type = 'earned_reversal'`,
    [orderId]
  )
  if (existingReversal[0]) return

  await client.query(
    `INSERT INTO loyalty_ledger (user_id, points_change, source_type, source_order_id, note)
     VALUES ($1, $2, 'earned_reversal', $3, $4)`,
    [earned.userId, -earned.points, orderId, `إلغاء نقاط مكتسبة بعد إرجاع/إلغاء الطلب رقم ${orderId}`]
  )
  await lockLoyaltyLotsAndGetBalance(client, earned.userId) // قفل قبل الاستهلاك (نفس نمط الاستخدام العادي)
  await consumeLoyaltyPointsFifo(client, earned.userId, earned.points)
}

export interface UpcomingExpiryEntry {
  points: number
  expiresAt: string
}

// بترجّع الدفعات اللي هتنتهي جوه نافذة التحذير المُعدّة بس (لو انتهاء الصلاحية مفعّل أصلاً)
// — مُجمّعة حسب تاريخ الانتهاء عشان صفحة المكافآت تقدر تعرض "X نقطة تنتهي في تاريخ كذا".
export async function listUpcomingLoyaltyExpiry(userId: string): Promise<UpcomingExpiryEntry[]> {
  const settings = await getLoyaltySettings()
  if (!settings.loyaltyExpiryEnabled) return []
  const warningWindowEnd = new Date(Date.now() + settings.loyaltyExpiryWarningDays * 86400000).toISOString()
  const { rows } = await pool.query<{ points: string, expiresAt: string }>(
    `SELECT SUM(remaining_points) as points, expires_at as "expiresAt" FROM loyalty_point_lots
     WHERE user_id = $1 AND remaining_points > 0 AND expires_at IS NOT NULL AND expires_at <= $2
     GROUP BY expires_at ORDER BY expires_at`,
    [userId, warningWindowEnd]
  )
  return rows.map(r => ({ points: Number(r.points), expiresAt: r.expiresAt }))
}

// معالج انتهاء الصلاحية — بيتنادى بس من سكريبت مستقل (loyaltyExpire.ts)، مش من أي طلب HTTP.
// دفعات محدودة (LIMIT) + SKIP LOCKED عشان لو اتشغّل مرتين متزامنتين بالغلط (أو أعيد تشغيله
// وسط تنفيذ سابق) كل نسخة تاخد صفوف مختلفة بدل ما تستنى على بعض أو تكرر نفس العملية.
export async function runLoyaltyExpiryBatch(batchSize = 200): Promise<number> {
  const settings = await getLoyaltySettings()
  if (!settings.loyaltyExpiryEnabled) return 0

  return withTransaction(async client => {
    const { rows: expiredLots } = await client.query<{ id: number, userId: string, remainingPoints: number }>(
      `SELECT id, user_id as "userId", remaining_points as "remainingPoints" FROM loyalty_point_lots
       WHERE remaining_points > 0 AND expires_at IS NOT NULL AND expires_at <= now()
       ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [batchSize]
    )
    for (const lot of expiredLots) {
      await client.query(
        `INSERT INTO loyalty_ledger (user_id, points_change, source_type, note) VALUES ($1, $2, 'expired', $3)`,
        [lot.userId, -lot.remainingPoints, 'انتهاء صلاحية نقاط']
      )
      await client.query('UPDATE loyalty_point_lots SET remaining_points = 0 WHERE id = $1', [lot.id])
    }
    return expiredLots.length
  })
}

// بتنادى بعد ما referrals.status يتحدّث لـ 'qualified'/'rewarded' — منفصلة عشان تُستخدم من
// هنا (أول توصيل فعلي) ومن أي مسار تاني لاحقاً بدون تكرار منطق المكافأة نفسه.
async function grantReferralRewards(
  client: PoolClient, referralId: number, referrerUserId: string, referredUserId: string, settings: LoyaltySettings
): Promise<{ referrerPoints: number, referredPoints: number }> {
  let referrerPoints = 0
  let referredPoints = 0
  if (settings.referralBonusPoints > 0) {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO loyalty_ledger (user_id, points_change, source_type, note) VALUES ($1, $2, 'referral_bonus', $3) RETURNING id`,
      [referrerUserId, settings.referralBonusPoints, 'مكافأة إحالة صديق لأول طلب فعلي']
    )
    await createLoyaltyLot(client, referrerUserId, rows[0].id, settings.referralBonusPoints)
    referrerPoints = settings.referralBonusPoints
  }
  if (settings.referralReferredBonusPoints > 0) {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO loyalty_ledger (user_id, points_change, source_type, note) VALUES ($1, $2, 'referral_bonus', $3) RETURNING id`,
      [referredUserId, settings.referralReferredBonusPoints, 'مكافأة عميل جديد عبر إحالة صديق']
    )
    await createLoyaltyLot(client, referredUserId, rows[0].id, settings.referralReferredBonusPoints)
    referredPoints = settings.referralReferredBonusPoints
  }
  return { referrerPoints, referredPoints }
}

// أول طلب "delivered" فعلي للمُحال بس هو اللي بيحدد التأهّل — بمجرد ما referrals.status
// يتغيّر من 'pending' مفيش أي طلب لاحق هيلاقي صف pending تاني لنفس المُحال، يعني القرار
// (تأهّل/مكافأة) بيحصل مرة واحدة مضمونة. لو الطلب الأول ما استوفاش الحد الأدنى المطلوب،
// الحالة بتفضل 'pending' عشان طلب لاحق أكبر يقدر "يتأهّل" بدلاً منه.
async function maybeQualifyReferralForFirstDelivery(client: PoolClient, referredUserId: string, orderId: string): Promise<void> {
  const { rows } = await client.query<{ id: number, referrerUserId: string }>(
    `SELECT id, referrer_user_id as "referrerUserId" FROM referrals WHERE referred_user_id = $1 AND status = 'pending' FOR UPDATE`,
    [referredUserId]
  )
  const referral = rows[0]
  if (!referral) return

  const { rows: orderRows } = await client.query<{ total: number }>('SELECT total FROM orders WHERE id = $1', [orderId])
  const orderTotal = Number(orderRows[0]?.total ?? 0)

  const settings = await getLoyaltySettings(client)
  if (orderTotal < settings.referralMinQualifyingOrder) return // لسه ما استوفاش الحد الأدنى — يفضل pending لطلب لاحق.

  if (!settings.referralEnabled) {
    await client.query(
      `UPDATE referrals SET status = 'qualified', qualifying_order_id = $1, qualifying_order_value = $2 WHERE id = $3`,
      [orderId, orderTotal, referral.id]
    )
    return
  }

  const { referrerPoints, referredPoints } = await grantReferralRewards(client, referral.id, referral.referrerUserId, referredUserId, settings)
  await client.query(
    `UPDATE referrals SET status = 'rewarded', rewarded_at = now(), qualifying_order_id = $1, qualifying_order_value = $2,
       referrer_reward_points = $3, referred_reward_points = $4 WHERE id = $5`,
    [orderId, orderTotal, referrerPoints || null, referredPoints || null, referral.id]
  )
}

// بتتنفّذ جوه نفس معاملة تحديث حالة الطلب لـ 'delivered' (نفس نمط recordOrderStatusChange) —
// عميل زائر بدون حساب (user_id = NULL) ما بيكسبش نقاط أصلاً، لأن مفيش حساب دائم يتحسب عليه
// الرصيد أو يتم استرجاعه بيه لاحقاً. الأساس المؤهّل للاكتساب هو (الإجمالي - رسوم التوصيل)
// — وبما إن "الإجمالي" دلوقتي بيعكس خصم العرض وخصم الولاء الاتنين (راجع pricingService.
// computeTotal)، القيمة دي أوتوماتيكياً هي المطلوبة بالظبط: بعد الخصمين، قبل رسوم التوصيل،
// من غير أي تعديل إضافي على الصيغة نفسها.
export async function grantPointsForDeliveredOrder(client: PoolClient, orderId: string): Promise<void> {
  const { rows } = await client.query<{ userId: string | null, total: number, deliveryFee: number }>(
    'SELECT user_id as "userId", total, delivery_fee as "deliveryFee" FROM orders WHERE id = $1',
    [orderId]
  )
  const order = rows[0]
  if (!order || !order.userId) return

  const eligibleAmount = Math.max(0, Number(order.total) - Number(order.deliveryFee))
  const rate = (await getLoyaltySettings(client)).loyaltyPointsPerEgp
  const points = Math.floor(eligibleAmount * rate)
  if (points <= 0) return

  const result = await client.query<{ id: number }>(
    `INSERT INTO loyalty_ledger (user_id, points_change, source_type, source_order_id, note)
     VALUES ($1, $2, 'order_delivered', $3, $4)
     ON CONFLICT (source_order_id) WHERE source_type = 'order_delivered' DO NOTHING
     RETURNING id`,
    [order.userId, points, orderId, `نقاط طلب رقم ${orderId}`]
  )
  // مفيش صف جديد اتضاف يبقى الطلب ده سبق منح نقاط عليه (استدعاء مكرر) — منع الازدواجية.
  if (!result.rows[0]) return

  await createLoyaltyLot(client, order.userId, result.rows[0].id, points)
  await maybeQualifyReferralForFirstDelivery(client, order.userId, orderId)
}
