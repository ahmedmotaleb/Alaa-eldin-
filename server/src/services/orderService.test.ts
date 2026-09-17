// اختبارات تكامل حقيقية — بتتصل بقاعدة بيانات اختبار فعلية (Postgres محلي، راجع
// vitest.config.ts) وبتنفّذ نفس منطق orderService الحقيقي بمعاملاته وأقفاله، مش نسخة
// مُقلَّدة. هي الطريقة الوحيدة اللي تثبت فعلياً إن قفل الصفوف (FOR UPDATE) وحماية السباق
// على الخصومات والمخزون بيشتغلوا صح تحت تزامن حقيقي.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { createOrder, cancelOrder, getOrderByNumberForGuestToken } from './orderService.js'
import { listOrderStatusHistory } from './orderStatusHistoryService.js'
import type { CheckoutInput } from '../checkoutValidation.js'
import { todayInCairo, addCalendarDays } from '../cairoDate.js'

const CATEGORY_ID = 'test-cat'
const PRODUCT_ID = 'test-prod-1'
const PRODUCT_PRICE = 38
const DEFAULT_STOCK = 100
const USER_ID = 'test-user-order-1'
const SECOND_CATEGORY_ID = 'test-cat-2'
const SECOND_PRODUCT_ID = 'test-prod-2'
const SECOND_PRODUCT_PRICE = 25

