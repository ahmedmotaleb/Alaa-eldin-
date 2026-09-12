import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { setItemPickedStatus, isValidPickedStatus } from './orderPickingService.js'

const CATEGORY_ID = 'test-cat-picking'
const PRODUCT_ID = 'test-prod-picking'
const ORDER_ID = 'test-order-picking'
const OTHER_ORDER_ID = 'test-order-picking-other'
let itemId: number
let otherOrderItemId: number

async function resetFixtures() {
  await pool.query('DELETE FROM order_items WHERE order_id = ANY($1::text[])', [[ORDER_ID, OTHER_ORDER_ID]])
  await pool.query('DELETE FROM orders WHERE id = ANY($1::text[])', [[ORDER_ID, OTHER_ORDER_ID]])
  await pool.query('DELETE FROM products WHERE id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])

  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة تجهيز', '🧪', '#fff', 1)`, [CATEGORY_ID])
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'picking-prod', $2, 'منتج تجهيز', 'وصف', 10, 5, 'وحدة', '🧪', 1, 20, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO orders (id, order_number, created_at, delivery_slot, payment_method, customer_full_name, customer_mobile, customer_address, subtotal, delivery_fee, total, status)
     VALUES ($1, $1, now(), 'now', 'cod', 'عميل اختبار', '01000000000', 'عنوان', 100, 10, 110, 'preparing')`,
    [ORDER_ID]
  )
  await pool.query(
    `INSERT INTO orders (id, order_number, created_at, delivery_slot, payment_method, customer_full_name, customer_mobile, customer_address, subtotal, delivery_fee, total, status)
     VALUES ($1, $1, now(), 'now', 'cod', 'عميل اختبار', '01000000000', 'عنوان', 100, 10, 110, 'preparing')`,
    [OTHER_ORDER_ID]
  )
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO order_items (order_id, product_id, name, unit, unit_price, quantity, line_total) VALUES ($1,$2,'اسم','وحدة',10,2,20) RETURNING id`,
    [ORDER_ID, PRODUCT_ID]
  )
  itemId = rows[0].id
  const { rows: otherRows } = await pool.query<{ id: number }>(
    `INSERT INTO order_items (order_id, product_id, name, unit, unit_price, quantity, line_total) VALUES ($1,$2,'اسم','وحدة',10,2,20) RETURNING id`,
    [OTHER_ORDER_ID, PRODUCT_ID]
  )
  otherOrderItemId = otherRows[0].id
}

describe('isValidPickedStatus', () => {
  it('accepts the four known statuses and rejects anything else', () => {
    expect(isValidPickedStatus('pending')).toBe(true)
    expect(isValidPickedStatus('picked')).toBe(true)
    expect(isValidPickedStatus('substituted')).toBe(true)
    expect(isValidPickedStatus('unavailable')).toBe(true)
    expect(isValidPickedStatus('delivered')).toBe(false)
    expect(isValidPickedStatus(123)).toBe(false)
  })
})

describe('setItemPickedStatus', () => {
  beforeEach(resetFixtures)
  afterAll(resetFixtures)

  it('updates the picked status and note for an item belonging to the order', async () => {
    const result = await setItemPickedStatus(ORDER_ID, itemId, 'substituted', '  استبدال بنوع تاني  ')
    expect(result).toEqual({ ok: true })

    const { rows } = await pool.query<{ pickedStatus: string; pickedNote: string }>(
      'SELECT picked_status as "pickedStatus", picked_note as "pickedNote" FROM order_items WHERE id = $1',
      [itemId]
    )
    expect(rows[0].pickedStatus).toBe('substituted')
    expect(rows[0].pickedNote).toBe('استبدال بنوع تاني')
  })

  it('refuses to update an item that belongs to a different order', async () => {
    const result = await setItemPickedStatus(ORDER_ID, otherOrderItemId, 'picked', '')
    expect(result).toEqual({ error: 'item_not_found' })

    const { rows } = await pool.query<{ pickedStatus: string }>(
      'SELECT picked_status as "pickedStatus" FROM order_items WHERE id = $1',
      [otherOrderItemId]
    )
    expect(rows[0].pickedStatus).toBe('pending')
  })

  it('returns item_not_found for a non-existent item id', async () => {
    const result = await setItemPickedStatus(ORDER_ID, 999999, 'picked', '')
    expect(result).toEqual({ error: 'item_not_found' })
  })
})
