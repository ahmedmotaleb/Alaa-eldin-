import crypto from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { getPurchasingInventoryAnalytics } from './purchasingInventoryAnalyticsService.js'

const CATEGORY_A = 'test-cat-pia-a'
const CATEGORY_B = 'test-cat-pia-b'
const SUPPLIER_A = 'test-supplier-pia-a'
const SUPPLIER_B = 'test-supplier-pia-b'
const P_DEAD = 'test-prod-pia-dead'
const P_SLOW = 'test-prod-pia-slow'
const P_FAST = 'test-prod-pia-fast'
const P_MARGIN = 'test-prod-pia-margin'
const P_STOCKOUT = 'test-prod-pia-stockout'

const TODAY = new Date()
const FROM_DATE = new Date(TODAY.getTime() - 29 * 86400000).toISOString().slice(0, 10)
const TO_DATE = TODAY.toISOString().slice(0, 10)

function daysAgo(days: number) {
  return new Date(TODAY.getTime() - days * 86400000).toISOString()
}

async function resetFixtures() {
  await pool.query('DELETE FROM goods_receipts WHERE supplier_id = ANY($1::text[])', [[SUPPLIER_A, SUPPLIER_B]])
  await pool.query('DELETE FROM purchase_order_items WHERE product_id = ANY($1::text[])', [[P_DEAD, P_SLOW, P_FAST, P_MARGIN, P_STOCKOUT]])
  await pool.query('DELETE FROM purchase_orders WHERE supplier_id = ANY($1::text[])', [[SUPPLIER_A, SUPPLIER_B]])
  await pool.query('DELETE FROM inventory_batches WHERE product_id = ANY($1::text[])', [[P_DEAD, P_SLOW, P_FAST, P_MARGIN, P_STOCKOUT]])
  await pool.query('DELETE FROM product_cost_history WHERE product_id = ANY($1::text[])', [[P_DEAD, P_SLOW, P_FAST, P_MARGIN, P_STOCKOUT]])
  await pool.query('DELETE FROM supplier_products WHERE supplier_id = ANY($1::text[])', [[SUPPLIER_A, SUPPLIER_B]])
  await pool.query('DELETE FROM order_items WHERE product_id = ANY($1::text[])', [[P_DEAD, P_SLOW, P_FAST, P_MARGIN, P_STOCKOUT]])
  await pool.query("DELETE FROM orders WHERE id LIKE 'test-order-pia-%'")
  await pool.query('DELETE FROM products WHERE id = ANY($1::text[])', [[P_DEAD, P_SLOW, P_FAST, P_MARGIN, P_STOCKOUT]])
  await pool.query('DELETE FROM suppliers WHERE id = ANY($1::text[])', [[SUPPLIER_A, SUPPLIER_B]])
  await pool.query('DELETE FROM categories WHERE id = ANY($1::text[])', [[CATEGORY_A, CATEGORY_B]])

  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'قسم أ', '🧪', '#fff', 1)`, [CATEGORY_A])
  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'قسم ب', '🧪', '#fff', 2)`, [CATEGORY_B])
  await pool.query(`INSERT INTO suppliers (id, name) VALUES ($1, 'مورد أ')`, [SUPPLIER_A])
  await pool.query(`INSERT INTO suppliers (id, name) VALUES ($1, 'مورد ب')`, [SUPPLIER_B])

  async function insertProduct(id: string, categoryId: string, price: number, cost: number, stock: number) {
    await pool.query(
      `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
       VALUES ($1, $1, $2, $1, 'وصف', $3, $4, 'قطعة', '🧪', 1, $5, now())`,
      [id, categoryId, price, cost, stock]
    )
  }
  await insertProduct(P_DEAD, CATEGORY_A, 20, 10, 30)
  await insertProduct(P_SLOW, CATEGORY_A, 20, 10, 100)
  await insertProduct(P_FAST, CATEGORY_A, 20, 10, 50)
  await insertProduct(P_MARGIN, CATEGORY_B, 20, 15, 20)
  await insertProduct(P_STOCKOUT, CATEGORY_B, 30, 10, 5)

  await pool.query(`INSERT INTO supplier_products (id, supplier_id, product_id) VALUES ($1, $2, $3)`, [crypto.randomUUID(), SUPPLIER_A, P_DEAD])
}

async function insertOrder(id: string, createdAt: string, items: { productId: string, quantity: number, unitPrice: number, pickedStatus?: string }[]) {
  const total = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
  await pool.query(
    `INSERT INTO orders (id, order_number, created_at, delivery_slot, payment_method,
       customer_full_name, customer_mobile, customer_governorate, customer_address,
       subtotal, delivery_fee, total, status, discount_amount)
     VALUES ($1, $1, $2, 'now', 'COD', 'عميل اختبار', '01012345678', 'القاهرة', 'عنوان', $3, 0, $3, 'placed', 0)`,
    [id, createdAt, total]
  )
  for (const item of items) {
    await pool.query(
      `INSERT INTO order_items (order_id, product_id, name, unit, unit_price, quantity, line_total, picked_status)
       VALUES ($1, $2, $2, 'قطعة', $3, $4, $5, $6)`,
      [id, item.productId, item.unitPrice, item.quantity, item.quantity * item.unitPrice, item.pickedStatus ?? 'picked']
    )
  }
}

