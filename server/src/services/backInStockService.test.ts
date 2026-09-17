import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { pool, withTransaction } from '../db.js'
import {
  subscribeToBackInStock, unsubscribeFromBackInStock, isSubscribedToBackInStock, notifyBackInStockIfNeeded
} from './backInStockService.js'
import * as pushService from './pushService.js'

const USER_A = 'test-user-bis-a'
const USER_B = 'test-user-bis-b'
const CATEGORY_ID = 'test-cat-bis'
const PRODUCT_ID = 'test-prod-bis'
const OTHER_PRODUCT_ID = 'test-prod-bis-other'

async function insertUser(id: string) {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, $1 || '@test.local', 'x', 'عميل اختبار', now())`,
    [id]
  )
}

async function setProductStock(id: string, stock: number, available = true) {
  await pool.query('UPDATE products SET stock = $1, available = $2 WHERE id = $3', [stock, available ? 1 : 0, id])
}

async function resetFixtures() {
  await pool.query('DELETE FROM back_in_stock_subscriptions')
  await pool.query('DELETE FROM order_items')
  await pool.query('DELETE FROM orders')
  await pool.query('DELETE FROM products')
  await pool.query('DELETE FROM categories')
  await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [USER_A, USER_B])
  await insertUser(USER_A)
  await insertUser(USER_B)
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'bis-product', $2, 'منتج اختبار', 'وصف', 10, 5, 'قطعة', '🧪', 1, 0, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'bis-product-other', $2, 'منتج تاني', 'وصف', 10, 5, 'قطعة', '🧪', 1, 0, now())`,
    [OTHER_PRODUCT_ID, CATEGORY_ID]
  )
}

beforeEach(async () => {
  await resetFixtures()
  vi.restoreAllMocks()
})

afterAll(async () => {
  await pool.end()
})

describe('subscribeToBackInStock / unsubscribeFromBackInStock / isSubscribedToBackInStock', () => {
  it('subscribes and reports subscription status correctly', async () => {
    expect(await isSubscribedToBackInStock(USER_A, PRODUCT_ID)).toBe(false)
    await subscribeToBackInStock(USER_A, PRODUCT_ID)
    expect(await isSubscribedToBackInStock(USER_A, PRODUCT_ID)).toBe(true)
  })

  it('subscribing twice for the same product does not create a duplicate row', async () => {
    await subscribeToBackInStock(USER_A, PRODUCT_ID)
    await subscribeToBackInStock(USER_A, PRODUCT_ID)
    const { rows } = await pool.query('SELECT count(*) as n FROM back_in_stock_subscriptions WHERE user_id = $1 AND product_id = $2', [USER_A, PRODUCT_ID])
    expect(Number(rows[0].n)).toBe(1)
  })

  it('unsubscribes cleanly', async () => {
    await subscribeToBackInStock(USER_A, PRODUCT_ID)
    await unsubscribeFromBackInStock(USER_A, PRODUCT_ID)
    expect(await isSubscribedToBackInStock(USER_A, PRODUCT_ID)).toBe(false)
  })
})

describe('notifyBackInStockIfNeeded', () => {
  it('sends a push to every subscriber and clears the subscriptions once stock is positive', async () => {
    const spy = vi.spyOn(pushService, 'sendPushToUser').mockResolvedValue(undefined)
    await subscribeToBackInStock(USER_A, PRODUCT_ID)
    await subscribeToBackInStock(USER_B, PRODUCT_ID)
    await setProductStock(PRODUCT_ID, 5)

    await withTransaction(client => notifyBackInStockIfNeeded(client, PRODUCT_ID))

    expect(spy).toHaveBeenCalledTimes(2)
    const notifiedUsers = spy.mock.calls.map(call => call[0]).sort()
    expect(notifiedUsers).toEqual([USER_A, USER_B].sort())
    expect(await isSubscribedToBackInStock(USER_A, PRODUCT_ID)).toBe(false)
    expect(await isSubscribedToBackInStock(USER_B, PRODUCT_ID)).toBe(false)
  })

  it('does nothing when stock is still zero', async () => {
    const spy = vi.spyOn(pushService, 'sendPushToUser').mockResolvedValue(undefined)
    await subscribeToBackInStock(USER_A, PRODUCT_ID)
    await withTransaction(client => notifyBackInStockIfNeeded(client, PRODUCT_ID))
    expect(spy).not.toHaveBeenCalled()
    expect(await isSubscribedToBackInStock(USER_A, PRODUCT_ID)).toBe(true)
  })

  it('does nothing when the product is hidden (unavailable) even if stock is positive', async () => {
    const spy = vi.spyOn(pushService, 'sendPushToUser').mockResolvedValue(undefined)
    await subscribeToBackInStock(USER_A, PRODUCT_ID)
    await setProductStock(PRODUCT_ID, 5, false)
    await withTransaction(client => notifyBackInStockIfNeeded(client, PRODUCT_ID))
    expect(spy).not.toHaveBeenCalled()
  })

  it('is safe to call repeatedly once already notified — no duplicate sends', async () => {
    const spy = vi.spyOn(pushService, 'sendPushToUser').mockResolvedValue(undefined)
    await subscribeToBackInStock(USER_A, PRODUCT_ID)
    await setProductStock(PRODUCT_ID, 5)
    await withTransaction(client => notifyBackInStockIfNeeded(client, PRODUCT_ID))
    await withTransaction(client => notifyBackInStockIfNeeded(client, PRODUCT_ID))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('only notifies subscribers of the specific product that came back in stock', async () => {
    const spy = vi.spyOn(pushService, 'sendPushToUser').mockResolvedValue(undefined)
    await subscribeToBackInStock(USER_A, PRODUCT_ID)
    await subscribeToBackInStock(USER_B, OTHER_PRODUCT_ID)
    await setProductStock(PRODUCT_ID, 5)

    await withTransaction(client => notifyBackInStockIfNeeded(client, PRODUCT_ID))

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(USER_A, expect.anything())
    expect(await isSubscribedToBackInStock(USER_B, OTHER_PRODUCT_ID)).toBe(true)
  })
})
