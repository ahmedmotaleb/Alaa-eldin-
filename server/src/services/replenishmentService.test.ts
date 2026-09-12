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

async function resetFixtures() {
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
})
