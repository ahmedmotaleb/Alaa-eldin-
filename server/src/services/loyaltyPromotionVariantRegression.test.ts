// اختبارات تكامل حقيقية (Postgres فعلي) لتفاعل نقاط الولاء مع الخصومات/العروض والمتغيرات —
// القسمين 48 و49 من مواصفة دفعة الولاء: التأكد إن الخصم المُركّب (كوبون + نقاط) بيتحسب
// بالترتيب الصحيح فعلياً، وإن استخدام النقاط ما بيأثرش على منطق المتغيرات (السعر، القفل،
// اللقطة) خالص — بالإضافة لاختبار إلغاء طلب مُركّب (كوبون + متغيّر + نقاط) في القسم 50.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { createOrder, cancelOrder } from './orderService.js'
import { adjustLoyaltyPointsManually, getLoyaltyBalance } from './loyaltyService.js'
import type { CheckoutInput } from '../checkoutValidation.js'
import { todayInCairo } from '../cairoDate.js'

const CATEGORY_ID = 'promo-var-cat'
const PRODUCT_ID = 'promo-var-prod'
const PRODUCT_PRICE = 25 // 20 × 25 = 500 (نفس رقم المثال في المواصفة)
const VARIANT_ID = 'promo-var-variant'
const VARIANT_PRICE = 60
const VARIANT_STOCK = 20
const USER_ID = 'test-user-promo-var'

async function resetFixtures() {
  await pool.query('DELETE FROM discount_usages')
  await pool.query('DELETE FROM stock_movements')
  await pool.query('DELETE FROM order_items')
  await pool.query('DELETE FROM orders')
  await pool.query('DELETE FROM discounts')
  await pool.query('DELETE FROM loyalty_ledger')
  await pool.query('DELETE FROM product_variants')
  await pool.query('DELETE FROM products')
  await pool.query('DELETE FROM categories')
  await pool.query('DELETE FROM store_settings')
  await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])

  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, 'promo-var@test.local', 'x', 'عميل اختبار', now())`,
    [USER_ID]
  )
  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`, [CATEGORY_ID])
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'promo-var-product', $2, 'منتج اختبار', 'وصف', $3, 15, 'وحدة', '🧪', 1, 1000, now())`,
    [PRODUCT_ID, CATEGORY_ID, PRODUCT_PRICE]
  )
  await pool.query(
    `INSERT INTO product_variants (id, product_id, name, price, cost, stock, available, created_at)
     VALUES ($1, $2, 'أزرق - وسط', $3, 35, $4, 1, now())`,
    [VARIANT_ID, PRODUCT_ID, VARIANT_PRICE, VARIANT_STOCK]
  )
  await pool.query(
    `INSERT INTO store_settings (
       id, name, whatsapp_number, currency, minimum_order, free_shipping_threshold, delivery_fee,
       loyalty_points_per_egp, referral_bonus_points,
       loyalty_enabled, loyalty_point_value_egp, loyalty_min_redeem_points, loyalty_max_redemption_percent,
       loyalty_min_order_for_redemption, loyalty_expiry_enabled, loyalty_expiry_days, loyalty_expiry_warning_days,
       referral_enabled, referral_referred_bonus_points, referral_min_qualifying_order
     ) VALUES (
       1, 'متجر اختبار', '01000000000', 'ج.م', 0, 5000, 20,
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

async function makeDiscount(overrides: Partial<{ type: string, value: number, freeDelivery: number, firstOrderOnly: number, scope: string, scopeId: string | null }> = {}) {
  const { type = 'fixed', value = 50, freeDelivery = 0, firstOrderOnly = 0, scope = 'order', scopeId = null } = overrides
  await pool.query(
    `INSERT INTO discounts (code, type, value, min_order, max_uses, used_count, active, created_at, scope, scope_id, first_order_only, free_delivery)
     VALUES ('PROMO50', $1, $2, 0, NULL, 0, 1, now(), $3, $4, $5, $6)`,
    [type, value, scope, scopeId, firstOrderOnly, freeDelivery]
  )
}

let keyCounter = 0
function nextKey() {
  keyCounter += 1
  return `promo-var-key-${keyCounter}-${Date.now()}`
}

function baseInput(overrides: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    deliverySlot: 'now',
    deliveryDate: todayInCairo(),
    paymentMethod: 'COD',
    customer: { fullName: 'عميل اختبار', mobile: '01012345678', governorate: 'القاهرة', address: 'شارع 1' },
    items: [{ productId: PRODUCT_ID, quantity: 20 }], // 20×25 = 500
    substitutionPreference: 'contact_me',
    ...overrides
  }
}

