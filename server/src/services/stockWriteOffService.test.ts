import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { pool } from '../db.js'
import { writeOffStock } from './stockWriteOffService.js'

const CATEGORY_ID = 'test-cat-writeoff'
const PRODUCT_ID = 'test-prod-writeoff'
const USER_ID = 'test-user-writeoff'

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
}

async function insertBatch(expiryDate: string | null, quantity: number) {
  const id = crypto.randomUUID()
  await pool.query(
    `INSERT INTO inventory_batches (id, product_id, quantity_received, quantity_remaining, unit_cost, expiry_date, created_at)
     VALUES ($1, $2, $3, $3, 5, $4, now())`,
    [id, PRODUCT_ID, quantity, expiryDate]
  )
  return id
}

async function resetFixtures() {
  await pool.query('DELETE FROM batch_consumptions')
  await pool.query('DELETE FROM stock_movements WHERE product_id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM inventory_batches WHERE product_id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM products WHERE id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])

  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'writeoff-prod', $2, 'منتج شطب', 'وصف', 10, 5, 'وحدة', '🧪', 1, 20, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at, is_admin, role)
     VALUES ($1, 'writeoff-tester@test.local', 'x', 'مختبر', now(), 1, 'admin')`,
    [USER_ID]
  )
}

describe('stockWriteOffService', () => {
  beforeEach(resetFixtures)
  afterAll(async () => {
    await pool.query('DELETE FROM batch_consumptions')
    await pool.query('DELETE FROM stock_movements WHERE product_id = $1', [PRODUCT_ID])
    await pool.query('DELETE FROM inventory_batches WHERE product_id = $1', [PRODUCT_ID])
    await pool.query('DELETE FROM products WHERE id = $1', [PRODUCT_ID])
    await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])
  })

  it('reduces product stock and records a movement with the reason and user', async () => {
    const result = await writeOffStock(USER_ID, { productId: PRODUCT_ID, quantity: 5, reason: 'damaged', note: 'كسر أثناء النقل' })
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.newStock).toBe(15)

    const { rows } = await pool.query(`SELECT * FROM stock_movements WHERE product_id = $1 ORDER BY id DESC LIMIT 1`, [PRODUCT_ID])
    expect(rows[0].type).toBe('damage')
    expect(rows[0].quantity_change).toBe(-5)
    expect(rows[0].created_by_user_id).toBe(USER_ID)
  })

  it('rejects a write-off larger than current stock', async () => {
    const result = await writeOffStock(USER_ID, { productId: PRODUCT_ID, quantity: 999, reason: 'lost' })
    expect(result).toEqual({ error: 'insufficient_stock' })

    const { rows } = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID])
    expect(rows[0].stock).toBe(20)
  })

  it('maps each reason to the correct stock_movements type', async () => {
    await writeOffStock(USER_ID, { productId: PRODUCT_ID, quantity: 1, reason: 'inventory_adjustment' })
    await writeOffStock(USER_ID, { productId: PRODUCT_ID, quantity: 1, reason: 'supplier_return' })
    await writeOffStock(USER_ID, { productId: PRODUCT_ID, quantity: 1, reason: 'expired' })

    const { rows } = await pool.query<{ type: string }>(
      `SELECT type FROM stock_movements WHERE product_id = $1 ORDER BY id ASC`, [PRODUCT_ID]
    )
    expect(rows.map(r => r.type)).toEqual(['adjustment', 'supplier_return', 'expired'])
  })

  it('for an "expired" write-off with no specific batch, consumes from expired batches first', async () => {
    const expiredBatch = await insertBatch(daysFromNow(-3), 5)
    const validBatch = await insertBatch(daysFromNow(30), 10)
    await pool.query('UPDATE products SET stock = 15 WHERE id = $1', [PRODUCT_ID])

    await writeOffStock(USER_ID, { productId: PRODUCT_ID, quantity: 5, reason: 'expired' })

    const { rows } = await pool.query<{ id: string, quantity_remaining: number }>(
      'SELECT id, quantity_remaining FROM inventory_batches WHERE product_id = $1', [PRODUCT_ID]
    )
    expect(rows.find(r => r.id === expiredBatch)?.quantity_remaining).toBe(0)
    expect(rows.find(r => r.id === validBatch)?.quantity_remaining).toBe(10)
  })

  it('writes off from a specific batch when batchId is provided', async () => {
    const batchA = await insertBatch(daysFromNow(10), 8)
    const batchB = await insertBatch(daysFromNow(20), 8)
    await pool.query('UPDATE products SET stock = 16 WHERE id = $1', [PRODUCT_ID])

    await writeOffStock(USER_ID, { productId: PRODUCT_ID, quantity: 3, reason: 'damaged', batchId: batchB })

    const { rows } = await pool.query<{ id: string, quantity_remaining: number }>(
      'SELECT id, quantity_remaining FROM inventory_batches WHERE product_id = $1', [PRODUCT_ID]
    )
    expect(rows.find(r => r.id === batchA)?.quantity_remaining).toBe(8)
    expect(rows.find(r => r.id === batchB)?.quantity_remaining).toBe(5)
  })

  it('rejects a non-positive quantity', async () => {
    const result = await writeOffStock(USER_ID, { productId: PRODUCT_ID, quantity: 0, reason: 'lost' })
    expect(result).toEqual({ error: 'invalid_quantity' })
  })
})
