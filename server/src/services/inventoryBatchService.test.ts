import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { pool } from '../db.js'
import { getExpiryDashboard, getSellableStock, getVariantSellableStock } from './inventoryBatchService.js'

const CATEGORY_ID = 'test-cat-expiry-dash'
const PRODUCT_ID = 'test-prod-expiry-dash'

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
}

async function insertBatch(expiryDate: string | null, quantityRemaining: number, unitCost: number, quantityReceived = Math.max(quantityRemaining, 1)) {
  await pool.query(
    `INSERT INTO inventory_batches (id, product_id, quantity_received, quantity_remaining, unit_cost, expiry_date)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [crypto.randomUUID(), PRODUCT_ID, quantityReceived, quantityRemaining, unitCost, expiryDate]
  )
}

async function resetFixtures() {
  await pool.query('DELETE FROM inventory_batches WHERE product_id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM products WHERE id = $1', [PRODUCT_ID])
  await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, 'expiry-dash-prod', $2, 'منتج قابل للتلف', 'وصف', 10, 5, 'وحدة', '🧪', 1, 0, now())`,
    [PRODUCT_ID, CATEGORY_ID]
  )
}

describe('inventoryBatchService.getExpiryDashboard', () => {
  beforeEach(resetFixtures)
  afterAll(async () => {
    await pool.query('DELETE FROM inventory_batches WHERE product_id = $1', [PRODUCT_ID])
    await pool.query('DELETE FROM products WHERE id = $1', [PRODUCT_ID])
    await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
  })

  it('buckets batches into expired / 7 / 30 / 60 days correctly', async () => {
    await insertBatch(daysFromNow(-2), 10, 2) // expired
    await insertBatch(daysFromNow(3), 5, 2) // within 7
    await insertBatch(daysFromNow(20), 4, 2) // within 30
    await insertBatch(daysFromNow(45), 3, 2) // within 60
    await insertBatch(daysFromNow(90), 100, 2) // outside all buckets

    const dashboard = await getExpiryDashboard()
    expect(dashboard.expired).toHaveLength(1)
    expect(dashboard.within7Days).toHaveLength(1)
    expect(dashboard.within30Days).toHaveLength(1)
    expect(dashboard.within60Days).toHaveLength(1)
  })

  it('computes cost value at risk as remaining quantity times unit cost', async () => {
    await insertBatch(daysFromNow(-1), 10, 3.5)
    const dashboard = await getExpiryDashboard()
    expect(dashboard.expired[0].costValueAtRisk).toBe(35)
  })

  it('excludes batches with zero remaining quantity', async () => {
    await insertBatch(daysFromNow(-1), 0, 5)
    const dashboard = await getExpiryDashboard()
    expect(dashboard.expired).toHaveLength(0)
  })

  it('excludes batches with no expiry date (non-tracked products)', async () => {
    await insertBatch(null, 50, 5)
    const dashboard = await getExpiryDashboard()
    expect(dashboard.expired).toHaveLength(0)
    expect(dashboard.within60Days).toHaveLength(0)
  })
})

const VARIANT_ID = 'test-variant-sellable'

async function insertVariantBatch(expiryDate: string | null, quantityRemaining: number) {
  await pool.query(
    `INSERT INTO inventory_batches (id, product_id, variant_id, quantity_received, quantity_remaining, unit_cost, expiry_date)
     VALUES ($1, $2, $3, $4, $5, 2, $6)`,
    [crypto.randomUUID(), PRODUCT_ID, VARIANT_ID, Math.max(quantityRemaining, 1), quantityRemaining, expiryDate]
  )
}

describe('inventoryBatchService — variant sellable stock', () => {
  beforeEach(async () => {
    await pool.query('DELETE FROM inventory_batches WHERE product_id = $1', [PRODUCT_ID])
    await pool.query('DELETE FROM product_variants WHERE id = $1', [VARIANT_ID])
    await resetFixtures()
    await pool.query(
      `INSERT INTO product_variants (id, product_id, name, sku, barcode, price, old_price, cost, stock, available, sort_order, created_at)
       VALUES ($1, $2, 'متغيّر اختبار', null, '', 10, null, 5, 7, 1, 0, now())`,
      [VARIANT_ID, PRODUCT_ID]
    )
  })
  afterAll(async () => {
    await pool.query('DELETE FROM inventory_batches WHERE product_id = $1', [PRODUCT_ID])
    await pool.query('DELETE FROM product_variants WHERE id = $1', [VARIANT_ID])
    await pool.query('DELETE FROM products WHERE id = $1', [PRODUCT_ID])
    await pool.query('DELETE FROM categories WHERE id = $1', [CATEGORY_ID])
    await pool.end()
  })

  it('getSellableStock (base product) returns null when only variant-scoped batches exist', async () => {
    await insertVariantBatch(daysFromNow(30), 5)
    expect(await getSellableStock(pool, PRODUCT_ID)).toBeNull()
  })

  it('getVariantSellableStock returns null when the variant has no batches at all', async () => {
    expect(await getVariantSellableStock(pool, VARIANT_ID)).toBeNull()
  })

  it('getVariantSellableStock sums non-expired batches and excludes expired ones', async () => {
    await insertVariantBatch(daysFromNow(30), 4)
    await insertVariantBatch(daysFromNow(-2), 6) // expired — excluded
    expect(await getVariantSellableStock(pool, VARIANT_ID)).toBe(4)
  })

  it('getVariantSellableStock and getSellableStock are independent for the same product', async () => {
    await insertVariantBatch(daysFromNow(30), 3)
    await insertBatch(daysFromNow(30), 9, 2) // base-product batch (variant_id NULL)
    expect(await getVariantSellableStock(pool, VARIANT_ID)).toBe(3)
    expect(await getSellableStock(pool, PRODUCT_ID)).toBe(9)
  })
})