beforeEach(resetFixtures)

afterAll(async () => {
  await pool.end()
})

describe('Section 48 — promotion + loyalty combined calculation', () => {
  it('promotion only: reduces the subtotal, delivery applies normally', async () => {
    await makeDiscount({ type: 'fixed', value: 50 })
    const { order } = await createOrder(baseInput({ discountCode: 'PROMO50' }), USER_ID, nextKey())
    expect(order.subtotal).toBe(500)
    expect(order.discountAmount).toBe(50)
    expect(order.loyaltyDiscountAmount).toBe(0)
    expect(order.deliveryFee).toBe(20)
    expect(order.total).toBe(500 - 50 + 20)
  })

  it('loyalty only: reduces the subtotal, promotion absent', async () => {
    await adjustLoyaltyPointsManually(USER_ID, 2000, 'تعبئة', USER_ID)
    const { order } = await createOrder(baseInput({ loyaltyPointsRedeemed: 2000 }), USER_ID, nextKey())
    expect(order.discountAmount).toBe(0)
    expect(order.loyaltyDiscountAmount).toBe(100) // 2000 * 0.05
    expect(order.total).toBe(500 - 100 + 20)
  })

  it('promotion + loyalty: matches the exact spec worked example (500, -50, -100, +20 delivery = 370)', async () => {
    await makeDiscount({ type: 'fixed', value: 50 })
    await adjustLoyaltyPointsManually(USER_ID, 2000, 'تعبئة', USER_ID)
    const { order } = await createOrder(
      baseInput({ discountCode: 'PROMO50', loyaltyPointsRedeemed: 2000 }),
      USER_ID, nextKey()
    )
    expect(order.subtotal).toBe(500)
    expect(order.discountAmount).toBe(50)
    expect(order.loyaltyDiscountAmount).toBe(100)
    expect(order.deliveryFee).toBe(20)
    expect(order.total).toBe(370)
  })

  it('free-delivery promotion + loyalty: delivery is zeroed, loyalty discount still applies to the merchandise subtotal', async () => {
    await makeDiscount({ type: 'fixed', value: 0, freeDelivery: 1 })
    await adjustLoyaltyPointsManually(USER_ID, 2000, 'تعبئة', USER_ID)
    const { order } = await createOrder(
      baseInput({ discountCode: 'PROMO50', loyaltyPointsRedeemed: 2000 }),
      USER_ID, nextKey()
    )
    expect(order.discountAmount).toBe(0)
    expect(order.deliveryFee).toBe(0)
    expect(order.loyaltyDiscountAmount).toBe(100)
    expect(order.total).toBe(500 - 100)
  })

  it('scoped category discount + loyalty: loyalty is calculated on (subtotal - the scoped discount), not the raw subtotal', async () => {
    await makeDiscount({ type: 'percentage', value: 10, scope: 'category', scopeId: CATEGORY_ID })
    await adjustLoyaltyPointsManually(USER_ID, 2000, 'تعبئة', USER_ID)
    // خصم 10% على 500 = 50 -> فرعي مؤهّل للولاء = 500-50=450 -> استخدام 2000 نقطة (100 ج.م)
    // ما ينفعش يتجاوز 450 (الفرعي المؤهّل نفسه)، وهنا 100 أقل منه فمقبول بالكامل.
    const { order } = await createOrder(
      baseInput({ discountCode: 'PROMO50', loyaltyPointsRedeemed: 2000 }),
      USER_ID, nextKey()
    )
    expect(order.discountAmount).toBe(50)
    expect(order.loyaltyDiscountAmount).toBe(100)
    expect(order.total).toBe(500 - 50 - 100 + 20)
  })

  it('first-order promotion + loyalty: both apply together for a genuinely first-time customer', async () => {
    await makeDiscount({ type: 'fixed', value: 50, firstOrderOnly: 1 })
    await adjustLoyaltyPointsManually(USER_ID, 2000, 'تعبئة', USER_ID)
    const { order } = await createOrder(
      baseInput({ discountCode: 'PROMO50', loyaltyPointsRedeemed: 2000 }),
      USER_ID, nextKey()
    )
    expect(order.discountAmount).toBe(50)
    expect(order.loyaltyDiscountAmount).toBe(100)
    expect(order.total).toBe(370)
  })

  it('a fixed discount larger than the subtotal is clipped to the subtotal itself, never producing a negative total', async () => {
    // خصم ثابت أكبر من الفرعي نفسه (999) — لوحده (من غير نقاط) — لازم يتقص عند الفرعي بالظبط.
    await makeDiscount({ type: 'fixed', value: 999 })
    const { order } = await createOrder(baseInput({ discountCode: 'PROMO50' }), USER_ID, nextKey())
    expect(order.discountAmount).toBe(500) // اتقص عند الفرعي نفسه، مش 999
    expect(order.total).toBeGreaterThanOrEqual(0)
    expect(order.total).toBe(0 + 20) // خصم كامل الفرعي، التوصيل لسه بيتحسب فوقه
  })

  it('a large fixed discount plus a maxed-out loyalty redemption together consume the eligible subtotal exactly, never going negative', async () => {
    // خصم ثابت 450 -> الفرعي المؤهّل للولاء = 500-450 = 50 -> بنسبة أقصى 100% ده يسمح باستخدام
    // نقاط بقيمة 50 ج.م بالظبط (1000 نقطة بسعر 0.05) — الاتنين مع بعض بياخدوا الفرعي كامل
    // من غير ما يتعدّوه أو ينتجوا رقم سالب.
    await makeDiscount({ type: 'fixed', value: 450 })
    await adjustLoyaltyPointsManually(USER_ID, 2000, 'تعبئة', USER_ID)
    const { order } = await createOrder(
      baseInput({ discountCode: 'PROMO50', loyaltyPointsRedeemed: 1000 }),
      USER_ID, nextKey()
    )
    expect(order.discountAmount).toBe(450)
    expect(order.loyaltyDiscountAmount).toBe(50)
    expect(order.total).toBeGreaterThanOrEqual(0)
    expect(order.total).toBe(0 + 20) // 500 - 450 - 50 = 0، زائد التوصيل
  })

  it('rejects a redemption that would exceed what remains of the eligible subtotal after the promotion, rather than silently clamping it', async () => {
    // بعد خصم 480 التابت، الفرعي المؤهّل للولاء يبقى 20 بس -> بنسبة أقصى 100% يسمح بـ400
    // نقطة كحد أقصى (20/0.05) — طلب 1000 نقطة لازم يترفض صراحةً، مش يتقبل بخصم مقصوص بصمت.
    await makeDiscount({ type: 'fixed', value: 480 })
    await adjustLoyaltyPointsManually(USER_ID, 2000, 'تعبئة', USER_ID)
    await expect(createOrder(baseInput({ discountCode: 'PROMO50', loyaltyPointsRedeemed: 1000 }), USER_ID, nextKey()))
      .rejects.toMatchObject({ status: 400, code: 'redemption_exceeds_limit', details: { maxAllowedPoints: 400 } })
  })
})

