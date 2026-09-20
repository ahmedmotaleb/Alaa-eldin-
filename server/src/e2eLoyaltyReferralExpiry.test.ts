// سيناريوهات end-to-end متكاملة (وليست اختبارات وحدة منعزلة) — كل سيناريو بيمر بنفس الخطوات
// المطلوبة في القسمين 44-46 من مواصفة دفعة الولاء/الإحالة: دورة ولاء كاملة (اكتساب -> استخدام
// -> إلغاء واسترجاع)، دورة إحالة كاملة (تسجيل -> تأهّل -> مكافأة مرة واحدة)، ودورة انتهاء
// صلاحية كاملة (دفعات متعددة -> استهلاك جزئي -> انتهاء -> عدم تكرار). بيستخدم نفس الدوال
// الحقيقية (createOrder/cancelOrder/loyaltyService/referralService) بدون أي محاكاة.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool, withTransaction } from './db.js'
import { createOrder, cancelOrder } from './services/orderService.js'
import { recordOrderStatusChange } from './services/orderStatusHistoryService.js'
import {
  getLoyaltyBalance, listLoyaltyLedger, adjustLoyaltyPointsManually,
  runLoyaltyExpiryBatch, listUpcomingLoyaltyExpiry
} from './services/loyaltyService.js'
import {
  getOrCreateReferralCode, recordReferralSignup, getReferralStats,
  listReferralsForAdmin, getReferralDetailForAdmin
} from './services/referralService.js'
import { todayInCairo } from './cairoDate.js'
import type { CheckoutInput } from './checkoutValidation.js'

const CATEGORY_ID = 'e2e-cat'
const PRODUCT_ID = 'e2e-prod'
const PRODUCT_PRICE = 50
const CUSTOMER_A = 'e2e-customer-a'
const CUSTOMER_B = 'e2e-customer-b'
const ADMIN_ID = 'e2e-admin'

