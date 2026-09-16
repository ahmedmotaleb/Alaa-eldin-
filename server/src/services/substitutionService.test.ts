import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool, withTransaction } from '../db.js'
import { proposeSubstitution, respondToSubstitution } from './substitutionService.js'
import { restoreStockForCancelledOrder, deductStockForOrder } from './inventoryService.js'

const CATEGORY_ID = 'test-cat-sub'
const ORIGINAL_ID = 'test-prod-sub-original'
const REPLACEMENT_ID = 'test-prod-sub-replacement'
const UNAVAILABLE_REPLACEMENT_ID = 'test-prod-sub-unavailable'
const LOW_STOCK_REPLACEMENT_ID = 'test-prod-sub-lowstock'
const ORDER_ID = 'test-order-sub'
const USER_ID = 'test-user-sub'

async function insertOrder(preference: string, status = 'placed') {
  await pool.query(
    `INSERT INTO orders (id, order_number, created_at, delivery_slot, payment_method,
       customer_full_name, customer_mobile, customer_governorate, customer_address,
       subtotal, delivery_fee, total, status, discount_amount, substitution_preference)
     VALUES ($1, $1, now(), 'now', 'COD', 'عميل', '01012345678', 'القاهرة', 'عنوان', 100, 0, 100, $2, 0, $3)`,
    [ORDER_ID, status, preference]
  )
  await pool.query(
    `INSERT INTO order_items (order_id, product_id, name, unit, unit_price, quantity, line_total)
     VALUES ($1, $2, 'خبز', 'قطعة', 20, 5, 100)`,
    [ORDER_ID, ORIGINAL_ID]
  )
  const { rows } = await pool.query<{ id: number }>('SELECT id FROM order_items WHERE order_id = $1', [ORDER_ID])
  await withTransaction(client => deductStockForOrder(client, ORIGINAL_ID, 5, ORDER_ID))
  return rows[0].id
}