beforeEach(async () => {
  await resetFixtures()
})

afterAll(async () => {
  await pool.query('DELETE FROM goods_receipts WHERE supplier_id = ANY($1::text[])', [[SUPPLIER_A, SUPPLIER_B]])
  await pool.query('DELETE FROM purchase_order_items WHERE product_id = ANY($1::text[])', [[P_DEAD, P_SLOW, P_FAST, P_MARGIN, P_STOCKOUT]])
  await pool.query('DELETE FROM purchase_orders WHERE supplier_id = ANY($1::text[])', [[SUPPLIER_A, SUPPLIER_B]])
  await pool.query('DELETE FROM inventory_batches WHERE product_id = ANY($1::text[])', [[P_DEAD, P_SLOW, P_FAST, P_MARGIN, P_STOCKOUT]])
  await pool.query('DELETE FROM product_cost_history WHERE product_id = ANY($1::text[])', [[P_DEAD, P_SLOW, P_FAST, P_MARGIN, P_STOCKOUT]])
  await pool.query('DELETE FROM supplier_products WHERE supplier_id = ANY($1::text[])', [[SUPPLIER_A, SUPPLIER_B]])
  await pool.query('DELETE FROM order_items WHERE product_id = ANY($1::text[])', [[P_DEAD, P_SLOW, P_FAST, P_MARGIN, P_STOCKOUT]])
  await pool.query("DELETE FROM orders WHERE id LIKE 'test-order-pia-%'")
  await pool.query('DELETE FROM products WHERE id = ANY($1::text[])', [[P_DEAD, P_SLOW, P_FAST, P_MARGIN, P_STOCKOUT]])
  await pool.query('DELETE FROM suppliers WHERE id = ANY($1::text[])', [[SUPPLIER_A, SUPPLIER_B]])
  await pool.query('DELETE FROM categories WHERE id = ANY($1::text[])', [[CATEGORY_A, CATEGORY_B]])
  await pool.end()
})

