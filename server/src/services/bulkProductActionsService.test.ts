import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { applyBulkProductAction } from './bulkProductActionsService.js'

const CATEGORY_ID = 'test-cat-bulkselect'
const OTHER_CATEGORY_ID = 'test-cat-bulkselect-other'
const PRODUCT_A = 'test-prod-bulksel-a'
const PRODUCT_B = 'test-prod-bulksel-b'

async function cleanupFixtures() {
  await pool.query('DELETE FROM products WHERE id IN ($1, $2)', [PRODUCT_A, PRODUCT_B])
  await pool.query('DELETE FROM categories WHERE id IN ($1, $2)', [CATEGORY_ID, OTHER_CATEGORY_ID])
}

async function resetFixtures() {
  await cleanupFixtures()
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار التحديد', '🧪', '#fff', 1)`,
    [CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة أخرى', '🧪', '#fff', 2)`,
    [OTHER_CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, brand, sku, barcode, created_at)
     VALUES ($1, $1, $2, 'منتج أ', 'وصف', 10, 5, 'قطعة', '🧪', 1, 20, 'ماركة أ', 'SKU-A', 'BAR-A', now())`,
    [PRODUCT_A, CATEGORY_ID]
  )
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, brand, sku, barcode, created_at)
     VALUES ($1, $1, $2, 'منتج ب', 'وصف', 20, 10, 'قطعة', '🧪', 1, 20, 'ماركة ب', 'SKU-B', 'BAR-B', now())`,
    [PRODUCT_B, CATEGORY_ID]
  )
}

describe('bulkProductActionsService', () => {
  beforeEach(resetFixtures)
  afterAll(cleanupFixtures)

  it('sets available=0 for all selected products', async () => {
    const result = await applyBulkProductAction([PRODUCT_A, PRODUCT_B], 'set_unavailable', {})
    expect(result.updated).toBe(2)
    expect(result.failed).toEqual([])

    const { rows } = await pool.query('SELECT available FROM products WHERE id IN ($1, $2)', [PRODUCT_A, PRODUCT_B])
    expect(rows.every(r => r.available === 0)).toBe(true)
  })

  it('sets available=1 for all selected products', async () => {
    await applyBulkProductAction([PRODUCT_A, PRODUCT_B], 'set_unavailable', {})
    const result = await applyBulkProductAction([PRODUCT_A, PRODUCT_B], 'set_available', {})
    expect(result.updated).toBe(2)

    const { rows } = await pool.query('SELECT available FROM products WHERE id IN ($1, $2)', [PRODUCT_A, PRODUCT_B])
    expect(rows.every(r => r.available === 1)).toBe(true)
  })

  it('reassigns the category for all selected products when categoryId is valid', async () => {
    const result = await applyBulkProductAction([PRODUCT_A, PRODUCT_B], 'set_category', { categoryId: OTHER_CATEGORY_ID })
    expect(result.updated).toBe(2)

    const { rows } = await pool.query('SELECT category_id as "categoryId" FROM products WHERE id IN ($1, $2)', [PRODUCT_A, PRODUCT_B])
    expect(rows.every(r => r.categoryId === OTHER_CATEGORY_ID)).toBe(true)
  })

  it('rejects a bulk category change to a category that does not exist, changing nothing', async () => {
    const result = await applyBulkProductAction([PRODUCT_A, PRODUCT_B], 'set_category', { categoryId: 'no-such-category' })
    expect(result.updated).toBe(0)
    expect(result.failed).toHaveLength(2)
    expect(result.failed.every(f => f.reason === 'category_not_found')).toBe(true)

    const { rows } = await pool.query('SELECT category_id as "categoryId" FROM products WHERE id = $1', [PRODUCT_A])
    expect(rows[0].categoryId).toBe(CATEGORY_ID)
  })

  it('rejects a bulk category change with no categoryId provided', async () => {
    const result = await applyBulkProductAction([PRODUCT_A], 'set_category', {})
    expect(result.updated).toBe(0)
    expect(result.failed).toEqual([{ productId: PRODUCT_A, reason: 'missing_category' }])
  })

  it('sets the brand for all selected products', async () => {
    const result = await applyBulkProductAction([PRODUCT_A, PRODUCT_B], 'set_brand', { brand: 'ماركة جديدة' })
    expect(result.updated).toBe(2)

    const { rows } = await pool.query('SELECT brand FROM products WHERE id IN ($1, $2)', [PRODUCT_A, PRODUCT_B])
    expect(rows.every(r => r.brand === 'ماركة جديدة')).toBe(true)
  })

  it('reports a non-existent product id as failed without affecting the valid ones', async () => {
    const result = await applyBulkProductAction([PRODUCT_A, 'no-such-product'], 'set_unavailable', {})
    expect(result.updated).toBe(1)
    expect(result.failed).toEqual([{ productId: 'no-such-product', reason: 'product_not_found' }])
  })

  it('de-duplicates repeated product ids in the same request', async () => {
    const result = await applyBulkProductAction([PRODUCT_A, PRODUCT_A, PRODUCT_A], 'set_unavailable', {})
    expect(result.updated).toBe(1)
  })

  it('returns no-op for an empty product id list', async () => {
    const result = await applyBulkProductAction([], 'set_unavailable', {})
    expect(result).toEqual({ updated: 0, failed: [] })
  })

  it('soft-deletes all selected products: sets deleted_at + available=0, keeps the rows', async () => {
    const result = await applyBulkProductAction([PRODUCT_A, PRODUCT_B], 'delete', {})
    expect(result.updated).toBe(2)
    expect(result.failed).toEqual([])

    const { rows } = await pool.query('SELECT deleted_at, available FROM products WHERE id IN ($1, $2)', [PRODUCT_A, PRODUCT_B])
    expect(rows).toHaveLength(2)
    expect(rows.every(r => r.deleted_at !== null && r.available === 0)).toBe(true)
  })

  it('is idempotent: bulk-deleting an already-deleted product reports it as failed, not an error', async () => {
    await applyBulkProductAction([PRODUCT_A], 'delete', {})
    const result = await applyBulkProductAction([PRODUCT_A], 'delete', {})
    expect(result.updated).toBe(0)
    expect(result.failed).toEqual([{ productId: PRODUCT_A, reason: 'product_not_found' }])
  })

  it('bulk-restores selected deleted products without re-enabling availability', async () => {
    await applyBulkProductAction([PRODUCT_A, PRODUCT_B], 'delete', {})
    const result = await applyBulkProductAction([PRODUCT_A, PRODUCT_B], 'restore', {})
    expect(result.updated).toBe(2)

    const { rows } = await pool.query('SELECT deleted_at, available FROM products WHERE id IN ($1, $2)', [PRODUCT_A, PRODUCT_B])
    expect(rows.every(r => r.deleted_at === null && r.available === 0)).toBe(true)
  })

  it('is idempotent: bulk-restoring a product that is not deleted reports it as failed', async () => {
    const result = await applyBulkProductAction([PRODUCT_A], 'restore', {})
    expect(result.updated).toBe(0)
    expect(result.failed).toEqual([{ productId: PRODUCT_A, reason: 'product_not_found' }])
  })
})
