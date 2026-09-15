import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { pool } from '../db.js'
import { getInventoryValuation } from './inventoryValuationService.js'

const CATEGORY_ID = 'test-cat-valuation'
const PRODUCT_ID = 'test-prod-valuation'

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
}

async function removeFixtures() {
  await pool.query('DELETE FROM inventory_batches WHERE product_id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM products WHERE id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
}

async function resetFixtures() {
  await removeFixtures()
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
}

async function insertProduct(stock: number, cost: number, alertThreshold: number) {
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, alert_threshold, created_at)
     VALUES ($1, 'valuation-prod', $2, 'منتج تقييم', 'وصف', 10, $3, 'وحدة', '🧪', 1, $4, $5, now())`,
    [PRODUCT_ID, CATEGORY_ID, cost, stock, alertThreshold]
  )
}

describe('inventoryValuationService', () => {
  beforeEach(resetFixtures)
  afterAll(removeFixtures)

  it('values a batch-less product using raw stock times latest cost', async () => {
    const before = await getInventoryValuation()
    await insertProduct(10, 4, 0)
    const after = await getInventoryValuation()
    // مالوش دفعات خالص -> بيرجع لـ products.stock الخام (10) * أحدث تكلفة (4) = 40
    expect(after.inventoryCostValue - before.inventoryCostValue).toBe(40)
    expect(after.totalSellableQty - before.totalSellableQty).toBe(10)
  })

  it('includes low-stock value only for a product at or under its alert threshold', async () => {
    const before = await getInventoryValuation()
    await insertProduct(10, 4, 15) // 10 <= 15 -> تحت الحد
    const after = await getInventoryValuation()
    expect(after.lowStockValue - before.lowStockValue).toBe(40) // 10 * 4
  })

  it('excludes a product above its alert threshold from low-stock value', async () => {
    const before = await getInventoryValuation()
    await insertProduct(50, 4, 15) // 50 > 15 -> فوق الحد
    const after = await getInventoryValuation()
    expect(after.lowStockValue - before.lowStockValue).toBe(0)
  })

  it('reports the cost basis as latest_cost explicitly', async () => {
    const result = await getInventoryValuation()
    expect(result.costBasis).toBe('latest_cost')
  })

  it('adds expired batch value only from actually-expired batches', async () => {
    await insertProduct(15, 4, 15)
    const beforeValuation = await getInventoryValuation()
    await pool.query(
      `INSERT INTO inventory_batches (id, product_id, quantity_received, quantity_remaining, unit_cost, expiry_date, created_at)
       VALUES ($1, $2, 5, 5, 3, $3, now())`,
      [crypto.randomUUID(), PRODUCT_ID, daysFromNow(-2)]
    )
    await pool.query(
      `INSERT INTO inventory_batches (id, product_id, quantity_received, quantity_remaining, unit_cost, expiry_date, created_at)
       VALUES ($1, $2, 10, 10, 3, $3, now())`,
      [crypto.randomUUID(), PRODUCT_ID, daysFromNow(30)]
    )
    const afterValuation = await getInventoryValuation()
    // بس الدفعة المنتهية (5 * 3 = 15) بتتحسب في expiredValue
    expect(afterValuation.expiredValue - beforeValuation.expiredValue).toBe(15)
  })

  it('excludes expired batch quantity from the sellable total once the product has batches', async () => {
    await insertProduct(15, 4, 15)
    const before = await getInventoryValuation()
    await pool.query(
      `INSERT INTO inventory_batches (id, product_id, quantity_received, quantity_remaining, unit_cost, expiry_date, created_at)
       VALUES ($1, $2, 5, 5, 4, $3, now())`,
      [crypto.randomUUID(), PRODUCT_ID, daysFromNow(-1)]
    )
    await pool.query(
      `INSERT INTO inventory_batches (id, product_id, quantity_received, quantity_remaining, unit_cost, expiry_date, created_at)
       VALUES ($1, $2, 10, 10, 4, $3, now())`,
      [crypto.randomUUID(), PRODUCT_ID, daysFromNow(30)]
    )
    const after = await getInventoryValuation()
    // قبل الدفعات: sellable كان بيرجع لـ products.stock الخام (15). بعد ما بقى للمنتج
    // دفعات، sellable بقى 10 بس (5 منتهية اتستبعدت) — يعني totalSellableQty المفروض ينزل بـ 5.
    expect(after.totalSellableQty - before.totalSellableQty).toBe(-5)
    expect(after.inventoryCostValue - before.inventoryCostValue).toBe(-20) // -5 * 4
  })

  describe('weighted_average cost basis', () => {
    it('falls back to latest_cost for a product with no batches at all', async () => {
      const before = await getInventoryValuation('weighted_average')
      await insertProduct(10, 4, 0)
      const after = await getInventoryValuation('weighted_average')
      expect(after.inventoryCostValue - before.inventoryCostValue).toBe(40) // 10 * 4، زي latest_cost بالظبط
      expect(after.costBasis).toBe('weighted_average')
    })

    it('computes a real weighted average across the currently-sellable batches, matching a deliberately-engineered latest cost', async () => {
      const beforeLatest = await getInventoryValuation('latest_cost')
      const beforeWeighted = await getInventoryValuation('weighted_average')
      await insertProduct(15, 4, 0) // آخر تكلفة = 4
      // دفعتين: 5 وحدة بتكلفة 2، و10 وحدة بتكلفة 5 -> متوسط مرجّح = (5*2 + 10*5)/15 = 4
      await pool.query(
        `INSERT INTO inventory_batches (id, product_id, quantity_received, quantity_remaining, unit_cost, created_at)
         VALUES ($1, $2, 5, 5, 2, now())`,
        [crypto.randomUUID(), PRODUCT_ID]
      )
      await pool.query(
        `INSERT INTO inventory_batches (id, product_id, quantity_received, quantity_remaining, unit_cost, created_at)
         VALUES ($1, $2, 10, 10, 5, now())`,
        [crypto.randomUUID(), PRODUCT_ID]
      )
      const afterLatest = await getInventoryValuation('latest_cost')
      const afterWeighted = await getInventoryValuation('weighted_average')
      // latest_cost بيستخدم products.cost (4) بغض النظر عن الدفعات -> 15 * 4 = 60
      expect(afterLatest.inventoryCostValue - beforeLatest.inventoryCostValue).toBe(60)
      // weighted_average بيستخدم متوسط الدفعات نفسها (طلع 4 هنا كمان بالمصادفة، بس محسوب فعلياً من الدفعات) -> 15 * 4 = 60
      expect(afterWeighted.inventoryCostValue - beforeWeighted.inventoryCostValue).toBe(60)
      expect(afterWeighted.costBasis).toBe('weighted_average')
    })

    it('diverges from latest_cost when the batch mix has a genuinely different average cost', async () => {
      const beforeLatest = await getInventoryValuation('latest_cost')
      const beforeWeighted = await getInventoryValuation('weighted_average')
      await insertProduct(20, 10, 0) // آخر تكلفة = 10
      // دفعة واحدة بتكلفة 3 -> متوسط الدفعات = 3، مختلف تماماً عن آخر تكلفة (10)
      await pool.query(
        `INSERT INTO inventory_batches (id, product_id, quantity_received, quantity_remaining, unit_cost, created_at)
         VALUES ($1, $2, 20, 20, 3, now())`,
        [crypto.randomUUID(), PRODUCT_ID]
      )
      const afterLatest = await getInventoryValuation('latest_cost')
      const afterWeighted = await getInventoryValuation('weighted_average')
      expect(afterLatest.inventoryCostValue - beforeLatest.inventoryCostValue).toBe(200) // 20 * 10
      expect(afterWeighted.inventoryCostValue - beforeWeighted.inventoryCostValue).toBe(60) // 20 * 3
    })
  })

  describe('estimated gross margin', () => {
    it('computes revenue at current prices and a positive margin when price exceeds cost', async () => {
      const before = await getInventoryValuation()
      // السعر 10 (ثابت في insertProduct)، التكلفة 4 -> هامش تقديري موجب
      await insertProduct(10, 4, 0)
      const after = await getInventoryValuation()
      expect(after.estimatedRevenueAtCurrentPrices - before.estimatedRevenueAtCurrentPrices).toBe(100) // 10 * 10
      expect(after.estimatedGrossMarginPercent).not.toBeNull()
    })
  })
})