describe('getPurchasingInventoryAnalytics', () => {
  it('does not break when only a supplier filter is given without a category filter (param-index regression)', async () => {
    await expect(
      getPurchasingInventoryAnalytics({ fromDate: FROM_DATE, toDate: TO_DATE, supplierId: SUPPLIER_A, limit: 50 })
    ).resolves.toBeTruthy()
  })

  it('does not break when only a category filter is given without a supplier filter', async () => {
    await expect(
      getPurchasingInventoryAnalytics({ fromDate: FROM_DATE, toDate: TO_DATE, categoryId: CATEGORY_A, limit: 50 })
    ).resolves.toBeTruthy()
  })

  it('classifies a product with stock but zero sales in the period as dead stock', async () => {
    const result = await getPurchasingInventoryAnalytics({ fromDate: FROM_DATE, toDate: TO_DATE, categoryId: CATEGORY_A, limit: 50 })
    expect(result.deadStock.some(r => r.productId === P_DEAD)).toBe(true)
  })

  it('classifies a product with very few sales relative to its stock as slow stock', async () => {
    await insertOrder('test-order-pia-slow-1', daysAgo(5), [{ productId: P_SLOW, quantity: 1, unitPrice: 20 }])
    const result = await getPurchasingInventoryAnalytics({ fromDate: FROM_DATE, toDate: TO_DATE, categoryId: CATEGORY_A, limit: 50 })
    expect(result.slowStock.some(r => r.productId === P_SLOW)).toBe(true)
  })

  it('classifies a product with strong sales velocity as a fast mover', async () => {
    for (let i = 0; i < 10; i++) {
      await insertOrder(`test-order-pia-fast-${i}`, daysAgo(i), [{ productId: P_FAST, quantity: 5, unitPrice: 20 }])
    }
    const result = await getPurchasingInventoryAnalytics({ fromDate: FROM_DATE, toDate: TO_DATE, categoryId: CATEGORY_A, limit: 50 })
    expect(result.fastStock[0]?.productId).toBe(P_FAST)
    expect(result.deadStock.some(r => r.productId === P_FAST)).toBe(false)
  })

  it('counts a real stockout incident and its estimated lost-sales value from picked_status=unavailable', async () => {
    await insertOrder('test-order-pia-stockout-1', daysAgo(2), [
      { productId: P_STOCKOUT, quantity: 3, unitPrice: 30, pickedStatus: 'unavailable' }
    ])
    const result = await getPurchasingInventoryAnalytics({ fromDate: FROM_DATE, toDate: TO_DATE, categoryId: CATEGORY_B, limit: 50 })
    expect(result.stockouts.totalIncidents).toBe(1)
    expect(result.stockouts.byProduct.find(r => r.productId === P_STOCKOUT)?.incidentCount).toBe(1)
    expect(result.lostSales.incidentCount).toBe(1)
    expect(result.lostSales.estimatedValue).toBe(90) // 3 * 30
  })

  it('computes expired and near-expiry batch value from real inventory_batches rows', async () => {
    await pool.query(
      `INSERT INTO inventory_batches (id, product_id, quantity_received, quantity_remaining, unit_cost, expiry_date, created_at)
       VALUES ($1, $2, 5, 5, 4, CURRENT_DATE - 2, now())`,
      [crypto.randomUUID(), P_MARGIN]
    )
    await pool.query(
      `INSERT INTO inventory_batches (id, product_id, quantity_received, quantity_remaining, unit_cost, expiry_date, created_at)
       VALUES ($1, $2, 10, 10, 4, CURRENT_DATE + 10, now())`,
      [crypto.randomUUID(), P_MARGIN]
    )
    const result = await getPurchasingInventoryAnalytics({ fromDate: FROM_DATE, toDate: TO_DATE, categoryId: CATEGORY_B, limit: 50 })
    expect(result.expiry.expiredValue).toBe(20) // 5 * 4
    expect(result.expiry.nearExpiryValue).toBe(40) // 10 * 4
  })

  it('computes real supplier purchase value, fill rate, and average lead time', async () => {
    const poId = crypto.randomUUID()
    await pool.query(
      `INSERT INTO purchase_orders (id, po_number, supplier_id, status, subtotal, discount, shipping_cost, total, created_at)
       VALUES ($1, $2, $3, 'partially_received', 100, 0, 0, 100, $4)`,
      [poId, `PO-TEST-${poId}`, SUPPLIER_A, daysAgo(10)]
    )
    await pool.query(
      `INSERT INTO purchase_order_items (id, purchase_order_id, product_id, ordered_qty, received_qty, unit_cost, line_total)
       VALUES ($1, $2, $3, 10, 6, 10, 100)`,
      [crypto.randomUUID(), poId, P_DEAD]
    )
    await pool.query(
      `INSERT INTO goods_receipts (id, receipt_number, purchase_order_id, supplier_id, received_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [crypto.randomUUID(), `GR-TEST-${poId}`, poId, SUPPLIER_A, daysAgo(7)]
    )
    const result = await getPurchasingInventoryAnalytics({ fromDate: FROM_DATE, toDate: TO_DATE, supplierId: SUPPLIER_A, limit: 50 })
    const supplierRow = result.suppliers.find(s => s.supplierId === SUPPLIER_A)
    expect(supplierRow?.purchaseValue).toBe(100)
    expect(supplierRow?.fillRatePercent).toBe(60) // 6/10 * 100
    expect(supplierRow?.avgLeadTimeDays).toBe(3) // day -10 -> day -7
  })

  it('detects a real cost change over the period from product_cost_history', async () => {
    await pool.query(
      `INSERT INTO product_cost_history (id, product_id, unit_cost, source_type, recorded_at)
       VALUES ($1, $2, 10, 'purchase_receipt', $3)`,
      [crypto.randomUUID(), P_MARGIN, daysAgo(20)]
    )
    await pool.query(
      `INSERT INTO product_cost_history (id, product_id, unit_cost, source_type, recorded_at)
       VALUES ($1, $2, 15, 'purchase_receipt', $3)`,
      [crypto.randomUUID(), P_MARGIN, daysAgo(2)]
    )
    const result = await getPurchasingInventoryAnalytics({ fromDate: FROM_DATE, toDate: TO_DATE, categoryId: CATEGORY_B, limit: 50 })
    const change = result.priceChanges.find(p => p.productId === P_MARGIN)
    expect(change?.oldestCost).toBe(10)
    expect(change?.newestCost).toBe(15)
    expect(change?.percentChange).toBe(50)
  })

  it('computes per-product margin percent from current price and cost', async () => {
    const result = await getPurchasingInventoryAnalytics({ fromDate: FROM_DATE, toDate: TO_DATE, categoryId: CATEGORY_B, limit: 50 })
    const row = result.marginByProduct.find(r => r.productId === P_MARGIN)
    expect(row?.marginPercent).toBe(25) // (20-15)/20 * 100
  })

  it('computes category margin from real sales revenue against an approximated current-cost COGS', async () => {
    await insertOrder('test-order-pia-margin-1', daysAgo(1), [{ productId: P_MARGIN, quantity: 2, unitPrice: 20 }])
    const result = await getPurchasingInventoryAnalytics({ fromDate: FROM_DATE, toDate: TO_DATE, categoryId: CATEGORY_B, limit: 50 })
    const row = result.marginByCategory.find(r => r.categoryId === CATEGORY_B)
    expect(row?.revenue).toBe(40) // 2 * 20
    expect(row?.approxCogs).toBe(30) // 2 * 15
    expect(row?.marginPercent).toBe(25)
  })

  it('reports a null turnover ratio when there is no sellable inventory value at all in scope', async () => {
    const result = await getPurchasingInventoryAnalytics({ fromDate: FROM_DATE, toDate: TO_DATE, categoryId: 'no-such-category', limit: 50 })
    expect(result.turnover.turnoverRatio).toBeNull()
    expect(result.deadStock).toEqual([])
  })
})