async function resetFixtures() {
  await pool.query('DELETE FROM stock_movements WHERE order_id = $1', [ORDER_ID])
  await pool.query('DELETE FROM order_items WHERE order_id = $1', [ORDER_ID])
  await pool.query('DELETE FROM orders WHERE id = $1', [ORDER_ID])
  await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])
  await pool.query('DELETE FROM products WHERE id IN ($1, $2, $3, $4)', [ORIGINAL_ID, REPLACEMENT_ID, UNAVAILABLE_REPLACEMENT_ID, LOW_STOCK_REPLACEMENT_ID])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])

  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`, [CATEGORY_ID])
  await pool.query(`INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, 'sub-test@example.com', 'x', 'مستخدم', now())`, [USER_ID])

  const products = [
    { id: ORIGINAL_ID, name: 'خبز توست', available: 1, stock: 20 },
    { id: REPLACEMENT_ID, name: 'خبز بلدي', available: 1, stock: 20 },
    { id: UNAVAILABLE_REPLACEMENT_ID, name: 'منتج مسحوب', available: 0, stock: 20 },
    { id: LOW_STOCK_REPLACEMENT_ID, name: 'منتج شحيح', available: 1, stock: 1 }
  ]
  for (const p of products) {
    await pool.query(
      `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
       VALUES ($1, $1, $2, $3, 'وصف', 20, 10, 'قطعة', '🧪', $4, $5, now())`,
      [p.id, CATEGORY_ID, p.name, p.available, p.stock]
    )
  }
}

async function stockOf(productId: string): Promise<number> {
  const { rows } = await pool.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [productId])
  return rows[0].stock
}

async function itemRow(itemId: number) {
  const { rows } = await pool.query(
    `SELECT picked_status as "pickedStatus", substitution_status as "substitutionStatus",
            replacement_product_id as "replacementProductId", replacement_quantity as "replacementQuantity"
     FROM order_items WHERE id = $1`,
    [itemId]
  )
  return rows[0]
}

beforeEach(resetFixtures)
afterAll(async () => {
  await resetFixtures()
  await pool.end()
})

describe('proposeSubstitution', () => {
  it('with contact_me preference, only marks the item as proposed without touching stock', async () => {
    const itemId = await insertOrder('contact_me')
    const stockBefore = await stockOf(REPLACEMENT_ID)

    const result = await proposeSubstitution(ORDER_ID, itemId, REPLACEMENT_ID, 5, USER_ID)
    expect(result).toEqual({ ok: true, status: 'proposed' })

    const item = await itemRow(itemId)
    expect(item.pickedStatus).toBe('pending')
    expect(item.substitutionStatus).toBe('proposed')
    expect(item.replacementProductId).toBe(REPLACEMENT_ID)
    expect(await stockOf(REPLACEMENT_ID)).toBe(stockBefore)
    expect(await stockOf(ORIGINAL_ID)).toBe(15) // اتخصم وقت إنشاء الطلب، لسه ما اترجعش
  })

  it('with replace_similar preference, auto-approves immediately and moves stock both ways', async () => {
    const itemId = await insertOrder('replace_similar')

    const result = await proposeSubstitution(ORDER_ID, itemId, REPLACEMENT_ID, 5, USER_ID)
    expect(result).toEqual({ ok: true, status: 'approved' })

    const item = await itemRow(itemId)
    expect(item.pickedStatus).toBe('substituted')
    expect(item.substitutionStatus).toBe('approved')

    expect(await stockOf(REPLACEMENT_ID)).toBe(15) // 20 - 5 (اتباع فعلياً)
    expect(await stockOf(ORIGINAL_ID)).toBe(20) // رجع لأصله (5 خصم أول الطلب + 5 استرجاع)
  })

  it('rejects when the order preference is remove_item', async () => {
    const itemId = await insertOrder('remove_item')
    const result = await proposeSubstitution(ORDER_ID, itemId, REPLACEMENT_ID, 5, USER_ID)
    expect(result).toEqual({ ok: false, error: 'preference_forbids_substitution' })
  })

  it('rejects proposing a substitute for an item that is not pending', async () => {
    const itemId = await insertOrder('contact_me')
    await pool.query(`UPDATE order_items SET picked_status = 'picked' WHERE id = $1`, [itemId])
    const result = await proposeSubstitution(ORDER_ID, itemId, REPLACEMENT_ID, 5, USER_ID)
    expect(result).toEqual({ ok: false, error: 'item_not_pending' })
  })

  it('rejects an unavailable replacement product', async () => {
    const itemId = await insertOrder('contact_me')
    const result = await proposeSubstitution(ORDER_ID, itemId, UNAVAILABLE_REPLACEMENT_ID, 1, USER_ID)
    expect(result).toEqual({ ok: false, error: 'replacement_unavailable' })
  })

  it('rejects insufficient replacement stock when auto-approving', async () => {
    const itemId = await insertOrder('replace_similar')
    const result = await proposeSubstitution(ORDER_ID, itemId, LOW_STOCK_REPLACEMENT_ID, 5, USER_ID)
    expect(result).toEqual({ ok: false, error: 'insufficient_stock' })
  })

  it('rejects replacing an item with the same product it already is', async () => {
    const itemId = await insertOrder('contact_me')
    const result = await proposeSubstitution(ORDER_ID, itemId, ORIGINAL_ID, 5, USER_ID)
    expect(result).toEqual({ ok: false, error: 'cannot_replace_with_same_product' })
  })
})

describe('respondToSubstitution', () => {
  it('approving a proposed substitution moves stock and marks it substituted', async () => {
    const itemId = await insertOrder('contact_me')
    await proposeSubstitution(ORDER_ID, itemId, REPLACEMENT_ID, 5, USER_ID)

    const result = await respondToSubstitution(ORDER_ID, itemId, 'approved')
    expect(result).toEqual({ ok: true })

    const item = await itemRow(itemId)
    expect(item.pickedStatus).toBe('substituted')
    expect(item.substitutionStatus).toBe('approved')
    expect(await stockOf(REPLACEMENT_ID)).toBe(15)
    expect(await stockOf(ORIGINAL_ID)).toBe(20)
  })

  it('rejecting a proposed substitution marks the item unavailable without moving stock', async () => {
    const itemId = await insertOrder('contact_me')
    await proposeSubstitution(ORDER_ID, itemId, REPLACEMENT_ID, 5, USER_ID)
    const stockBefore = await stockOf(REPLACEMENT_ID)

    const result = await respondToSubstitution(ORDER_ID, itemId, 'rejected')
    expect(result).toEqual({ ok: true })

    const item = await itemRow(itemId)
    expect(item.pickedStatus).toBe('unavailable')
    expect(item.substitutionStatus).toBe('rejected')
    expect(await stockOf(REPLACEMENT_ID)).toBe(stockBefore)
    expect(await stockOf(ORIGINAL_ID)).toBe(15)
  })

  it('rejects responding to an item with no pending substitution', async () => {
    const itemId = await insertOrder('contact_me')
    const result = await respondToSubstitution(ORDER_ID, itemId, 'approved')
    expect(result).toEqual({ ok: false, error: 'no_pending_substitution' })
  })

  it('cannot respond twice to the same proposal', async () => {
    const itemId = await insertOrder('contact_me')
    await proposeSubstitution(ORDER_ID, itemId, REPLACEMENT_ID, 5, USER_ID)
    await respondToSubstitution(ORDER_ID, itemId, 'approved')
    const second = await respondToSubstitution(ORDER_ID, itemId, 'approved')
    expect(second).toEqual({ ok: false, error: 'no_pending_substitution' })
  })
})

describe('order cancellation after an approved substitution', () => {
  it('restores the replacement product stock, not the original, and does not double-restore', async () => {
    const itemId = await insertOrder('replace_similar')
    await proposeSubstitution(ORDER_ID, itemId, REPLACEMENT_ID, 5, USER_ID)
    expect(await stockOf(REPLACEMENT_ID)).toBe(15)
    expect(await stockOf(ORIGINAL_ID)).toBe(20)

    await withTransaction(client => restoreStockForCancelledOrder(client, ORDER_ID))

    expect(await stockOf(REPLACEMENT_ID)).toBe(20) // البديل الفعلي بيترجع
    expect(await stockOf(ORIGINAL_ID)).toBe(20) // الأصلي فضل زي ما هو (اترجع بالفعل وقت الاعتماد)
  })
})