async function resetFixtures() {
  await pool.query('DELETE FROM stock_movements')
  await pool.query('DELETE FROM order_items')
  await pool.query('DELETE FROM orders')
  await pool.query('DELETE FROM loyalty_ledger')
  await pool.query('DELETE FROM referrals')
  await pool.query('DELETE FROM referral_codes')
  await pool.query('DELETE FROM products')
  await pool.query('DELETE FROM categories')
  await pool.query('DELETE FROM store_settings')
  await pool.query('DELETE FROM users WHERE id IN ($1, $2, $3)', [CUSTOMER_A, CUSTOMER_B, ADMIN_ID])

  for (const id of [CUSTOMER_A, CUSTOMER_B, ADMIN_ID]) {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, $1 || '@test.local', 'x', 'عميل e2e', now())`,
      [id]
    )
  }
  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة e2e', '🧪', '#fff', 1)`, [CATEGORY_ID])
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'e2e-product', $2, 'منتج e2e', 'وصف', $3, 20, 'وحدة', '🧪', 1, 1000, now())`,
    [PRODUCT_ID, CATEGORY_ID, PRODUCT_PRICE]
  )
  await pool.query(
    `INSERT INTO store_settings (
       id, name, whatsapp_number, currency, minimum_order, free_shipping_threshold, delivery_fee,
       loyalty_points_per_egp, referral_bonus_points,
       loyalty_enabled, loyalty_point_value_egp, loyalty_min_redeem_points, loyalty_max_redemption_percent,
       loyalty_min_order_for_redemption, loyalty_expiry_enabled, loyalty_expiry_days, loyalty_expiry_warning_days,
       referral_enabled, referral_referred_bonus_points, referral_min_qualifying_order
     ) VALUES (
       1, 'متجر e2e', '01000000000', 'ج.م', 0, 100000, 20,
       0.1, 50,
       1, 0.05, 1, 100,
       0, 0, 365, 30,
       1, 0, 0
     )`
  )
  await pool.query(`UPDATE delivery_zones SET delivery_fee = 20, is_active = 1 WHERE governorate = 'القاهرة'`)
  await pool.query(`UPDATE delivery_slots SET is_active = 1, max_orders_per_day = NULL WHERE id = 'now'`)
  await pool.query('DELETE FROM delivery_date_overrides')
  await pool.query('DELETE FROM delivery_slot_date_capacity')
}

let keyCounter = 0
function nextKey() {
  keyCounter += 1
  return `e2e-key-${keyCounter}-${Date.now()}`
}

function checkoutInput(overrides: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    deliverySlot: 'now',
    deliveryDate: todayInCairo(),
    paymentMethod: 'COD',
    customer: { fullName: 'عميل e2e', mobile: '01012345678', governorate: 'القاهرة', address: 'شارع 1' },
    items: [{ productId: PRODUCT_ID, quantity: 6 }], // 6×50 = 300
    substitutionPreference: 'contact_me',
    ...overrides
  }
}

async function deliver(orderId: string) {
  await withTransaction(async client => {
    await client.query('UPDATE orders SET status = $1 WHERE id = $2', ['delivered', orderId])
    await recordOrderStatusChange(client, { orderId, fromStatus: 'placed', toStatus: 'delivered', source: 'system' })
  })
}

beforeEach(resetFixtures)

afterAll(async () => {
  await pool.end()
})

describe('E2E — full loyalty cycle', () => {
  it('order 1 earns points -> order 2 redeems them -> order 2 is cancelled and the redemption is restored (idempotently), leaving order 1 untouched', async () => {
    // 1) الطلب الأول يتسلّم فعلياً -> يكسب نقاط.
    const { order: order1 } = await createOrder(checkoutInput(), CUSTOMER_A, nextKey())
    await deliver(order1.id)
    // فرعي 300 - توصيل 0 (فوق حد الشحن المجاني 100000... لأ الفرعي 300 أقل من الحد، فالتوصيل
    // 20 فعلي) -> الإجمالي المؤهّل للاكتساب = total - deliveryFee = (300+20) - 20 = 300 -> نقاط = 30.
    expect(order1.deliveryFee).toBe(20)
    expect(await getLoyaltyBalance(CUSTOMER_A)).toBe(30)

    // نضيف رصيد يدوي كبير عشان نقدر نستخدم فعلياً في الطلب الثاني (30 نقطة بس مش كفاية لاختبار
    // ذو معنى) — هذا سيناريو واقعي (عميل جمع نقاط من طلبات سابقة كتير).
    await adjustLoyaltyPointsManually(CUSTOMER_A, 470, 'رصيد افتتاحي لسيناريو الاختبار', ADMIN_ID)
    expect(await getLoyaltyBalance(CUSTOMER_A)).toBe(500)

    // 2) الطلب الثاني يستخدم 300 نقطة (قيمتها 15 ج.م) عند الدفع.
    const { order: order2 } = await createOrder(checkoutInput({ loyaltyPointsRedeemed: 300 }), CUSTOMER_A, nextKey())
    expect(order2.loyaltyPointsRedeemed).toBe(300)
    expect(order2.loyaltyDiscountAmount).toBe(15)
    expect(order2.total).toBe(300 - 15 + 20) // فرعي - خصم النقاط + توصيل
    expect(await getLoyaltyBalance(CUSTOMER_A)).toBe(200) // 500 - 300

    // 3) حركة الاستخدام مسجّلة بوضوح في السجل (اللي هيظهر في صفحة المكافآت والفاتورة).
    const { entries: ledgerAfterRedeem } = await listLoyaltyLedger(CUSTOMER_A)
    expect(ledgerAfterRedeem[0]).toMatchObject({ pointsChange: -300, sourceType: 'redeemed', sourceOrderId: order2.id })

    // 4) إلغاء الطلب الثاني قبل التسليم -> استرجاع الـ300 نقطة.
    const cancelResult = await cancelOrder(order2.id)
    expect(cancelResult).toEqual({ ok: true })
    expect(await getLoyaltyBalance(CUSTOMER_A)).toBe(500) // رجعت زي ما كانت

    // 5) معالجة الإلغاء مرة تانية (idempotent) — مفيش أي إضافة مضاعفة.
    await cancelOrder(order2.id) // هيترفض (already cancelled) لكن لازم يفضل آمن
    expect(await getLoyaltyBalance(CUSTOMER_A)).toBe(500)

    // 6) اللقطة المحفوظة على الطلب الملغي نفسه ما بتتغيّرش أبداً (بيانات الفاتورة التاريخية).
    const { rows } = await pool.query('SELECT loyalty_points_redeemed as "pointsRedeemed", loyalty_discount_amount as "discountAmount" FROM orders WHERE id = $1', [order2.id])
    expect(rows[0]).toEqual({ pointsRedeemed: 300, discountAmount: 15 })

    // 7) "صفحة الطلب في الأدمن" بتعتمد على نفس سجل loyalty_ledger بـ source_order_id — نتأكد
    // إن فيه حركتين واضحتين لهذا الطلب (استخدام ثم استرجاع)، مش تعديل صف واحد بالغلط.
    const { rows: orderLedgerRows } = await pool.query(
      `SELECT source_type as "sourceType", points_change as "pointsChange" FROM loyalty_ledger WHERE source_order_id = $1 ORDER BY created_at ASC`,
      [order2.id]
    )
    expect(orderLedgerRows).toEqual([
      { sourceType: 'redeemed', pointsChange: -300 },
      { sourceType: 'redemption_reversal', pointsChange: 300 }
    ])

    // الطلب الأول (المُسلَّم فعلياً) لم يتأثر بأي من هذا على الإطلاق.
    const { rows: order1Rows } = await pool.query('SELECT status FROM orders WHERE id = $1', [order1.id])
    expect(order1Rows[0].status).toBe('delivered')
  })
})

describe('E2E — full referral cycle', () => {
  it('customer B registers with A\'s code, qualifies on first delivered order, and only A is rewarded once (no referred bonus configured)', async () => {
    // 1) عميل A ياخد كود الإحالة الخاص بيه.
    const code = await getOrCreateReferralCode(CUSTOMER_A)
    expect(code).toMatch(/^[0-9A-F]{8}$/)

    // 2) عميل B يسجّل باستخدام كود A.
    await recordReferralSignup(CUSTOMER_A, CUSTOMER_B, code)
    expect(await getReferralStats(CUSTOMER_A)).toEqual({ pending: 1, qualified: 0, rewarded: 0 })

    // 3) أول طلب فعلي مُسلَّم لعميل B -> يتأهّل ويكافئ A فوراً (لا مكافأة إحالة لمكافأة B نفسه
    //    لأن referral_referred_bonus_points = 0 في هذا السيناريو).
    const { order: bOrder1 } = await createOrder(checkoutInput(), CUSTOMER_B, nextKey())
    await deliver(bOrder1.id)

    expect(await getLoyaltyBalance(CUSTOMER_A)).toBe(50) // referral_bonus_points الافتراضي
    expect(await getReferralStats(CUSTOMER_A)).toEqual({ pending: 0, qualified: 0, rewarded: 1 })
    // نقاط اكتساب B العادية عن طلبه (300 * 0.1 = 30) لكن مفيش مكافأة إحالة إضافية له.
    expect(await getLoyaltyBalance(CUSTOMER_B)).toBe(30)

    // 4) ثاني طلب فعلي مُسلَّم لعميل B -> مفيش أي مكافأة إحالة تانية لـ A (مرة واحدة بس).
    const { order: bOrder2 } = await createOrder(checkoutInput(), CUSTOMER_B, nextKey())
    await deliver(bOrder2.id)
    expect(await getLoyaltyBalance(CUSTOMER_A)).toBe(50) // ثابتة زي ما هي

    // 5) صفحة الإحالات في الأدمن بتقدر تعرض الإحالة دي كاملة، بالطلب المؤهِّل الصحيح.
    const { referrals, total } = await listReferralsForAdmin({ page: 1, limit: 20 })
    const found = referrals.find(r => r.referralCode === code)
    expect(total).toBeGreaterThanOrEqual(1)
    expect(found).toMatchObject({ status: 'rewarded', referrerRewardPoints: 50, qualifyingOrderId: bOrder1.id })

    const detail = await getReferralDetailForAdmin(found!.id)
    expect(detail).toMatchObject({ referrerUserId: CUSTOMER_A, referredUserId: CUSTOMER_B })
  })
})

describe('E2E — full expiry cycle', () => {
  async function setLotExpiry(userId: string, sourceOrderId: string | null, note: string | null, expiresAt: Date) {
    const condition = sourceOrderId
      ? `l.source_order_id = '${sourceOrderId}'`
      : `l.note = '${note}'`
    await pool.query(
      `UPDATE loyalty_point_lots lot SET expires_at = $1
       FROM loyalty_ledger l WHERE lot.source_ledger_id = l.id AND l.user_id = $2 AND ${condition}`,
      [expiresAt.toISOString(), userId]
    )
  }

  it('creates lots at different dates, partially redeems the oldest, expires only the true remainder, and never expires it twice', async () => {
    await pool.query('UPDATE store_settings SET loyalty_expiry_enabled = 1 WHERE id = 1')

    // 1) ثلاث دفعات نقاط "بتواريخ مختلفة" (يناير 200، فبراير 300، مارس 100) عن طريق تعديلات
    //    يدوية منفصلة (كل تعديل بينشئ دفعة FIFO خاصة بيه).
    await adjustLoyaltyPointsManually(CUSTOMER_A, 200, 'دفعة يناير', ADMIN_ID)
    await adjustLoyaltyPointsManually(CUSTOMER_A, 300, 'دفعة فبراير', ADMIN_ID)
    await adjustLoyaltyPointsManually(CUSTOMER_A, 100, 'دفعة مارس', ADMIN_ID)
    expect(await getLoyaltyBalance(CUSTOMER_A)).toBe(600)

    // 2) استهلاك جزئي من الدفعة الأقدم (يناير) — طلب حقيقي يستخدم 150 نقطة.
    const { order } = await createOrder(checkoutInput({ loyaltyPointsRedeemed: 150 }), CUSTOMER_A, nextKey())
    expect(order.loyaltyPointsRedeemed).toBe(150)
    expect(await getLoyaltyBalance(CUSTOMER_A)).toBe(450) // 600 - 150

    // دفعة يناير باقيها 50 (200-150)، فبراير وماو مارس لسه كاملين.
    // 3) نخلّي يناير وفبراير بس "منتهيين فعلياً" (تاريخ ماضي)، مارس لسه بعيد.
    const past = new Date(Date.now() - 86400000)
    const farFuture = new Date(Date.now() + 365 * 86400000)
    await setLotExpiry(CUSTOMER_A, null, 'دفعة يناير', past)
    await setLotExpiry(CUSTOMER_A, null, 'دفعة فبراير', past)
    await setLotExpiry(CUSTOMER_A, null, 'دفعة مارس', farFuture)

    // 4) تشغيل معالج انتهاء الصلاحية عند حدود زمنية محدّدة (الآن) — لازم يمسح بس يناير
    //    (الباقي الفعلي 50) وفبراير (300 كاملة)، مش مارس (لسه بعيد).
    const expiredLots = await runLoyaltyExpiryBatch(200)
    expect(expiredLots).toBe(2) // دفعتا يناير وفبراير
    expect(await getLoyaltyBalance(CUSTOMER_A)).toBe(100) // بقيت بس دفعة مارس

    // 5) إعادة التشغيل فوراً — مفيش تكرار لنفس الانتهاء.
    const secondRun = await runLoyaltyExpiryBatch(200)
    expect(secondRun).toBe(0)
    expect(await getLoyaltyBalance(CUSTOMER_A)).toBe(100)

    // 6) سجل النقاط الظاهر للعميل بيوضّح كل حركة انتهاء صلاحية بشكل منفصل، مفيش حذف لأي تاريخ.
    const { entries } = await listLoyaltyLedger(CUSTOMER_A, 1, 50)
    const expiredEntries = entries.filter(e => e.sourceType === 'expired')
    expect(expiredEntries).toHaveLength(2)
    expect(expiredEntries.map(e => e.pointsChange).sort((a, b) => a - b)).toEqual([-300, -50])

    // 7) دفعة مارس (لسه شغالة، بعيدة الانتهاء) بتظهر صح في "نقاط ستنتهي قريباً" لما ندخل في
    //    نافذة التحذير المُعدّة (30 يوم) — مش دلوقتي (بعيدة أوي)، لكن لو قرّبنا تاريخها هتظهر.
    expect(await listUpcomingLoyaltyExpiry(CUSTOMER_A)).toEqual([])
    await setLotExpiry(CUSTOMER_A, null, 'دفعة مارس', new Date(Date.now() + 10 * 86400000))
    const upcoming = await listUpcomingLoyaltyExpiry(CUSTOMER_A)
    expect(upcoming).toHaveLength(1)
    expect(upcoming[0].points).toBe(100)
  })
})