describe('Section 49 — product variant + loyalty interaction', () => {
  it('loyalty redemption does not change the authoritative variant price, identity, or stock lock', async () => {
    await adjustLoyaltyPointsManually(USER_ID, 2000, 'تعبئة', USER_ID)
    const { order } = await createOrder(
      baseInput({ items: [{ productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 4 }], loyaltyPointsRedeemed: 2000 }),
      USER_ID, nextKey()
    )
    // السعر والهوية والقفل كلهم من المتغيّر نفسه، مش متأثرين بالنقاط إطلاقاً.
    expect(order.items[0].unitPrice).toBe(VARIANT_PRICE)
    expect(order.items[0].name).toBe('منتج اختبار - أزرق - وسط')
    expect(order.subtotal).toBe(VARIANT_PRICE * 4)

    const { rows } = await pool.query<{ stock: number }>('SELECT stock FROM product_variants WHERE id = $1', [VARIANT_ID])
    expect(rows[0].stock).toBe(VARIANT_STOCK - 4) // خُصم من المتغيّر بس، مش موزّع أو معدَّل بسبب النقاط

    // الخصم بيتسجّل على مستوى الطلب فقط — مفيش أي توزيع لخصم النقاط داخل سعر المتغيّر نفسه.
    expect(order.loyaltyDiscountAmount).toBeGreaterThan(0)
    const maxDiscount = VARIANT_PRICE * 4 // (لا يوجد كوبون هنا) نسبة 100% مسموحة في هذا الفكستشر
    expect(order.loyaltyDiscountAmount).toBeLessThanOrEqual(maxDiscount)
  })

  it('snapshots variant name and unit price on the order item alongside the order-level loyalty deduction', async () => {
    await adjustLoyaltyPointsManually(USER_ID, 500, 'تعبئة', USER_ID)
    const { order } = await createOrder(
      baseInput({ items: [{ productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 2 }], loyaltyPointsRedeemed: 500 }),
      USER_ID, nextKey()
    )
    expect(order.items[0]).toMatchObject({ name: 'منتج اختبار - أزرق - وسط', unitPrice: VARIANT_PRICE, quantity: 2 })
    expect(order.loyaltyPointsRedeemed).toBe(500)
    expect(order.loyaltyDiscountAmount).toBe(25)
  })
})

