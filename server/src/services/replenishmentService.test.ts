import crypto from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { getReplenishmentSuggestions } from './replenishmentService.js'

const CATEGORY_ID = 'test-cat-replenish'
const PRODUCT_ID = 'test-prod-replenish'
const SUPPLIER_ID = 'test-supplier-replenish'

async function insertSale(daysAgo: number, quantity: number) {
  await pool.query(
    `INSERT INTO stock_movements (product_id, type, quantity_change, note, created_at)
     VALUES ($1, 'sale', $2, 'test sale', now() - $3 * interval '1 day')`,
    [PRODUCT_ID, -quantity, daysAgo]
  )
}

async function insertOpenPurchaseOrder(id: string, status: 'submitted' | 'partially_received', orderedQty: number, receivedQty: number) {
  await pool.query(
    `INSERT INTO purchase_orders (id, po_number, supplier_id, status, subtotal, discount, shipping_cost, total)
     VALUES ($1, $2, $3, $4, 0, 0, 0, 0)`,
    [id, `PO-TEST-${id}`, SUPPLIER_ID, status]
  )
  await pool.query(
    `INSERT INTO purchase_order_items (id, purchase_order_id, product_id, ordered_qty, received_qty, unit_cost, line_total)
     VALUES ($1, $2, $3, $4, $5, 5, 0)`,
    [`${id}-item`, id, PRODUCT_ID, orderedQty, receivedQty]
  )
}

async function insertCostHistory(unitCost: number, daysAgo: number) {
  await pool.query(
    `INSERT INTO product_cost_history (id, product_id, supplier_id, unit_cost, source_type, recorded_at)
     VALUES ($1, $2, $3, $4, 'purchase_receipt', now() - $5 * interval '1 day')`,
    [crypto.randomUUID(), PRODUCT_ID, SUPPLIER_ID, unitCost, daysAgo]
  )
}

