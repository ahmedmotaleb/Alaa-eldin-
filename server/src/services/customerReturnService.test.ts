import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import {
  createCustomerReturn, getCustomerReturnById, updateCustomerReturnStatus, canTransitionCustomerReturnStatus
} from './customerReturnService.js'

const CATEGORY_ID = 'test-cat-cr'
const PRODUCT_ID = 'test-prod-cr'
const ORDER_ID = 'test-order-cr'
let orderItemId = 0

async function resetFixtures() {
  await pool.query('DELETE FROM customer_return_items')
  await pool.query('DELETE FROM customer_returns')
  await pool.query('DELETE FROM stock_movements WHERE product_id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM order_items WHERE order_id = $1', [ORDER_ID])
  await pool.query('DELETE FROM orders WHERE id = $1', [ORDER_ID])
  await pool.query('DELETE FROM products WHERE id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])

  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'cr-prod', $2, 'منتج مرتجع عميل', 'وصف', 20, 10, 'وحدة', '🧪', 1, 10, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO orders (id, order_number, customer_full_name, customer_mobile, customer_governorate, customer_address,
                          delivery_slot, payment_method, subtotal, delivery_fee, total, status, created_at)
     VALUES ($1, 'TEST-CR-1', 'عميل', '01012345678', 'القاهرة', 'عنوان', 'morning', 'cod', 100, 0, 100, 'delivered', now())`,
    [ORDER_ID]
  )
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO order_items (order_id, product_id, name, unit, unit_price, quantity, line_total)
     VALUES ($1, $2, 'منتج مرتجع عميل', 'وحدة', 20, 5, 100) RETURNING id`,
    [ORDER_ID, PRODUCT_ID]
  )
  orderItemId = rows[0].id
}

describe('customerReturnService', () => {
  beforeEach(resetFixtures)
  afterAll(async () => {
    await pool.query('DELETE FROM customer_return_items')
    await pool.query('DELETE FROM customer_returns')
    await pool.query('DELETE FROM stock_movements WHERE product_id = $1', [PRODUCT_ID])
    await pool.query('DELETE FROM order_items WHERE order_id = $1', [ORDER_ID])
    await pool.query('DELETE FROM orders WHERE id = $1', [ORDER_ID])
    await pool.query('DELETE FROM products WHERE id = $1', [PRODUCT_ID])
    await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  })

  it('creates a return request with a computed refund amount, no stock change yet', async () => {
    const result = await createCustomerReturn(
      { orderId: ORDER_ID, items: [{ orderItemId, productId: PRODUCT_ID, quantity: 2, condition: 'return_to_stock' }] },
      null
    )
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.returnNumber).toMatch(/^CR-\d+$/)
    expect(result.refundAmount).toBe(40) // 2 * 20
    expect(result.status).toBe('requested')

    const { rows } = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID])
    expect(rows[0].stock).toBe(10)
  })

  it('rejects a return exceeding the sold quantity', async () => {
    const result = await createCustomerReturn(
      { orderId: ORDER_ID, items: [{ orderItemId, productId: PRODUCT_ID, quantity: 10 }] },
      null
    )
    expect(result).toEqual({ error: 'exceeds_sold_quantity', orderItemId })
  })

  it('rejects a return against an order id that does not exist', async () => {
    const result = await createCustomerReturn(
      { orderId: 'no-such-order', items: [{ orderItemId, productId: PRODUCT_ID, quantity: 1 }] },
      null
    )
    expect(result).toEqual({ error: 'order_not_found' })
  })

  it('rejects a return whose order item id does not belong to the given order/product', async () => {
    const result = await createCustomerReturn(
      { orderId: ORDER_ID, items: [{ orderItemId: orderItemId + 999, productId: PRODUCT_ID, quantity: 1 }] },
      null
    )
    expect(result).toEqual({ error: 'order_item_mismatch', orderItemId: orderItemId + 999 })
  })

  it('rejects a return whose order item id belongs to the order but a different product', async () => {
    const result = await createCustomerReturn(
      { orderId: ORDER_ID, items: [{ orderItemId, productId: 'some-other-product', quantity: 1 }] },
      null
    )
    expect(result).toEqual({ error: 'order_item_mismatch', orderItemId })
  })

  it('rejects a second return that would push cumulative quantity over the sold amount', async () => {
    const first = await createCustomerReturn(
      { orderId: ORDER_ID, items: [{ orderItemId, productId: PRODUCT_ID, quantity: 3 }] },
      null
    )
    expect('error' in first).toBe(false)

    const second = await createCustomerReturn(
      { orderId: ORDER_ID, items: [{ orderItemId, productId: PRODUCT_ID, quantity: 3 }] },
      null
    )
    expect(second).toEqual({ error: 'exceeds_sold_quantity', orderItemId })
  })

  it('restocks only at "received", and only for return_to_stock items', async () => {
    const result = await createCustomerReturn(
      { orderId: ORDER_ID, items: [{ orderItemId, productId: PRODUCT_ID, quantity: 2, condition: 'return_to_stock' }] },
      null
    )
    expect('error' in result).toBe(false)
    if ('error' in result) return

    await updateCustomerReturnStatus(result.id, 'approved')
    const { rows: beforeReceived } = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID])
    expect(beforeReceived[0].stock).toBe(10) // لسه ماتأثرش

    await updateCustomerReturnStatus(result.id, 'received')
    const { rows: afterReceived } = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID])
    expect(afterReceived[0].stock).toBe(12)
  })

  it('never restocks a damaged item', async () => {
    const result = await createCustomerReturn(
      { orderId: ORDER_ID, items: [{ orderItemId, productId: PRODUCT_ID, quantity: 2, condition: 'damaged' }] },
      null
    )
    expect('error' in result).toBe(false)
    if ('error' in result) return

    await updateCustomerReturnStatus(result.id, 'approved')
    await updateCustomerReturnStatus(result.id, 'received')

    const { rows } = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID])
    expect(rows[0].stock).toBe(10) // ما اتزودش
  })

  it('does not auto-refund — refunded is a manual, explicit transition after received', async () => {
    const result = await createCustomerReturn(
      { orderId: ORDER_ID, items: [{ orderItemId, productId: PRODUCT_ID, quantity: 1 }] },
      null
    )
    expect('error' in result).toBe(false)
    if ('error' in result) return

    const directRefund = await updateCustomerReturnStatus(result.id, 'refunded')
    expect(directRefund).toEqual({ error: 'invalid_transition' })

    await updateCustomerReturnStatus(result.id, 'approved')
    await updateCustomerReturnStatus(result.id, 'received')
    const refunded = await updateCustomerReturnStatus(result.id, 'refunded')
    expect('error' in refunded).toBe(false)
  })

  it('fetches a return with its items', async () => {
    const result = await createCustomerReturn(
      { orderId: ORDER_ID, items: [{ orderItemId, productId: PRODUCT_ID, quantity: 1 }] },
      null
    )
    expect('error' in result).toBe(false)
    if ('error' in result) return
    const fetched = await getCustomerReturnById(result.id)
    expect(fetched?.items).toHaveLength(1)
    expect(fetched?.items[0].productName).toBe('منتج مرتجع عميل')
  })

  it('canTransitionCustomerReturnStatus matches service enforcement', () => {
    expect(canTransitionCustomerReturnStatus('requested', 'approved')).toBe(true)
    expect(canTransitionCustomerReturnStatus('requested', 'refunded')).toBe(false)
    expect(canTransitionCustomerReturnStatus('rejected', 'approved')).toBe(false)
  })
})