async function resetFixtures() {
  await pool.query('DELETE FROM discount_usages')
  await pool.query('DELETE FROM stock_movements')
  await pool.query('DELETE FROM order_items')
  await pool.query('DELETE FROM orders')
  await pool.query('DELETE FROM discounts')
  await pool.query('DELETE FROM products')
  await pool.query('DELETE FROM categories')
  await pool.query('DELETE FROM store_settings')
  await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])

  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, 'order-test@test.local', 'x', 'مستخدم اختبار', now())`,
    [USER_ID]
  )
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'test-product', $2, 'منتج اختبار', 'وصف', $3, 20, 'وحدة', '🧪', 1, $4, now())`,
    [PRODUCT_ID, CATEGORY_ID, PRODUCT_PRICE, DEFAULT_STOCK]
  )
  // فئة ومنتج تانيين — مستخدمين بس في اختبارات نطاق الخصم (فئة/منتج محدد) عشان يبقى فيه
  // صنف "غير مؤهّل" فعلي جوه نفس السلة، مش كل الأصناف مؤهّلة زي باقي اختبارات الملف.
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار 2', '🧪', '#fff', 2)`,
    [SECOND_CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'test-product-2', $2, 'منتج اختبار 2', 'وصف', $3, 15, 'وحدة', '🧪', 1, $4, now())`,
    [SECOND_PRODUCT_ID, SECOND_CATEGORY_ID, SECOND_PRODUCT_PRICE, DEFAULT_STOCK]
  )
  await pool.query(
    `INSERT INTO store_settings (id, name, whatsapp_number, currency, minimum_order, free_shipping_threshold, delivery_fee)
     VALUES (1, 'متجر اختبار', '20100', 'ج.م', 100, 500, 30)`
  )

  // delivery_zones/delivery_slots مش بيتمسحوا هنا (بيانات مرجعية دائمة اتزرعت بالـ migration،
  // مش fixture لكل اختبار) — بس الصفوف اللي اختبارات الملف ده بتلعب فيها بترجع لحالتها الافتراضية
  // عشان أي تعديل (تعطيل/تغيير رسم) من اختبار سابق ميأثرش على الاختبار الجاي أو ملفات تانية.
  await pool.query(`UPDATE delivery_zones SET delivery_fee = 30, is_active = 1 WHERE governorate = 'القاهرة'`)
  await pool.query(`UPDATE delivery_slots SET is_active = 1, max_orders_per_day = NULL WHERE id = 'now'`)
  // مش بيانات مرجعية دائمة (عكس delivery_zones/delivery_slots) — لازم تترجع فاضية قبل كل
  // اختبار عشان استثناء تاريخ من اختبار سابق ميأثرش على اختبار تاني.
  await pool.query('DELETE FROM delivery_date_overrides')
  await pool.query('DELETE FROM delivery_slot_date_capacity')
}

async function setStock(quantity: number) {
  await pool.query('UPDATE products SET stock = $1 WHERE id = $2', [quantity, PRODUCT_ID])
}

async function getStock(): Promise<number> {
  const { rows } = await pool.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID])
  return rows[0].stock
}

function baseInput(overrides: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    deliverySlot: 'now',
    deliveryDate: todayInCairo(),
    paymentMethod: 'COD',
    customer: { fullName: 'عميل اختبار', mobile: '01012345678', governorate: 'القاهرة', address: 'شارع 1' },
    items: [{ productId: PRODUCT_ID, quantity: 5 }],
    substitutionPreference: 'contact_me',
    ...overrides
  }
}

let keyCounter = 0
function nextKey() {
  keyCounter += 1
  return `test-key-${keyCounter}-${Date.now()}`
}

beforeEach(async () => {
  await resetFixtures()
})

afterAll(async () => {
  await pool.end()
})

describe('createOrder — server-authoritative pricing', () => {
  it('always prices from the product row in the database, regardless of anything the client sent', async () => {
    const { order } = await createOrder(baseInput(), null, nextKey())
    expect(order.items[0].unitPrice).toBe(PRODUCT_PRICE)
    expect(order.subtotal).toBe(PRODUCT_PRICE * 5)
    // 190 دون حد الشحن المجاني (500) فيتضاف رسم التوصيل الافتراضي (30)
    expect(order.deliveryFee).toBe(30)
    expect(order.total).toBe(PRODUCT_PRICE * 5 + 30)
  })

  it('grants free shipping exactly at the threshold using store_settings, not a hardcoded value', async () => {
    await pool.query('UPDATE store_settings SET free_shipping_threshold = 190 WHERE id = 1')
    const { order } = await createOrder(baseInput(), null, nextKey())
    expect(order.subtotal).toBe(190)
    expect(order.deliveryFee).toBe(0)
    expect(order.total).toBe(190)
  })

  it('rejects an order below the configured minimum order with the exact values', async () => {
    await pool.query('UPDATE store_settings SET minimum_order = 1000 WHERE id = 1')
    await expect(createOrder(baseInput(), null, nextKey())).rejects.toMatchObject({
      status: 400,
      code: 'minimum_order_not_met',
      details: { minimumOrder: 1000, currentAmount: 190 }
    })
  })

  it('rejects when cod is disabled in store settings', async () => {
    await pool.query('UPDATE store_settings SET cod_enabled = 0 WHERE id = 1')
    await expect(createOrder(baseInput(), null, nextKey())).rejects.toMatchObject({ code: 'cod_disabled' })
  })
})

describe('createOrder — server-authoritative delivery zones and slots', () => {
  it('prices delivery from the matched zone row, not the flat store-wide default', async () => {
    await pool.query(`UPDATE delivery_zones SET delivery_fee = 55 WHERE governorate = 'القاهرة'`)
    const { order } = await createOrder(baseInput(), null, nextKey())
    // الإعداد العام لسه 30 (من resetFixtures) — المتوقع هنا 55 لأنه سعر منطقة القاهرة تحديداً.
    expect(order.deliveryFee).toBe(55)
    expect(order.total).toBe(PRODUCT_PRICE * 5 + 55)
  })

  it('still grants free shipping at the threshold even with a non-default zone fee', async () => {
    await pool.query(`UPDATE delivery_zones SET delivery_fee = 55 WHERE governorate = 'القاهرة'`)
    await pool.query('UPDATE store_settings SET free_shipping_threshold = 190 WHERE id = 1')
    const { order } = await createOrder(baseInput(), null, nextKey())
    expect(order.deliveryFee).toBe(0)
  })

  it('rejects a governorate with no configured delivery zone at all', async () => {
    await expect(
      createOrder(baseInput({ customer: { fullName: 'عميل اختبار', mobile: '01012345678', governorate: 'محافظة غير موجودة', address: 'شارع 1' } }), null, nextKey())
    ).rejects.toMatchObject({ status: 400, code: 'delivery_zone_unavailable' })
  })

  it('rejects a governorate whose zone exists but was deactivated by the admin', async () => {
    await pool.query(`UPDATE delivery_zones SET is_active = 0 WHERE governorate = 'القاهرة'`)
    await expect(createOrder(baseInput(), null, nextKey())).rejects.toMatchObject({ status: 400, code: 'delivery_zone_unavailable' })
  })

  it('rejects a delivery slot id that does not exist', async () => {
    await expect(
      createOrder(baseInput({ deliverySlot: 'yesterday' }), null, nextKey())
    ).rejects.toMatchObject({ status: 400, code: 'invalid_delivery_slot' })
  })

  it('rejects a delivery slot that exists but was deactivated by the admin', async () => {
    await pool.query(`UPDATE delivery_slots SET is_active = 0 WHERE id = 'now'`)
    await expect(createOrder(baseInput(), null, nextKey())).rejects.toMatchObject({ status: 400, code: 'invalid_delivery_slot' })
  })

  it('rejects an order once the slot reaches its configured daily capacity', async () => {
    await pool.query(`UPDATE delivery_slots SET max_orders_per_day = 1 WHERE id = 'now'`)
    await createOrder(baseInput(), null, nextKey())
    await expect(createOrder(baseInput(), null, nextKey())).rejects.toMatchObject({ status: 409, code: 'delivery_slot_full' })
    await pool.query(`UPDATE delivery_slots SET max_orders_per_day = NULL WHERE id = 'now'`)
  })

  it('does not count a cancelled order against the slot capacity', async () => {
    await pool.query(`UPDATE delivery_slots SET max_orders_per_day = 1 WHERE id = 'now'`)
    const { order: first } = await createOrder(baseInput(), null, nextKey())
    await cancelOrder(first.id)
    const { order: second } = await createOrder(baseInput(), null, nextKey())
    expect(second.status).toBe('placed')
    await pool.query(`UPDATE delivery_slots SET max_orders_per_day = NULL WHERE id = 'now'`)
  })

  it('persists the requested delivery date on the created order', async () => {
    const date = addCalendarDays(todayInCairo(), 2)
    const { order } = await createOrder(baseInput({ deliveryDate: date }), null, nextKey())
    expect(order.deliveryDate).toBe(date)
  })

  it('capacity is scoped per delivery date — a full day does not block a different date for the same slot', async () => {
    await pool.query(`UPDATE delivery_slots SET max_orders_per_day = 1 WHERE id = 'now'`)
    const today = todayInCairo()
    const tomorrow = addCalendarDays(today, 1)
    await createOrder(baseInput({ deliveryDate: today }), null, nextKey())
    // النهاردة بقى ممتلئ، لكن بكرة لسه فاضي تماماً لنفس الميعاد.
    await expect(createOrder(baseInput({ deliveryDate: today }), null, nextKey())).rejects.toMatchObject({ status: 409, code: 'delivery_slot_full' })
    const { order } = await createOrder(baseInput({ deliveryDate: tomorrow }), null, nextKey())
    expect(order.status).toBe('placed')
    await pool.query(`UPDATE delivery_slots SET max_orders_per_day = NULL WHERE id = 'now'`)
  })

  it('rejects a delivery date explicitly disabled by an admin override', async () => {
    const date = addCalendarDays(todayInCairo(), 3)
    await pool.query(
      `INSERT INTO delivery_date_overrides (delivery_date, active, notes) VALUES ($1, false, 'عطلة رسمية')`,
      [date]
    )
    await expect(createOrder(baseInput({ deliveryDate: date }), null, nextKey())).rejects.toMatchObject({ status: 400, code: 'delivery_date_unavailable' })
  })

  it('rejects a delivery date that falls on a weekly closed day with no override', async () => {
    const date = addCalendarDays(todayInCairo(), 4)
    const { isoWeekdayOf } = await import('../cairoDate.js')
    await pool.query('UPDATE store_settings SET delivery_closed_weekdays = $1 WHERE id = 1', [String(isoWeekdayOf(date))])
    await expect(createOrder(baseInput({ deliveryDate: date }), null, nextKey())).rejects.toMatchObject({ status: 400, code: 'delivery_date_unavailable' })
  })

  it('allows a delivery date on a normally-closed weekday when explicitly overridden open', async () => {
    const date = addCalendarDays(todayInCairo(), 5)
    const { isoWeekdayOf } = await import('../cairoDate.js')
    await pool.query('UPDATE store_settings SET delivery_closed_weekdays = $1 WHERE id = 1', [String(isoWeekdayOf(date))])
    await pool.query(`INSERT INTO delivery_date_overrides (delivery_date, active, notes) VALUES ($1, true, 'فتح استثنائي')`, [date])
    const { order } = await createOrder(baseInput({ deliveryDate: date }), null, nextKey())
    expect(order.status).toBe('placed')
    await pool.query(`UPDATE store_settings SET delivery_closed_weekdays = '' WHERE id = 1`)
  })
})

describe('createOrder — stock validation and atomic deduction', () => {
  it('deducts exactly the ordered quantity and records a sale movement', async () => {
    await setStock(20)
    const { order } = await createOrder(baseInput({ items: [{ productId: PRODUCT_ID, quantity: 3 }] }), null, nextKey())
    expect(await getStock()).toBe(17)

    const { rows } = await pool.query('SELECT type, quantity_change FROM stock_movements WHERE order_id = $1', [order.id])
    expect(rows).toEqual([{ type: 'sale', quantity_change: -3 }])
  })

  it('rejects an order that exceeds available stock and leaves stock untouched', async () => {
    await setStock(2)
    await expect(createOrder(baseInput({ items: [{ productId: PRODUCT_ID, quantity: 3 }] }), null, nextKey()))
      .rejects.toMatchObject({ status: 409, code: 'insufficient_stock' })
    expect(await getStock()).toBe(2)
  })

  it('rejects a non-existent product', async () => {
    await expect(createOrder(baseInput({ items: [{ productId: 'does-not-exist', quantity: 1 }] }), null, nextKey()))
      .rejects.toMatchObject({ status: 400, code: 'product_not_found' })
  })

  it('rejects an unavailable product', async () => {
    await pool.query('UPDATE products SET available = 0 WHERE id = $1', [PRODUCT_ID])
    await expect(createOrder(baseInput(), null, nextKey())).rejects.toMatchObject({ status: 400, code: 'product_unavailable' })
  })

  // السباق الحقيقي: مخزون 8، طلبين متزامنين لخمسة كل واحد — لازم واحد بس ينجح، والتاني
  // يترفض، والمخزون النهائي يبقى 3 بالظبط (مش سالب، ومش رجع لتحت الطلب اللي نجح).
  it('never oversells under real concurrency', async () => {
    await setStock(8)
    const results = await Promise.allSettled([
      createOrder(baseInput({ items: [{ productId: PRODUCT_ID, quantity: 5 }] }), null, nextKey()),
      createOrder(baseInput({ items: [{ productId: PRODUCT_ID, quantity: 5 }] }), null, nextKey())
    ])

    const succeeded = results.filter(r => r.status === 'fulfilled')
    const failed = results.filter(r => r.status === 'rejected')
    expect(succeeded).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect((failed[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'insufficient_stock' })
    expect(await getStock()).toBe(3)
  })
})

describe('createOrder — variant handling', () => {
  const VARIANT_ID = 'test-variant-1'
  const VARIANT_PRICE = 55
  const VARIANT_STOCK = 10

  async function makeVariant(overrides: Partial<{ price: number, stock: number, available: number }> = {}) {
    const { price = VARIANT_PRICE, stock = VARIANT_STOCK, available = 1 } = overrides
    await pool.query(
      `INSERT INTO product_variants (id, product_id, name, price, cost, stock, available, created_at)
       VALUES ($1, $2, 'أحمر - كبير', $3, 30, $4, $5, now())`,
      [VARIANT_ID, PRODUCT_ID, price, stock, available]
    )
  }

  it('prices and deducts from the variant, not the parent product', async () => {
    await makeVariant()
    const parentStockBefore = await getStock()

    const { order } = await createOrder(baseInput({ items: [{ productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 2 }] }), null, nextKey())

    expect(order.items[0].unitPrice).toBe(VARIANT_PRICE)
    expect(order.subtotal).toBe(VARIANT_PRICE * 2)
    expect(await getStock()).toBe(parentStockBefore) // المنتج الأب ما اتلمسش

    const { rows } = await pool.query<{ stock: number }>('SELECT stock FROM product_variants WHERE id = $1', [VARIANT_ID])
    expect(rows[0].stock).toBe(VARIANT_STOCK - 2)
  })

  it('snapshots the variant name onto the order item', async () => {
    await makeVariant()
    const { order } = await createOrder(baseInput({ items: [{ productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 2 }] }), null, nextKey())
    expect(order.items[0].name).toBe('منتج اختبار - أحمر - كبير')
  })

  it('rejects insufficient variant stock even when the parent product has plenty', async () => {
    await makeVariant({ stock: 1 })
    await expect(createOrder(baseInput({ items: [{ productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 5 }] }), null, nextKey()))
      .rejects.toMatchObject({ status: 409, code: 'insufficient_stock' })
  })

  it('rejects an unavailable variant even when the parent product is available', async () => {
    await makeVariant({ available: 0 })
    await expect(createOrder(baseInput({ items: [{ productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 1 }] }), null, nextKey()))
      .rejects.toMatchObject({ status: 400, code: 'product_unavailable' })
  })

  it('rejects a variant id that belongs to a different product', async () => {
    await makeVariant()
    await expect(createOrder(baseInput({ items: [{ productId: SECOND_PRODUCT_ID, variantId: VARIANT_ID, quantity: 1 }] }), null, nextKey()))
      .rejects.toMatchObject({ status: 400, code: 'invalid_items' })
  })

  it('restores the variant stock (not the parent) when the order is cancelled', async () => {
    await makeVariant()
    const { order } = await createOrder(baseInput({ items: [{ productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 3 }] }), null, nextKey())
    await cancelOrder(order.id)
    const { rows } = await pool.query<{ stock: number }>('SELECT stock FROM product_variants WHERE id = $1', [VARIANT_ID])
    expect(rows[0].stock).toBe(VARIANT_STOCK)
  })
})

describe('createOrder — discount handling', () => {
  async function makeDiscount(overrides: Partial<{
    type: string, value: number, maxUses: number | null, active: number, minOrder: number,
    scope: string, scopeId: string | null, minQuantity: number | null, firstOrderOnly: number,
    freeDelivery: number, maxUsesPerCustomer: number | null, startsAt: string | null
  }> = {}) {
    const {
      type = 'fixed', value = 20, maxUses = null, active = 1, minOrder = 0,
      scope = 'order', scopeId = null, minQuantity = null, firstOrderOnly = 0,
      freeDelivery = 0, maxUsesPerCustomer = null, startsAt = null
    } = overrides
    await pool.query(
      `INSERT INTO discounts (
         code, type, value, min_order, max_uses, used_count, active, created_at,
         scope, scope_id, min_quantity, first_order_only, free_delivery, max_uses_per_customer, starts_at
       ) VALUES ('TESTCODE', $1, $2, $3, $4, 0, $5, now(), $6, $7, $8, $9, $10, $11, $12)`,
      [type, value, minOrder, maxUses, active, scope, scopeId, minQuantity, firstOrderOnly, freeDelivery, maxUsesPerCustomer, startsAt]
    )
  }

  it('applies the discount using the server-computed subtotal', async () => {
    await makeDiscount({ type: 'percentage', value: 10 })
    const { order } = await createOrder(baseInput({ discountCode: 'testcode' }), null, nextKey())
    expect(order.discountAmount).toBe(19) // 10% of 190
    expect(order.total).toBe(190 - 19 + 30)
  })

  it('rejects an inactive discount', async () => {
    await makeDiscount({ active: 0 })
    await expect(createOrder(baseInput({ discountCode: 'TESTCODE' }), null, nextKey()))
      .rejects.toMatchObject({ code: 'discount_inactive' })
  })

  it('never lets two concurrent orders exceed a max_uses of 1', async () => {
    await makeDiscount({ maxUses: 1 })
    const results = await Promise.allSettled([
      createOrder(baseInput({ discountCode: 'TESTCODE' }), null, nextKey()),
      createOrder(baseInput({ discountCode: 'TESTCODE' }), null, nextKey())
    ])

    const succeeded = results.filter(r => r.status === 'fulfilled')
    expect(succeeded).toHaveLength(1)

    const { rows } = await pool.query<{ usedCount: number }>('SELECT used_count as "usedCount" FROM discounts WHERE code = $1', ['TESTCODE'])
    expect(rows[0].usedCount).toBe(1)
  })

  it('applies a category-scoped discount only to the eligible portion of the cart', async () => {
    await makeDiscount({ type: 'percentage', value: 10, scope: 'category', scopeId: CATEGORY_ID })
    // 5×38 (مؤهّل، الفئة الأولى) + 2×25 (غير مؤهّل، الفئة التانية) = 190 + 50 = 240 إجمالي،
    // بس الخصم لازم يتحسب من الـ 190 المؤهّلة بس (19)، مش الـ 240 كلهم.
    const { order } = await createOrder(
      baseInput({ discountCode: 'TESTCODE', items: [{ productId: PRODUCT_ID, quantity: 5 }, { productId: SECOND_PRODUCT_ID, quantity: 2 }] }),
      null, nextKey()
    )
    expect(order.subtotal).toBe(240)
    expect(order.discountAmount).toBe(19)
  })

  it('applies a product-scoped discount only to that specific product', async () => {
    await makeDiscount({ type: 'fixed', value: 999, scope: 'product', scopeId: SECOND_PRODUCT_ID })
    const { order } = await createOrder(
      baseInput({ discountCode: 'TESTCODE', items: [{ productId: PRODUCT_ID, quantity: 5 }, { productId: SECOND_PRODUCT_ID, quantity: 2 }] }),
      null, nextKey()
    )
    // الخصم الثابت (999) أعلى بكتير من الإجمالي المؤهّل (2×25=50) — لازم يتقص عليه، مش 999.
    expect(order.discountAmount).toBe(50)
  })

  it('rejects when the eligible quantity is below the required minimum', async () => {
    await makeDiscount({ minQuantity: 10 })
    await expect(createOrder(baseInput({ discountCode: 'TESTCODE' }), null, nextKey()))
      .rejects.toMatchObject({ code: 'discount_min_quantity' })
  })

  it('accepts when the eligible quantity meets the required minimum', async () => {
    await makeDiscount({ minQuantity: 5 })
    const { order } = await createOrder(baseInput({ discountCode: 'TESTCODE' }), null, nextKey())
    expect(order.discountAmount).toBeGreaterThan(0)
  })

  it('rejects a discount that has not started yet', async () => {
    await makeDiscount({ startsAt: addCalendarDays(todayInCairo(), 5) })
    await expect(createOrder(baseInput({ discountCode: 'TESTCODE' }), null, nextKey()))
      .rejects.toMatchObject({ code: 'discount_not_started' })
  })

  it('rejects a first-order-only discount for a mobile number that already has an order', async () => {
    await createOrder(baseInput(), null, nextKey())
    await makeDiscount({ firstOrderOnly: 1 })
    await expect(createOrder(baseInput({ discountCode: 'TESTCODE' }), null, nextKey()))
      .rejects.toMatchObject({ code: 'discount_first_order_only' })
  })

  it('accepts a first-order-only discount for a genuinely new customer', async () => {
    await makeDiscount({ firstOrderOnly: 1 })
    const { order } = await createOrder(baseInput({ discountCode: 'TESTCODE' }), null, nextKey())
    expect(order.discountAmount).toBeGreaterThan(0)
  })

  it('enforces a per-customer usage cap independently of the overall max_uses', async () => {
    await makeDiscount({ maxUsesPerCustomer: 1 })
    await createOrder(baseInput({ discountCode: 'TESTCODE' }), null, nextKey())
    await expect(createOrder(baseInput({ discountCode: 'TESTCODE' }), null, nextKey()))
      .rejects.toMatchObject({ code: 'discount_max_uses_per_customer' })
  })

  it('zeroes the delivery fee for a free-delivery promotion', async () => {
    await makeDiscount({ type: 'fixed', value: 0, freeDelivery: 1 })
    const { order } = await createOrder(baseInput({ discountCode: 'TESTCODE' }), null, nextKey())
    expect(order.deliveryFee).toBe(0)
  })
})

describe('createOrder — idempotency', () => {
  it('replays the same order on a repeated idempotency key instead of creating a duplicate', async () => {
    const key = nextKey()
    const first = await createOrder(baseInput(), null, key)
    const second = await createOrder(baseInput(), null, key)

    expect(second.replay).toBe(true)
    expect(second.order.id).toBe(first.order.id)

    const { rows } = await pool.query('SELECT count(*) as n FROM orders WHERE idempotency_key = $1', [key])
    expect(Number(rows[0].n)).toBe(1)
    expect(await getStock()).toBe(DEFAULT_STOCK - 5) // خُصم مرة واحدة بس
  })

  it('rejects a reused idempotency key whose cart no longer matches the original request', async () => {
    const key = nextKey()
    await createOrder(baseInput({ items: [{ productId: PRODUCT_ID, quantity: 5 }] }), null, key)
    await expect(createOrder(baseInput({ items: [{ productId: PRODUCT_ID, quantity: 9 }] }), null, key))
      .rejects.toMatchObject({ status: 409, code: 'idempotency_conflict' })
  })

  it('resolves a true concurrent race on the same idempotency key to a single order', async () => {
    const key = nextKey()
    const results = await Promise.allSettled([
      createOrder(baseInput(), null, key),
      createOrder(baseInput(), null, key)
    ])
    const succeeded = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof createOrder>>>[]
    expect(succeeded).toHaveLength(2) // كلاهما لازم يرجع رد ناجح (واحد إنشاء، التاني replay)
    expect(succeeded[0].value.order.id).toBe(succeeded[1].value.order.id)
    expect(await getStock()).toBe(DEFAULT_STOCK - 5) // خُصم مرة واحدة بس رغم الطلبين
  })
})

describe('cancelOrder', () => {
  it('restores stock and records a cancel_restore movement', async () => {
    const { order } = await createOrder(baseInput(), null, nextKey())
    expect(await getStock()).toBe(DEFAULT_STOCK - 5)

    const result = await cancelOrder(order.id)
    expect(result).toEqual({ ok: true })
    expect(await getStock()).toBe(DEFAULT_STOCK)

    const { rows } = await pool.query('SELECT type, quantity_change FROM stock_movements WHERE order_id = $1 AND type = $2', [order.id, 'cancel_restore'])
    expect(rows).toHaveLength(1)
    expect(rows[0].quantity_change).toBe(5)
  })

  it('is idempotent — cancelling twice does not restore stock twice', async () => {
    const { order } = await createOrder(baseInput(), null, nextKey())
    await cancelOrder(order.id)
    await cancelOrder(order.id)
    expect(await getStock()).toBe(DEFAULT_STOCK)
  })

  it('rejects cancelling an order that does not exist', async () => {
    const result = await cancelOrder('00000000-0000-0000-0000-000000000000')
    expect(result).toEqual({ ok: false, error: 'order_not_found' })
  })

  it('blocks cancelling an order that is already delivered', async () => {
    const { order } = await createOrder(baseInput(), null, nextKey())
    await pool.query(`UPDATE orders SET status = 'delivered' WHERE id = $1`, [order.id])
    const result = await cancelOrder(order.id)
    expect(result).toEqual({ ok: false, error: 'invalid_status_transition' })
    expect(await getStock()).toBe(DEFAULT_STOCK - 5) // لم يُسترجع أي مخزون
  })
})

describe('guest order tracking token', () => {
  it('generates a guest tracking token only for orders with no logged-in user', async () => {
    const { order: guestOrder } = await createOrder(baseInput(), null, nextKey())
    expect(guestOrder.guestTrackingToken).toBeTruthy()
    expect(guestOrder.guestTrackingToken!.length).toBeGreaterThanOrEqual(24)

    const { order: userOrder } = await createOrder(baseInput(), USER_ID, nextKey())
    expect(userOrder.guestTrackingToken).toBeUndefined()
  })

  it('resolves a guest order with the correct token', async () => {
    const { order } = await createOrder(baseInput(), null, nextKey())
    const resolved = await getOrderByNumberForGuestToken(order.orderNumber, order.guestTrackingToken!)
    expect(resolved?.id).toBe(order.id)
  })

  it('rejects a wrong token for a real guest order', async () => {
    const { order } = await createOrder(baseInput(), null, nextKey())
    expect(await getOrderByNumberForGuestToken(order.orderNumber, 'not-the-real-token')).toBeNull()
  })

  it('rejects an empty token', async () => {
    const { order } = await createOrder(baseInput(), null, nextKey())
    expect(await getOrderByNumberForGuestToken(order.orderNumber, '')).toBeNull()
  })

  it('never resolves a logged-in user order via the guest-token path, even with a guessed value', async () => {
    const { order } = await createOrder(baseInput(), USER_ID, nextKey())
    expect(await getOrderByNumberForGuestToken(order.orderNumber, 'anything')).toBeNull()
  })

  it('returns null for an order number that does not exist', async () => {
    expect(await getOrderByNumberForGuestToken('ALA-000000', 'anything')).toBeNull()
  })
})

describe('order status history', () => {
  it('records a single system-sourced row on order creation, with no prior status', async () => {
    const { order } = await createOrder(baseInput(), USER_ID, nextKey())
    const history = await listOrderStatusHistory(order.id)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ fromStatus: null, toStatus: 'placed', source: 'system' })
  })

  it('appends an admin-sourced row on cancellation, preserving the creation row', async () => {
    const { order } = await createOrder(baseInput(), USER_ID, nextKey())
    await cancelOrder(order.id, USER_ID)
    const history = await listOrderStatusHistory(order.id)
    expect(history).toHaveLength(2)
    expect(history[1]).toMatchObject({ fromStatus: 'placed', toStatus: 'cancelled', source: 'admin' })
  })

  it('does not append a duplicate row when cancelling an already-cancelled order', async () => {
    const { order } = await createOrder(baseInput(), USER_ID, nextKey())
    await cancelOrder(order.id, USER_ID)
    await cancelOrder(order.id, USER_ID)
    const history = await listOrderStatusHistory(order.id)
    expect(history).toHaveLength(2)
  })

  it('attaches statusHistory to an order resolved via the guest-token tracking path', async () => {
    const { order } = await createOrder(baseInput(), null, nextKey())
    const resolved = await getOrderByNumberForGuestToken(order.orderNumber, order.guestTrackingToken!)
    expect(resolved?.statusHistory).toHaveLength(1)
    expect(resolved?.statusHistory?.[0]).toMatchObject({ fromStatus: null, toStatus: 'placed' })
  })
})
