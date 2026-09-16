import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { getFrequentlyBoughtTogether, clearFrequentlyBoughtTogetherCache } from './catalogService.js'

const CATEGORY_ID = 'test-cat-fbt'
const PRODUCT_MAIN = 'test-prod-fbt-main'
const PRODUCT_COMMON_PAIR = 'test-prod-fbt-common'
const PRODUCT_RARE_PAIR = 'test-prod-fbt-rare'
const PRODUCT_HIDDEN_PAIR = 'test-prod-fbt-hidden'
const PRODUCT_UNRELATED = 'test-prod-fbt-unrelated'

async function resetFixtures() {
  await pool.query('DELETE FROM stock_movements')
  await pool.query('DELETE FROM order_items')
  await pool.query('DELETE FROM orders')
  await pool.query('DELETE FROM products')
  await pool.query('DELETE FROM categories')

  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  const products = [
    { id: PRODUCT_MAIN, name: 'منتج أساسي', available: 1, stock: 20 },
    { id: PRODUCT_COMMON_PAIR, name: 'منتج مرافق شائع', available: 1, stock: 20 },
    { id: PRODUCT_RARE_PAIR, name: 'منتج مرافق نادر', available: 1, stock: 20 },
    { id: PRODUCT_HIDDEN_PAIR, name: 'منتج مرافق بقى مخفي', available: 0, stock: 0 },
    { id: PRODUCT_UNRELATED, name: 'منتج غير مرتبط', available: 1, stock: 20 }
  ]
  for (const p of products) {
    await pool.query(
      `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
       VALUES ($1, $1, $2, $3, 'وصف', 25, 10, 'قطعة', '🧪', $4, $5, now())`,
      [p.id, CATEGORY_ID, p.name, p.available, p.stock]
    )
  }
}

async function insertOrder(orderId: string, status: string, productIds: string[]) {
  await pool.query(
    `INSERT INTO orders (id, order_number, created_at, delivery_slot, payment_method,
       customer_full_name, customer_mobile, customer_governorate, customer_address,
       subtotal, delivery_fee, total, status, discount_amount)
     VALUES ($1, $1, now(), 'now', 'COD', 'عميل', '01012345678', 'القاهرة', 'عنوان', 100, 0, 100, $2, 0)`,
    [orderId, status]
  )
  for (const productId of productIds) {
    await pool.query(
      'INSERT INTO order_items (order_id, product_id, name, unit, unit_price, quantity, line_total) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [orderId, productId, 'اسم', 'قطعة', 25, 1, 25]
    )
  }
}

beforeEach(async () => {
  await resetFixtures()
  clearFrequentlyBoughtTogetherCache()
})

afterAll(async () => {
  await pool.end()
})

describe('getFrequentlyBoughtTogether', () => {
  it('ranks co-purchased products by how often they appear in the same order, most frequent first', async () => {
    await insertOrder('fbt-order-1', 'delivered', [PRODUCT_MAIN, PRODUCT_COMMON_PAIR])
    await insertOrder('fbt-order-2', 'delivered', [PRODUCT_MAIN, PRODUCT_COMMON_PAIR])
    await insertOrder('fbt-order-3', 'delivered', [PRODUCT_MAIN, PRODUCT_COMMON_PAIR])
    await insertOrder('fbt-order-4', 'delivered', [PRODUCT_MAIN, PRODUCT_RARE_PAIR])
    await insertOrder('fbt-order-5', 'delivered', [PRODUCT_MAIN, PRODUCT_RARE_PAIR])

    const results = await getFrequentlyBoughtTogether(PRODUCT_MAIN)
    expect(results.map(p => p.id)).toEqual([PRODUCT_COMMON_PAIR, PRODUCT_RARE_PAIR])
  })

  it('applies a minimum co-occurrence threshold so a single coincidental order is not treated as a real association', async () => {
    // مرة واحدة بس مع منتج مرتبط "نادر" — مش كافي إحصائياً، ميظهرش كتوصية.
    await insertOrder('fbt-order-6', 'delivered', [PRODUCT_MAIN, PRODUCT_RARE_PAIR])

    const results = await getFrequentlyBoughtTogether(PRODUCT_MAIN)
    expect(results.map(p => p.id)).not.toContain(PRODUCT_RARE_PAIR)
  })

  it('excludes products that are no longer available', async () => {
    await insertOrder('fbt-order-7', 'delivered', [PRODUCT_MAIN, PRODUCT_HIDDEN_PAIR])
    await insertOrder('fbt-order-8', 'delivered', [PRODUCT_MAIN, PRODUCT_HIDDEN_PAIR])

    const results = await getFrequentlyBoughtTogether(PRODUCT_MAIN)
    expect(results.map(p => p.id)).not.toContain(PRODUCT_HIDDEN_PAIR)
  })

  it('never recommends the product itself', async () => {
    await insertOrder('fbt-order-9', 'delivered', [PRODUCT_MAIN, PRODUCT_COMMON_PAIR])
    await insertOrder('fbt-order-10', 'delivered', [PRODUCT_MAIN, PRODUCT_COMMON_PAIR])

    const results = await getFrequentlyBoughtTogether(PRODUCT_MAIN)
    expect(results.map(p => p.id)).not.toContain(PRODUCT_MAIN)
  })

  it('ignores cancelled orders entirely when computing associations', async () => {
    await insertOrder('fbt-order-11', 'cancelled', [PRODUCT_MAIN, PRODUCT_COMMON_PAIR])
    await insertOrder('fbt-order-12', 'cancelled', [PRODUCT_MAIN, PRODUCT_COMMON_PAIR])

    const results = await getFrequentlyBoughtTogether(PRODUCT_MAIN)
    expect(results.map(p => p.id)).not.toContain(PRODUCT_COMMON_PAIR)
  })

  it('does not recommend a product that was never actually purchased alongside it', async () => {
    await insertOrder('fbt-order-13', 'delivered', [PRODUCT_MAIN, PRODUCT_COMMON_PAIR])
    await insertOrder('fbt-order-14', 'delivered', [PRODUCT_UNRELATED])

    const results = await getFrequentlyBoughtTogether(PRODUCT_MAIN)
    expect(results.map(p => p.id)).not.toContain(PRODUCT_UNRELATED)
  })

  it('respects the requested result limit', async () => {
    await insertOrder('fbt-order-15', 'delivered', [PRODUCT_MAIN, PRODUCT_COMMON_PAIR])
    await insertOrder('fbt-order-16', 'delivered', [PRODUCT_MAIN, PRODUCT_COMMON_PAIR])
    await insertOrder('fbt-order-17', 'delivered', [PRODUCT_MAIN, PRODUCT_RARE_PAIR])
    await insertOrder('fbt-order-18', 'delivered', [PRODUCT_MAIN, PRODUCT_RARE_PAIR])

    const results = await getFrequentlyBoughtTogether(PRODUCT_MAIN, 1)
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe(PRODUCT_COMMON_PAIR)
  })

  it('returns an empty array when the product has no order history at all', async () => {
    const results = await getFrequentlyBoughtTogether(PRODUCT_MAIN)
    expect(results).toEqual([])
  })
})
