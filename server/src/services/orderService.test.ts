// اختبارات تكامل حقيقية — بتتصل بقاعدة بيانات اختبار فعلية (Postgres محلي، راجع
// vitest.config.ts) وبتنفّذ نفس منطق orderService الحقيقي بمعاملاته وأقفاله، مش نسخة
// مُقلَّدة. هي الطريقة الوحيدة اللي تثبت فعلياً إن قفل الصفوف (FOR UPDATE) وحماية السباق
// على الخصومات والمخزون بيشتغلوا صح تحت تزامن حقيقي.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { createOrder, cancelOrder, getOrderByNumberForGuestToken } from './orderService.js'
import type { CheckoutInput } from '../checkoutValidation.js'

const CATEGORY_ID = 'test-cat'
const PRODUCT_ID = 'test-prod-1'
const PRODUCT_PRICE = 38
const DEFAULT_STOCK = 100
const USER_ID = 'test-user-order-1'

async function resetFixtures() {
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
  await pool.query(
    `INSERT INTO store_settings (id, name, whatsapp_number, currency, minimum_order, free_shipping_threshold, delivery_fee)
     VALUES (1, 'متجر اختبار', '20100', 'ج.م', 100, 500, 30)`
  )

  // delivery_zones/delivery_slots مش بيتمسحوا هنا (بيانات مرجعية دائمة اتزرعت بالـ migration،
  // مش fixture لكل اختبار) — بس الصفوف اللي اختبارات الملف ده بتلعب فيها بترجع لحالتها الافتراضية
  // عشان أي تعديل (تعطيل/تغيير رسم) من اختبار سابق ميأثرش على الاختبار الجاي أو ملفات تانية.
  await pool.query(`UPDATE delivery_zones SET delivery_fee = 30, is_active = 1 WHERE governorate = 'القاهرة'`)
  await pool.query(`UPDATE delivery_slots SET is_active = 1 WHERE id = 'now'`)
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
    paymentMethod: 'COD',
    customer: { fullName: 'عميل اختبار', mobile: '01012345678', governorate: 'القاهرة', address: 'شارع 1' },
    items: [{ productId: PRODUCT_ID, quantity: 5 }],
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

describe('createOrder — discount handling', () => {
  async function makeDiscount(overrides: Partial<{ type: string, value: number, maxUses: number | null, active: number, minOrder: number }> = {}) {
    const { type = 'fixed', value = 20, maxUses = null, active = 1, minOrder = 0 } = overrides
    await pool.query(
      `INSERT INTO discounts (code, type, value, min_order, max_uses, used_count, active, created_at)
       VALUES ('TESTCODE', $1, $2, $3, $4, 0, $5, now())`,
      [type, value, minOrder, maxUses, active]
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