describe('Section 50 — combined cancellation regression (promotion + variant + loyalty)', () => {
  it('cancelling a combined order restores variant stock once, restores redeemed points once, and preserves discount usage history', async () => {
    await makeDiscount({ type: 'fixed', value: 50 })
    await adjustLoyaltyPointsManually(USER_ID, 2000, 'تعبئة', USER_ID)

    const { order } = await createOrder(
      baseInput({
        items: [{ productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 3 }],
        discountCode: 'PROMO50',
        loyaltyPointsRedeemed: 2000
      }),
      USER_ID, nextKey()
    )
    expect(await getLoyaltyBalance(USER_ID)).toBe(0) // 2000 - 2000 المستخدمة بالكامل

    const { rows: stockAfterOrder } = await pool.query<{ stock: number }>('SELECT stock FROM product_variants WHERE id = $1', [VARIANT_ID])
    expect(stockAfterOrder[0].stock).toBe(VARIANT_STOCK - 3)

    const { rows: usageAfterOrder } = await pool.query('SELECT used_count as "usedCount" FROM discounts WHERE code = $1', ['PROMO50'])
    expect(usageAfterOrder[0].usedCount).toBe(1)

    // الإلغاء
    const result = await cancelOrder(order.id)
    expect(result).toEqual({ ok: true })

    // المخزون (المتغيّر تحديداً) اترجع بالظبط.
    const { rows: stockAfterCancel } = await pool.query<{ stock: number }>('SELECT stock FROM product_variants WHERE id = $1', [VARIANT_ID])
    expect(stockAfterCancel[0].stock).toBe(VARIANT_STOCK)

    // النقاط المستخدمة اترجعت بالكامل.
    expect(await getLoyaltyBalance(USER_ID)).toBe(2000)

    // عداد استخدام الكوبون بيفضل زي ما هو (سجل تاريخي — الإلغاء ما بيمسحوش، بنفس منطق الخصومات
    // الحالي قبل دفعة الولاء دي بالظبط).
    const { rows: usageAfterCancel } = await pool.query('SELECT used_count as "usedCount" FROM discounts WHERE code = $1', ['PROMO50'])
    expect(usageAfterCancel[0].usedCount).toBe(1)

    // لا استرجاع مضاعف عند تكرار محاولة الإلغاء.
    await cancelOrder(order.id)
    const { rows: stockAfterSecondCancel } = await pool.query<{ stock: number }>('SELECT stock FROM product_variants WHERE id = $1', [VARIANT_ID])
    expect(stockAfterSecondCancel[0].stock).toBe(VARIANT_STOCK)
    expect(await getLoyaltyBalance(USER_ID)).toBe(2000)

    // اللقطة المحفوظة على الطلب نفسه (بيانات الفاتورة التاريخية) ما بتتغيّرش بسبب الإلغاء.
    const { rows: orderSnapshot } = await pool.query(
      'SELECT discount_amount as "discountAmount", loyalty_points_redeemed as "pointsRedeemed", loyalty_discount_amount as "loyaltyDiscountAmount" FROM orders WHERE id = $1',
      [order.id]
    )
    expect(orderSnapshot[0]).toEqual({ discountAmount: 50, pointsRedeemed: 2000, loyaltyDiscountAmount: 100 })
  })
})
