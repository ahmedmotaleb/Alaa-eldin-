import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { pool, withTransaction } from '../db.js'
import { lockProductsForOrder, deductStockForOrder, restoreStockForCancelledOrder } from './inventoryService.js'
import { getSellableStock } from './inventoryBatchService.js'

const CATEGORY_ID = 'test-cat-fefo'
const PRODUCT_ID = 'test-prod-fefo'
const PRODUCT_NO_BATCH_ID = 'test-prod-no-batch'
const ORDER_ID = 'test-order-fefo'

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
}

async function insertBatch(expiryDate: string | null, quantity: number, unitCost = 5) {
  const id = crypto.randomUUID()
  await pool.query(
    `INSERT INTO inventory_batches (id, product_id, quantity_received, quantity_remaining, unit_cost, expiry_date, created_at)
     VALUES ($1, $2, $3, $3, $4, $5, now())`,
    [id, PRODUCT_ID, quantity, unitCost, expiryDate]
  )
  return id
}

async function resetFixtures() {
  await pool.query('DELETE FROM batch_consumptions')
  await pool.query('DELETE FROM stock_movements WHERE product_id IN ($1, $2)', [PRODUCT_ID, PRODUCT_NO_BATCH_ID])
  await pool.query('DELETE FROM inventory_batches WHERE product_id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM order_items WHERE order_id = $1', [ORDER_ID])
  await pool.query('DELETE FROM orders WHERE id = $1', [ORDER_ID])
  await pool.query('DELETE FROM products WHERE id IN ($1, $2)', [PRODUCT_ID, PRODUCT_NO_BATCH_ID])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])

  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'fefo-prod', $2, 'منتج FEFO', 'وصف', 10, 5, 'وحدة', '🧪', 1, 0, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'no-batch-prod', $2, 'منتج بدون دفعات', 'وصف', 10, 5, 'وحدة', '🧪', 1, 30, now())`,
    [PRODUCT_NO_BATCH_ID, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO orders (id, order_number, customer_full_name, customer_mobile, customer_governorate, customer_address,
                          delivery_slot, payment_method, subtotal, delivery_fee, total, status, created_at)
     VALUES ($1, 'TEST-FEFO-1', 'عميل', '01012345678', 'القاهرة', 'عنوان', 'morning', 'cod', 70, 0, 70, 'placed', now())`,
    [ORDER_ID]
  )
}

describe('FEFO consumption and sellable stock', () => {
  beforeEach(resetFixtures)
  afterAll(async () => {
    await pool.query('DELETE FROM batch_consumptions')
    await pool.query('DELETE FROM stock_movements WHERE product_id IN ($1, $2)', [PRODUCT_ID, PRODUCT_NO_BATCH_ID])
    await pool.query('DELETE FROM inventory_batches WHERE product_id = $1', [PRODUCT_ID])
    await pool.query('DELETE FROM order_items WHERE order_id = $1', [ORDER_ID])
    await pool.query('DELETE FROM orders WHERE id = $1', [ORDER_ID])
    await pool.query('DELETE FROM products WHERE id IN ($1, $2)', [PRODUCT_ID, PRODUCT_NO_BATCH_ID])
    await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  })

  it('getSellableStock returns null for a product with no batches (legacy fallback)', async () => {
    const sellable = await withTransaction(client => getSellableStock(client, PRODUCT_NO_BATCH_ID))
    expect(sellable).toBeNull()
  })

  it('getSellableStock excludes expired batches from the total', async () => {
    await pool.query('UPDATE products SET stock = 15 WHERE id = $1', [PRODUCT_ID])
    await insertBatch(daysFromNow(-5), 5) // expired — excluded
    await insertBatch(daysFromNow(30), 10) // valid — included
    const sellable = await withTransaction(client => getSellableStock(client, PRODUCT_ID))
    expect(sellable).toBe(10)
  })

  it('lockProductsForOrder reports sellable (not raw) stock for a batch-tracked product', async () => {
    await pool.query('UPDATE products SET stock = 15 WHERE id = $1', [PRODUCT_ID])
    await insertBatch(daysFromNow(-1), 5)
    await insertBatch(daysFromNow(10), 10)
    const locked = await withTransaction(client => lockProductsForOrder(client, [PRODUCT_ID]))
    expect(locked.get(PRODUCT_ID)?.stock).toBe(10)
  })

  it('lockProductsForOrder falls back to raw stock for a product with no batches', async () => {
    const locked = await withTransaction(client => lockProductsForOrder(client, [PRODUCT_NO_BATCH_ID]))
    expect(locked.get(PRODUCT_NO_BATCH_ID)?.stock).toBe(30)
  })

  it('deductStockForOrder consumes the earliest-expiring batch first (FEFO)', async () => {
    await pool.query('UPDATE products SET stock = 15 WHERE id = $1', [PRODUCT_ID])
    const soon = await insertBatch(daysFromNow(5), 5)
    const later = await insertBatch(daysFromNow(30), 10)

    await withTransaction(client => deductStockForOrder(client, PRODUCT_ID, 7, ORDER_ID))

    const { rows: batches } = await pool.query<{ id: string, quantity_remaining: number }>(
      'SELECT id, quantity_remaining FROM inventory_batches WHERE product_id = $1 ORDER BY expiry_date', [PRODUCT_ID]
    )
    const soonBatch = batches.find(b => b.id === soon)
    const laterBatch = batches.find(b => b.id === later)
    expect(soonBatch?.quantity_remaining).toBe(0) // 5 اتاخدوا بالكامل الأول
    expect(laterBatch?.quantity_remaining).toBe(8) // 2 بس من التانية (7-5)
  })

  it('never consumes from an expired batch during a sale', async () => {
    await pool.query('UPDATE products SET stock = 15 WHERE id = $1', [PRODUCT_ID])
    const expired = await insertBatch(daysFromNow(-2), 5)
    await insertBatch(daysFromNow(20), 10)

    await withTransaction(client => deductStockForOrder(client, PRODUCT_ID, 3, ORDER_ID))

    const { rows } = await pool.query<{ quantity_remaining: number }>('SELECT quantity_remaining FROM inventory_batches WHERE id = $1', [expired])
    expect(rows[0].quantity_remaining).toBe(5) // ما اتلمسش خالص
  })

  it('restores the exact consumed batches when an order is cancelled', async () => {
    await pool.query('UPDATE products SET stock = 15 WHERE id = $1', [PRODUCT_ID])
    const b1 = await insertBatch(daysFromNow(5), 5)
    const b2 = await insertBatch(daysFromNow(30), 10)

    await pool.query(
      `INSERT INTO order_items (order_id, product_id, name, unit, unit_price, quantity, line_total)
       VALUES ($1, $2, 'منتج FEFO', 'وحدة', 10, 7, 70)`,
      [ORDER_ID, PRODUCT_ID]
    )

    await withTransaction(client => deductStockForOrder(client, PRODUCT_ID, 7, ORDER_ID))
    await withTransaction(client => restoreStockForCancelledOrder(client, ORDER_ID))

    const { rows: batches } = await pool.query<{ id: string, quantity_remaining: number }>(
      'SELECT id, quantity_remaining FROM inventory_batches WHERE product_id = $1', [PRODUCT_ID]
    )
    expect(batches.find(b => b.id === b1)?.quantity_remaining).toBe(5)
    expect(batches.find(b => b.id === b2)?.quantity_remaining).toBe(10)
  })
})