async function resetFixtures() {
  await pool.query('DELETE FROM product_cost_history WHERE product_id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM purchase_order_items WHERE product_id = $1', [PRODUCT_ID])
  await pool.query("DELETE FROM purchase_orders WHERE po_number LIKE 'PO-TEST-%'")
  await pool.query('DELETE FROM supplier_products')
  await pool.query('DELETE FROM stock_movements WHERE product_id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM suppliers WHERE id = $1', [SUPPLIER_ID])
  await pool.query('DELETE FROM products WHERE id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])

  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'replenish-prod', $2, 'منتج اقتراحات الشراء', 'وصف', 10, 5, 'وحدة', '🧪', 1, 20, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
  await pool.query(`INSERT INTO suppliers (id, name) VALUES ($1, 'مورد اختبار الاقتراحات')`, [SUPPLIER_ID])
}

describe('replenishmentService', () => {
  beforeEach(resetFixtures)
  afterAll(async () => {
    await pool.query('DELETE FROM product_cost_history WHERE product_id = $1', [PRODUCT_ID])
    await pool.query('DELETE FROM purchase_order_items WHERE product_id = $1', [PRODUCT_ID])
    await pool.query("DELETE FROM purchase_orders WHERE po_number LIKE 'PO-TEST-%'")
    await pool.query('DELETE FROM supplier_products')
    await pool.query('DELETE FROM stock_movements WHERE product_id = $1', [PRODUCT_ID])
    await pool.query('DELETE FROM suppliers WHERE id = $1', [SUPPLIER_ID])
    await pool.query('DELETE FROM products WHERE id = $1', [PRODUCT_ID])
    await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  })

  it('computes avg daily sales over the last 7 days from real sale movements', async () => {
    await insertSale(1, 7) // 7 units sold yesterday
    await insertSale(3, 7) // 7 units sold 3 days ago -> total 14 over 7 days = 2/day
    const rows = await getReplenishmentSuggestions(14)
    const row = rows.find(r => r.productId === PRODUCT_ID)!
    expect(row.avgDailySales7d).toBe(2)
  })

  it('computes suggested reorder as max(target - current, 0)', async () => {
    // avg_daily_sales_7d = 2، target_days=14 -> target_stock=28، current=20 -> اقتراح=8
    await insertSale(1, 7)
    await insertSale(3, 7)
    const rows = await getReplenishmentSuggestions(14)
    const row = rows.find(r => r.productId === PRODUCT_ID)!
    expect(row.currentStock).toBe(20)
    expect(row.suggestedReorderQty).toBe(8)
  })

  it('never suggests a negative reorder quantity when stock already covers demand', async () => {
    await insertSale(1, 1) // مبيعات قليلة جداً
    const rows = await getReplenishmentSuggestions(7)
    const row = rows.find(r => r.productId === PRODUCT_ID)!
    expect(row.suggestedReorderQty).toBe(0)
  })

  it('bumps the suggestion up to the preferred supplier minimum order qty', async () => {
    await pool.query(
      `INSERT INTO supplier_products (id, supplier_id, product_id, minimum_order_qty, preferred)
       VALUES ('sp-test-1', $1, $2, 50, 1)`,
      [SUPPLIER_ID, PRODUCT_ID]
    )
    await insertSale(1, 7)
    await insertSale(3, 7)
    const rows = await getReplenishmentSuggestions(14)
    const row = rows.find(r => r.productId === PRODUCT_ID)!
    // الاقتراح الخام 8، لكن الحد الأدنى للمورد 50
    expect(row.suggestedReorderQty).toBe(50)
    expect(row.preferredSupplierName).toBe('مورد اختبار الاقتراحات')
  })

  it('reports null days of cover when there is no recent sales history', async () => {
    const rows = await getReplenishmentSuggestions(14)
    const row = rows.find(r => r.productId === PRODUCT_ID)!
    expect(row.avgDailySales7d).toBe(0)
    expect(row.daysOfCover).toBeNull()
  })

  it('excludes unavailable products', async () => {
    await pool.query('UPDATE products SET available = 0 WHERE id = $1', [PRODUCT_ID])
    const rows = await getReplenishmentSuggestions(14)
    expect(rows.find(r => r.productId === PRODUCT_ID)).toBeUndefined()
  })

  it('subtracts incoming quantity from open purchase orders so it never double-orders', async () => {
    // نفس بيانات "computes suggested reorder" (اقتراح خام = 8) لكن مع 5 وحدات في الطريق
    // من أمر شراء مفتوح — الاقتراح النهائي المفروض يبقى 3 مش 8.
    await insertSale(1, 7)
    await insertSale(3, 7)
    await insertOpenPurchaseOrder('po-incoming-1', 'submitted', 5, 0)
    const rows = await getReplenishmentSuggestions(14)
    const row = rows.find(r => r.productId === PRODUCT_ID)!
    expect(row.incomingQty).toBe(5)
    expect(row.suggestedReorderQty).toBe(3)
  })

  it('counts only the un-received remainder of a partially received purchase order as incoming', async () => {
    await insertOpenPurchaseOrder('po-incoming-2', 'partially_received', 10, 6)
    const rows = await getReplenishmentSuggestions(14)
    const row = rows.find(r => r.productId === PRODUCT_ID)!
    expect(row.incomingQty).toBe(4)
  })

  it('ignores received and cancelled purchase orders when computing incoming quantity', async () => {
    await pool.query(
      `INSERT INTO purchase_orders (id, po_number, supplier_id, status, subtotal, discount, shipping_cost, total)
       VALUES ('po-done', 'PO-TEST-po-done', $1, 'received', 0, 0, 0, 0), ('po-cancelled', 'PO-TEST-po-cancelled', $1, 'cancelled', 0, 0, 0, 0)`,
      [SUPPLIER_ID]
    )
    await pool.query(
      `INSERT INTO purchase_order_items (id, purchase_order_id, product_id, ordered_qty, received_qty, unit_cost, line_total)
       VALUES ('po-done-item', 'po-done', $1, 10, 10, 5, 0), ('po-cancelled-item', 'po-cancelled', $1, 10, 0, 5, 0)`,
      [PRODUCT_ID]
    )
    const rows = await getReplenishmentSuggestions(14)
    const row = rows.find(r => r.productId === PRODUCT_ID)!
    expect(row.incomingQty).toBe(0)
  })

  it('reports the most recent purchase-receipt unit cost as lastReceivedCost', async () => {
    await insertCostHistory(4.5, 10)
    await insertCostHistory(5.25, 1)
    const rows = await getReplenishmentSuggestions(14)
    const row = rows.find(r => r.productId === PRODUCT_ID)!
    expect(row.lastReceivedCost).toBe(5.25)
  })

  it('reports null lastReceivedCost when the product has never been received', async () => {
    const rows = await getReplenishmentSuggestions(14)
    const row = rows.find(r => r.productId === PRODUCT_ID)!
    expect(row.lastReceivedCost).toBeNull()
  })
})
