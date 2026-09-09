import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { listFrequentlyPurchased } from './frequentlyPurchasedService.js'

const USER_ID = 'test-user-freq-1'
const OTHER_USER_ID = 'test-user-freq-2'
const CATEGORY_ID = 'test-cat-freq'
const PRODUCT_FREQUENT = 'test-prod-freq-a'
const PRODUCT_RARE = 'test-prod-freq-b'
const PRODUCT_NOW_HIDDEN = 'test-prod-freq-c'
const PRODUCT_ONLY_CANCELLED = 'test-prod-freq-d'

async function resetFixtures() {
  await pool.query('DELETE FROM stock_movements')
  await pool.query('DELETE FROM order_items')
  await pool.query('DELETE FROM orders')
  await pool.query('DELETE FROM products')
  await pool.query('DELETE FROM categories')
  await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [[USER_ID, OTHER_USER_ID]])

  for (const id of [USER_ID, OTHER_USER_ID]) {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, $2, 'x', 'عميل اختبار', now())`,
      [id, `${id}@test.local`]
    )
  }
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  const products = [
    { id: PRODUCT_FREQUENT, name: 'منتج متكرر', available: 1, stock: 20 },
    { id: PRODUCT_RARE, name: 'منتج نادر', available: 1, stock: 20 },
    { id: PRODUCT_NOW_HIDDEN, name: 'منتج بقى مخفي', available: 0, stock: 0 },
    { id: PRODUCT_ONLY_CANCELLED, name: 'منتج ملغى بس', available: 1, stock: 20 }
  ]
  for (const p of products) {
    await pool.query(
      `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
       VALUES ($1, $1, $2, $3, 'وصف', 25, 10, 'قطعة', '🧪', $4, $5, now())`,
      [p.id, CATEGORY_ID, p.name, p.available, p.stock]
    )
  }
}

async function insertOrder(orderId: string, userId: string, status: string, items: { productId: string, quantity: number }[]) {
  await pool.query(
    `INSERT INTO orders (id, order_number, user_id, created_at, delivery_slot, payment_method,
       customer_full_name, customer_mobile, customer_governorate, customer_address,
       subtotal, delivery_fee, total, status, discount_amount)
     VALUES ($1, $1, $2, now(), 'now', 'COD', 'عميل', '01012345678', 'القاهرة', 'عنوان', 100, 0, 100, $3, 0)`,
    [orderId, userId, status]
  )
  for (const item of items) {
    await pool.query(
      'INSERT INTO order_items (order_id, product_id, name, unit, unit_price, quantity, line_total) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [orderId, item.productId, 'اسم', 'قطعة', 25, item.quantity, 25 * item.quantity]
    )
  }
}

beforeEach(async () => {
  await resetFixtures()
})

afterAll(async () => {
  await pool.end()
})

describe('listFrequentlyPurchased', () => {
  it('ranks products by how often they were ordered, most frequent first', async () => {
    await insertOrder('freq-order-1', USER_ID, 'delivered', [{ productId: PRODUCT_FREQUENT, quantity: 1 }])
    await insertOrder('freq-order-2', USER_ID, 'delivered', [{ productId: PRODUCT_FREQUENT, quantity: 1 }])
    await insertOrder('freq-order-3', USER_ID, 'placed', [{ productId: PRODUCT_RARE, quantity: 1 }])

    const products = await listFrequentlyPurchased(USER_ID)
    expect(products.map(p => p.id)).toEqual([PRODUCT_FREQUENT, PRODUCT_RARE])
  })

  it('returns current prices, not the historical order price', async () => {
    await insertOrder('freq-order-4', USER_ID, 'delivered', [{ productId: PRODUCT_FREQUENT, quantity: 1 }])
    await pool.query('UPDATE products SET price = 999 WHERE id = $1', [PRODUCT_FREQUENT])
    const products = await listFrequentlyPurchased(USER_ID)
    expect(products[0].price).toBe(999)
  })

  it('excludes products that are no longer available', async () => {
    await insertOrder('freq-order-5', USER_ID, 'delivered', [{ productId: PRODUCT_NOW_HIDDEN, quantity: 1 }])
    const products = await listFrequentlyPurchased(USER_ID)
    expect(products.map(p => p.id)).not.toContain(PRODUCT_NOW_HIDDEN)
  })

  it('ignores cancelled orders entirely', async () => {
    await insertOrder('freq-order-6', USER_ID, 'cancelled', [{ productId: PRODUCT_ONLY_CANCELLED, quantity: 5 }])
    const products = await listFrequentlyPurchased(USER_ID)
    expect(products.map(p => p.id)).not.toContain(PRODUCT_ONLY_CANCELLED)
  })

  it('never includes another customer\'s order history', async () => {
    await insertOrder('freq-order-7', OTHER_USER_ID, 'delivered', [{ productId: PRODUCT_FREQUENT, quantity: 1 }])
    const products = await listFrequentlyPurchased(USER_ID)
    expect(products).toHaveLength(0)
  })
})
