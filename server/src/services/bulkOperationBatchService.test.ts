import crypto from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import {
  createBatch, finalizeBatch, listBatches, getBatch, getBatchDetail, rollbackBatch, getPriceHistoryForProduct
} from './bulkOperationBatchService.js'

const ADMIN_ID = 'test-user-batch-admin'
const CATEGORY_ID = 'test-cat-batch'
const PRODUCT_A = 'test-prod-batch-a'
const PRODUCT_B = 'test-prod-batch-b'
const VARIANT_A = 'test-variant-batch-a'

async function insertUser(id: string) {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, $1 || '@test.local', 'x', 'مدير اختبار', now())`,
    [id]
  )
}

async function insertProduct(id: string, price: number, oldPrice: number | null, cost: number) {
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, old_price, cost, unit, emoji, available, stock, created_at)
     VALUES ($1, $1, $2, 'منتج اختبار', 'وصف', $3, $4, $5, 'قطعة', '🧪', 1, 20, now())`,
    [id, CATEGORY_ID, price, oldPrice, cost]
  )
}

async function resetFixtures() {
  await pool.query('DELETE FROM product_price_history')
  await pool.query('DELETE FROM product_cost_history')
  await pool.query('DELETE FROM audit_logs')
  await pool.query('DELETE FROM bulk_operation_batches')
  await pool.query('DELETE FROM product_variants')
  await pool.query('DELETE FROM products')
  await pool.query('DELETE FROM categories')
  await pool.query('DELETE FROM users WHERE id = $1', [ADMIN_ID])
  await insertUser(ADMIN_ID)
  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'فئة اختبار', '🧪', '#fff', 1)`, [CATEGORY_ID])
  await insertProduct(PRODUCT_A, 100, 120, 50)
  await insertProduct(PRODUCT_B, 200, null, 80)
  await pool.query(
    `INSERT INTO product_variants (id, product_id, name, price, old_price, cost, stock, available, created_at)
     VALUES ($1, $2, 'كبير', 60, 70, 30, 5, 1, now())`,
    [VARIANT_A, PRODUCT_A]
  )
}

beforeEach(async () => {
  await resetFixtures()
})

afterAll(async () => {
  await pool.end()
})

async function writePriceChange(batchId: string, productId: string, variantId: string | null, oldPrice: number, newPrice: number, oldOldPrice: number | null, newOldPrice: number | null) {
  await pool.query(
    `INSERT INTO product_price_history (product_id, variant_id, old_price, new_price, old_old_price, new_old_price, source, admin_user_id, bulk_batch_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'bulk_csv', $7, $8)`,
    [productId, variantId, oldPrice, newPrice, oldOldPrice, newOldPrice, ADMIN_ID, batchId]
  )
}

async function writeCostChange(batchId: string, productId: string, variantId: string | null, oldCost: number, newCost: number) {
  await pool.query(
    `INSERT INTO product_cost_history (id, product_id, variant_id, unit_cost, old_cost, source_type, source_id, bulk_batch_id)
     VALUES ($1, $2, $3, $4, $5, 'bulk_price_update', $6, $7)`,
    [crypto.randomUUID(), productId, variantId, newCost, oldCost, ADMIN_ID, batchId]
  )
}

describe('createBatch / finalizeBatch / listBatches / getBatch', () => {
  it('creates a batch, finalizes it with totals, and lists it', async () => {
    const batchId = await createBatch('bulk_price_csv', ADMIN_ID)
    await finalizeBatch(batchId, { totalRows: 10, successfulRows: 8, failedRows: 2 })

    const batch = await getBatch(batchId)
    expect(batch).toMatchObject({ operationType: 'bulk_price_csv', createdBy: ADMIN_ID, status: 'completed', totalRows: 10, successfulRows: 8, failedRows: 2 })
    expect(batch!.completedAt).not.toBeNull()

    const batches = await listBatches('bulk_price_csv')
    expect(batches.map(b => b.id)).toContain(batchId)
  })

  it('filters listBatches by operation type', async () => {
    const csvBatch = await createBatch('bulk_price_csv', ADMIN_ID)
    const adjBatch = await createBatch('bulk_price_adjustment', ADMIN_ID)
    const csvOnly = await listBatches('bulk_price_csv')
    expect(csvOnly.map(b => b.id)).toContain(csvBatch)
    expect(csvOnly.map(b => b.id)).not.toContain(adjBatch)
  })
})

describe('getBatchDetail', () => {
  it('returns price and cost changes recorded for the batch', async () => {
    const batchId = await createBatch('bulk_price_csv', ADMIN_ID)
    await writePriceChange(batchId, PRODUCT_A, null, 100, 130, 120, 150)
    await writeCostChange(batchId, PRODUCT_A, null, 50, 60)

    const detail = await getBatchDetail(batchId)
    expect(detail!.priceChanges).toHaveLength(1)
    expect(detail!.priceChanges[0]).toMatchObject({ productId: PRODUCT_A, oldPrice: 100, newPrice: 130 })
    expect(detail!.costChanges).toHaveLength(1)
    expect(detail!.costChanges[0]).toMatchObject({ productId: PRODUCT_A, oldCost: 50, newCost: 60 })
  })

  it('returns null for an unknown batch', async () => {
    expect(await getBatchDetail('does-not-exist')).toBeNull()
  })
})

describe('rollbackBatch', () => {
  it('rolls back a clean product price+cost change (no manual edits since)', async () => {
    const batchId = await createBatch('bulk_price_csv', ADMIN_ID)
    await writePriceChange(batchId, PRODUCT_A, null, 100, 130, 120, 150)
    await writeCostChange(batchId, PRODUCT_A, null, 50, 60)
    await pool.query('UPDATE products SET price = 130, old_price = 150, cost = 60 WHERE id = $1', [PRODUCT_A])

    const result = await rollbackBatch(batchId, ADMIN_ID)
    expect(result).toEqual({ rolledBackPrice: 1, rolledBackCost: 1, conflicts: 0 })

    const { rows } = await pool.query('SELECT price, old_price as "oldPrice", cost FROM products WHERE id = $1', [PRODUCT_A])
    expect(rows[0]).toEqual({ price: 100, oldPrice: 120, cost: 50 })

    const batch = await getBatch(batchId)
    expect(batch!.status).toBe('rolled_back')
  })

  it('rolls back a variant price change cleanly', async () => {
    const batchId = await createBatch('bulk_price_csv', ADMIN_ID)
    await writePriceChange(batchId, PRODUCT_A, VARIANT_A, 60, 90, 70, 100)
    await pool.query('UPDATE product_variants SET price = 90, old_price = 100 WHERE id = $1', [VARIANT_A])

    const result = await rollbackBatch(batchId, ADMIN_ID)
    expect(result).toEqual({ rolledBackPrice: 1, rolledBackCost: 0, conflicts: 0 })

    const { rows } = await pool.query('SELECT price, old_price as "oldPrice" FROM product_variants WHERE id = $1', [VARIANT_A])
    expect(rows[0]).toEqual({ price: 60, oldPrice: 70 })
  })

  it('marks a conflict (does not overwrite) when the product was manually changed after the batch', async () => {
    const batchId = await createBatch('bulk_price_csv', ADMIN_ID)
    await writePriceChange(batchId, PRODUCT_A, null, 100, 130, 120, 150)
    // العميل عدّل السعر يدوياً لقيمة مختلفة تماماً بعد الدفعة — القيمة الحالية بقت 200، مش 130
    // اللي الدفعة كتبتها، فالتراجع لازم يرفض يلمسها.
    await pool.query('UPDATE products SET price = 200 WHERE id = $1', [PRODUCT_A])

    const result = await rollbackBatch(batchId, ADMIN_ID)
    expect(result).toEqual({ rolledBackPrice: 0, rolledBackCost: 0, conflicts: 1 })

    const { rows } = await pool.query('SELECT price FROM products WHERE id = $1', [PRODUCT_A])
    expect(rows[0].price).toBe(200)

    const batch = await getBatch(batchId)
    expect(batch!.status).toBe('partially_rolled_back')
  })

  it('partially rolls back a batch touching two products — one clean, one conflicting', async () => {
    const batchId = await createBatch('bulk_price_csv', ADMIN_ID)
    await writePriceChange(batchId, PRODUCT_A, null, 100, 130, 120, 150)
    await writePriceChange(batchId, PRODUCT_B, null, 200, 250, null, null)
    await pool.query('UPDATE products SET price = 130, old_price = 150 WHERE id = $1', [PRODUCT_A])
    await pool.query('UPDATE products SET price = 999 WHERE id = $1', [PRODUCT_B]) // تعديل يدوي بعد الدفعة

    const result = await rollbackBatch(batchId, ADMIN_ID)
    expect(result).toEqual({ rolledBackPrice: 1, rolledBackCost: 0, conflicts: 1 })

    const { rows: a } = await pool.query('SELECT price FROM products WHERE id = $1', [PRODUCT_A])
    expect(a[0].price).toBe(100)
    const { rows: b } = await pool.query('SELECT price FROM products WHERE id = $1', [PRODUCT_B])
    expect(b[0].price).toBe(999)
  })

  it('records a rollback audit log entry', async () => {
    const batchId = await createBatch('bulk_price_csv', ADMIN_ID)
    await writePriceChange(batchId, PRODUCT_A, null, 100, 130, 120, 150)
    await pool.query('UPDATE products SET price = 130, old_price = 150 WHERE id = $1', [PRODUCT_A])

    await rollbackBatch(batchId, ADMIN_ID)

    const { rows } = await pool.query(
      `SELECT action, entity_id as "entityId" FROM audit_logs WHERE action = 'bulk_price_batch_rolled_back'`
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].entityId).toBe(batchId)
  })

  it('does not mutate or delete the original price history row when rolling back — inserts a new rollback row instead', async () => {
    const batchId = await createBatch('bulk_price_csv', ADMIN_ID)
    await writePriceChange(batchId, PRODUCT_A, null, 100, 130, 120, 150)
    await pool.query('UPDATE products SET price = 130, old_price = 150 WHERE id = $1', [PRODUCT_A])

    await rollbackBatch(batchId, ADMIN_ID)

    const { rows } = await pool.query(
      `SELECT source, old_price as "oldPrice", new_price as "newPrice" FROM product_price_history WHERE product_id = $1 ORDER BY id`,
      [PRODUCT_A]
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ source: 'bulk_csv', oldPrice: 100, newPrice: 130 })
    expect(rows[1]).toMatchObject({ source: 'rollback', oldPrice: 130, newPrice: 100 })
  })
})

describe('getPriceHistoryForProduct', () => {
  it('returns entries for both the product and its variants, newest first, with admin name resolved', async () => {
    const batchId = await createBatch('bulk_price_csv', ADMIN_ID)
    await writePriceChange(batchId, PRODUCT_A, null, 100, 130, 120, 150)
    await writePriceChange(batchId, PRODUCT_A, VARIANT_A, 60, 90, 70, 100)

    const history = await getPriceHistoryForProduct(PRODUCT_A)
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({ variantId: VARIANT_A, variantName: 'كبير', oldPrice: 60, newPrice: 90, adminName: 'مدير اختبار' })
    expect(history[1]).toMatchObject({ variantId: null, variantName: null, oldPrice: 100, newPrice: 130 })
  })

  it('returns an empty list for a product with no recorded price changes', async () => {
    expect(await getPriceHistoryForProduct(PRODUCT_B)).toEqual([])
  })
})
