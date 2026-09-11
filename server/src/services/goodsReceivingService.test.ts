import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { createPurchaseOrder, updatePurchaseOrderStatus, getPurchaseOrderById } from './purchaseOrderService.js'
import { receiveGoodsForPurchaseOrder, getGoodsReceiptById } from './goodsReceivingService.js'

const CATEGORY_ID = 'test-cat-gr'
const PRODUCT_ID = 'test-prod-gr-1'
const PRODUCT_EXPIRY_ID = 'test-prod-gr-expiry'
const SUPPLIER_ID = 'test-supplier-gr'
const USER_ID = 'test-user-gr'

async function resetFixtures() {
  await pool.query('DELETE FROM product_cost_history')
  await pool.query('DELETE FROM inventory_batches')
  await pool.query('DELETE FROM goods_receipt_items')
  await pool.query('DELETE FROM goods_receipts')
  await pool.query('DELETE FROM purchase_order_items')
  await pool.query('DELETE FROM purchase_orders')
  await pool.query('DELETE FROM stock_movements WHERE product_id IN ($1, $2)', [PRODUCT_ID, PRODUCT_EXPIRY_ID])
  await pool.query('DELETE FROM suppliers WHERE id = $1', [SUPPLIER_ID])
  await pool.query('DELETE FROM products WHERE id IN ($1, $2)', [PRODUCT_ID, PRODUCT_EXPIRY_ID])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])

  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at, tracks_expiry)
     VALUES ($1, 'gr-prod-1', $2, 'منتج 1', 'وصف', 10, 5, 'وحدة', '🧪', 1, 20, now(), 0)`,
    [PRODUCT_ID, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at, tracks_expiry)
     VALUES ($1, 'gr-prod-expiry', $2, 'منتج متابَع الصلاحية', 'وصف', 15, 6, 'وحدة', '🧪', 1, 0, now(), 1)`,
    [PRODUCT_EXPIRY_ID, CATEGORY_ID]
  )
  await pool.query(`INSERT INTO suppliers (id, name) VALUES ($1, 'مورد اختبار الاستلام')`, [SUPPLIER_ID])
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at, is_admin, role)
     VALUES ($1, 'gr-tester@test.local', 'x', 'مختبر', now(), 1, 'admin')`,
    [USER_ID]
  )
}

async function makeSubmittedPO(items: Array<{ productId: string, orderedQty: number, unitCost: number }>) {
  const order = await createPurchaseOrder({ supplierId: SUPPLIER_ID, items }, USER_ID)
  await updatePurchaseOrderStatus(order.id, 'submitted')
  return order
}

describe('goodsReceivingService', () => {
  beforeEach(resetFixtures)
  afterAll(async () => {
    await pool.query('DELETE FROM product_cost_history')
    await pool.query('DELETE FROM inventory_batches')
    await pool.query('DELETE FROM goods_receipt_items')
    await pool.query('DELETE FROM goods_receipts')
    await pool.query('DELETE FROM purchase_order_items')
    await pool.query('DELETE FROM purchase_orders')
    await pool.query('DELETE FROM stock_movements WHERE product_id IN ($1, $2)', [PRODUCT_ID, PRODUCT_EXPIRY_ID])
    await pool.query('DELETE FROM suppliers WHERE id = $1', [SUPPLIER_ID])
    await pool.query('DELETE FROM products WHERE id IN ($1, $2)', [PRODUCT_ID, PRODUCT_EXPIRY_ID])
    await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])
  })

  it('receives full quantity, closes the PO, and increases stock atomically', async () => {
    const order = await makeSubmittedPO([{ productId: PRODUCT_ID, orderedQty: 10, unitCost: 4.5 }])
    const result = await receiveGoodsForPurchaseOrder(
      { purchaseOrderId: order.id, items: [{ productId: PRODUCT_ID, quantity: 10, unitCost: 4.5 }] },
      USER_ID
    )
    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(result.receipt.receiptNumber).toMatch(/^GR-\d+$/)
    const { rows: productRows } = await pool.query<{ stock: number, cost: number }>('SELECT stock, cost FROM products WHERE id = $1', [PRODUCT_ID])
    expect(productRows[0].stock).toBe(30) // 20 + 10
    expect(productRows[0].cost).toBe(4.5)

    const poResult = await getPurchaseOrderById(order.id)
    expect(poResult?.order.status).toBe('received')
    expect(poResult?.items[0].receivedQty).toBe(10)
  })

  it('creates a stock movement, an inventory batch, and a cost history row', async () => {
    const order = await makeSubmittedPO([{ productId: PRODUCT_ID, orderedQty: 5, unitCost: 3 }])
    const result = await receiveGoodsForPurchaseOrder(
      { purchaseOrderId: order.id, items: [{ productId: PRODUCT_ID, quantity: 5, unitCost: 3 }] },
      USER_ID
    )
    expect('error' in result).toBe(false)
    if ('error' in result) return

    const { rows: movements } = await pool.query(
      `SELECT * FROM stock_movements WHERE product_id = $1 AND type = 'restock' ORDER BY id DESC LIMIT 1`,
      [PRODUCT_ID]
    )
    expect(movements[0].quantity_change).toBe(5)

    const { rows: batches } = await pool.query('SELECT * FROM inventory_batches WHERE product_id = $1', [PRODUCT_ID])
    expect(batches).toHaveLength(1)
    expect(batches[0].quantity_remaining).toBe(5)

    const { rows: costHistory } = await pool.query('SELECT * FROM product_cost_history WHERE product_id = $1', [PRODUCT_ID])
    expect(costHistory).toHaveLength(1)
    expect(costHistory[0].source_type).toBe('purchase_receipt')
  })

  it('supports partial receiving, leaving the PO partially_received', async () => {
    const order = await makeSubmittedPO([{ productId: PRODUCT_ID, orderedQty: 10, unitCost: 4 }])
    const result = await receiveGoodsForPurchaseOrder(
      { purchaseOrderId: order.id, items: [{ productId: PRODUCT_ID, quantity: 6, unitCost: 4 }] },
      USER_ID
    )
    expect('error' in result).toBe(false)

    const poResult = await getPurchaseOrderById(order.id)
    expect(poResult?.order.status).toBe('partially_received')
    expect(poResult?.items[0].receivedQty).toBe(6)

    // استلام الباقي بعدين يقفل الأمر بالكامل
    const second = await receiveGoodsForPurchaseOrder(
      { purchaseOrderId: order.id, items: [{ productId: PRODUCT_ID, quantity: 4, unitCost: 4 }] },
      USER_ID
    )
    expect('error' in second).toBe(false)
    const finalPo = await getPurchaseOrderById(order.id)
    expect(finalPo?.order.status).toBe('received')
    expect(finalPo?.items[0].receivedQty).toBe(10)
  })

  it('rejects receiving more than the remaining ordered quantity', async () => {
    const order = await makeSubmittedPO([{ productId: PRODUCT_ID, orderedQty: 5, unitCost: 4 }])
    const result = await receiveGoodsForPurchaseOrder(
      { purchaseOrderId: order.id, items: [{ productId: PRODUCT_ID, quantity: 6, unitCost: 4 }] },
      USER_ID
    )
    expect(result).toEqual({ error: 'exceeds_remaining_quantity', productId: PRODUCT_ID })

    const { rows: productRows } = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID])
    expect(productRows[0].stock).toBe(20) // لم يتغير — لا استلام جزئي غير صالح
  })

  it('rejects receiving a product that is not part of the purchase order', async () => {
    const order = await makeSubmittedPO([{ productId: PRODUCT_ID, orderedQty: 5, unitCost: 4 }])
    const result = await receiveGoodsForPurchaseOrder(
      { purchaseOrderId: order.id, items: [{ productId: PRODUCT_EXPIRY_ID, quantity: 1, unitCost: 4 }] },
      USER_ID
    )
    expect(result).toEqual({ error: 'product_not_in_order', productId: PRODUCT_EXPIRY_ID })
  })

  it('rejects receiving against a draft (not yet submitted) PO', async () => {
    const order = await createPurchaseOrder({ supplierId: SUPPLIER_ID, items: [{ productId: PRODUCT_ID, orderedQty: 5, unitCost: 4 }] }, USER_ID)
    const result = await receiveGoodsForPurchaseOrder(
      { purchaseOrderId: order.id, items: [{ productId: PRODUCT_ID, quantity: 5, unitCost: 4 }] },
      USER_ID
    )
    expect(result).toEqual({ error: 'purchase_order_not_receivable' })
  })

  it('requires an expiry date for a product with tracks_expiry enabled', async () => {
    const order = await makeSubmittedPO([{ productId: PRODUCT_EXPIRY_ID, orderedQty: 5, unitCost: 6 }])
    const result = await receiveGoodsForPurchaseOrder(
      { purchaseOrderId: order.id, items: [{ productId: PRODUCT_EXPIRY_ID, quantity: 5, unitCost: 6 }] },
      USER_ID
    )
    expect(result).toEqual({ error: 'expiry_date_required', productId: PRODUCT_EXPIRY_ID })

    const { rows } = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_EXPIRY_ID])
    expect(rows[0].stock).toBe(0) // كل شيء اترفض قبل ما يتغيّر أي حاجة
  })

  it('accepts an expiry-tracked product once an expiry date is supplied', async () => {
    const order = await makeSubmittedPO([{ productId: PRODUCT_EXPIRY_ID, orderedQty: 5, unitCost: 6 }])
    const futureDate = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
    const result = await receiveGoodsForPurchaseOrder(
      { purchaseOrderId: order.id, items: [{ productId: PRODUCT_EXPIRY_ID, quantity: 5, unitCost: 6, expiryDate: futureDate }] },
      USER_ID
    )
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.items[0].expiryDate?.slice(0, 10)).toBe(futureDate)
  })

  it('rejects the whole receipt (all-or-nothing) when one of several items is invalid', async () => {
    const order = await makeSubmittedPO([
      { productId: PRODUCT_ID, orderedQty: 5, unitCost: 4 },
      { productId: PRODUCT_EXPIRY_ID, orderedQty: 5, unitCost: 6 }
    ])
    const result = await receiveGoodsForPurchaseOrder(
      {
        purchaseOrderId: order.id,
        items: [
          { productId: PRODUCT_ID, quantity: 5, unitCost: 4 },
          { productId: PRODUCT_EXPIRY_ID, quantity: 5, unitCost: 6 } // missing expiry date
        ]
      },
      USER_ID
    )
    expect(result).toEqual({ error: 'expiry_date_required', productId: PRODUCT_EXPIRY_ID })

    // أول صنف (الصالح) ما اتزادش خالص — الإيصال كله اترفض
    const { rows } = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_ID])
    expect(rows[0].stock).toBe(20)
  })

  it('fetches a receipt with its items via getGoodsReceiptById', async () => {
    const order = await makeSubmittedPO([{ productId: PRODUCT_ID, orderedQty: 3, unitCost: 4 }])
    const result = await receiveGoodsForPurchaseOrder(
      { purchaseOrderId: order.id, items: [{ productId: PRODUCT_ID, quantity: 3, unitCost: 4 }] },
      USER_ID
    )
    expect('error' in result).toBe(false)
    if ('error' in result) return

    const fetched = await getGoodsReceiptById(result.receipt.id)
    expect(fetched?.items).toHaveLength(1)
    expect(fetched?.items[0].productName).toBe('منتج 1')
  })
})
