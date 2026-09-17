import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import {
  STOCK_TEMPLATE_VERSION, generateStockTemplateCsv, previewStockCsv, confirmStockRows,
  parseStrictInteger, previewStockAdjustment, confirmStockAdjustment, type StockConfirmRowInput
} from './bulkStockService.js'
import { getBatchDetail } from './bulkOperationBatchService.js'

const ADMIN_ID = 'test-user-bulkstock-admin'
const CATEGORY_ID = 'test-cat-bulkstock'
const PRODUCT_A = 'test-prod-bs-a'
const PRODUCT_B = 'test-prod-bs-b'
const VARIANT_A = 'test-variant-bs-a'

async function insertUser(id: string) {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, $1 || '@test.local', 'x', 'مدير اختبار', now())`,
    [id]
  )
}

async function insertProduct(id: string, name: string, stock: number, brand = 'ماركة اختبار') {
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, brand, sku, barcode, created_at)
     VALUES ($1, $1, $2, $3, 'وصف', 100, 50, 'قطعة', '🧪', 1, $4, $5, $6, $7, now())`,
    [id, CATEGORY_ID, name, stock, brand, `SKU-${id}`, `BAR-${id}`]
  )
}

// حذف مقيّد بمعرفات هذا الملف بس — afterAll بتستدعي نفس الدالة (من غير إعادة إدراج) عشان
// محدش يسيب صفوف معلّقة تكسر DELETE FROM products العام في ملفات تانية بعد ما الملف ده يخلص.
async function cleanupFixtures() {
  await pool.query(`DELETE FROM stock_movements WHERE product_id IN ($1, $2) OR product_id LIKE 'test-prod-bs-chunk-%'`, [PRODUCT_A, PRODUCT_B])
  await pool.query('DELETE FROM bulk_operation_batches')
  await pool.query('DELETE FROM audit_logs')
  await pool.query('DELETE FROM back_in_stock_subscriptions')
  await pool.query('DELETE FROM product_variants')
  await pool.query(`DELETE FROM products WHERE id IN ($1, $2) OR id LIKE 'test-prod-bs-chunk-%'`, [PRODUCT_A, PRODUCT_B])
  await pool.query(`DELETE FROM categories WHERE id = $1`, [CATEGORY_ID])
  await pool.query('DELETE FROM users WHERE id = $1', [ADMIN_ID])
}

async function resetFixtures() {
  await cleanupFixtures()
  await insertUser(ADMIN_ID)
  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'قسم اختبار', '🧪', '#fff', 1)`, [CATEGORY_ID])
  await insertProduct(PRODUCT_A, 'منتج أ', 20)
  await insertProduct(PRODUCT_B, 'منتج ب', 0)
  await pool.query(
    `INSERT INTO product_variants (id, product_id, name, price, cost, stock, available, sku, barcode, created_at)
     VALUES ($1, $2, 'كبير', 60, 30, 5, 1, $3, $4, now())`,
    [VARIANT_A, PRODUCT_A, `SKU-${VARIANT_A}`, `BAR-${VARIANT_A}`]
  )
}

beforeEach(async () => {
  await resetFixtures()
})

afterAll(async () => {
  await cleanupFixtures()
  await pool.end()
})

function baseRecord(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    template_version: STOCK_TEMPLATE_VERSION,
    product_id: PRODUCT_A, variant_id: '', sku: '', barcode: '', product_name: '', variant_name: '', category: '',
    current_stock: '', new_stock: '', reason: '',
    ...overrides
  }
}

function toConfirmRow(rowNumber: number, record: Record<string, string>): StockConfirmRowInput {
  return { rowNumber, record }
}

describe('parseStrictInteger', () => {
  it('accepts non-negative whole numbers only', () => {
    expect(parseStrictInteger('20')).toBe(20)
    expect(parseStrictInteger('0')).toBe(0)
  })
  it('rejects decimals, negatives, Eastern digits, and non-numeric text', () => {
    expect(parseStrictInteger('20.5')).toBeNull()
    expect(parseStrictInteger('-5')).toBeNull()
    expect(parseStrictInteger('٢٠')).toBeNull()
    expect(parseStrictInteger('abc')).toBeNull()
    expect(parseStrictInteger('')).toBeNull()
  })
})

describe('generateStockTemplateCsv', () => {
  it('includes current stock for products and variants, leaves new_stock/reason blank', async () => {
    const csv = await generateStockTemplateCsv({ search: 'منتج أ' })
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain(PRODUCT_A)
    expect(csv).toContain(VARIANT_A)
  })
})

describe('previewStockCsv — validation', () => {
  async function preview(records: Record<string, string>[]) {
    const header = Object.keys(records[0] ?? baseRecord())
    const lines = [header.join(',')]
    for (const r of records) lines.push(header.map(h => r[h] ?? '').join(','))
    return previewStockCsv(lines.join('\r\n'))
  }

  it('rejects an unsupported template version', async () => {
    const { rows } = await preview([baseRecord({ template_version: '0' })])
    expect(rows[0].status).toBe('error')
  })

  it('marks a stock update as ready and computes quantityChange', async () => {
    const { rows } = await preview([baseRecord({ new_stock: '35', reason: 'restock' })])
    expect(rows[0]).toMatchObject({ status: 'ready', currentStock: 20, newStock: 35, quantityChange: 15 })
  })

  it('marks a row with no changed stock as no_change', async () => {
    const { rows } = await preview([baseRecord({ new_stock: '20' })])
    expect(rows[0].status).toBe('no_change')
  })

  it('requires a reason when stock actually changes', async () => {
    const { rows } = await preview([baseRecord({ new_stock: '35' })])
    expect(rows[0].status).toBe('error')
    expect(rows[0].errors).toContain('reason مطلوب عند تغيير المخزون')
  })

  it('rejects an unknown reason', async () => {
    const { rows } = await preview([baseRecord({ new_stock: '35', reason: 'not_a_real_reason' })])
    expect(rows[0].status).toBe('error')
    expect(rows[0].errors).toContain('reason: سبب غير صحيح')
  })

  it('rejects negative, decimal, and Eastern-digit new_stock values', async () => {
    const negative = await preview([baseRecord({ new_stock: '-5', reason: 'adjustment' })])
    expect(negative.rows[0].status).toBe('error')
    const decimal = await preview([baseRecord({ new_stock: '5.5', reason: 'adjustment' })])
    expect(decimal.rows[0].status).toBe('error')
    const eastern = await preview([baseRecord({ new_stock: '٢٠', reason: 'adjustment' })])
    expect(eastern.rows[0].status).toBe('error')
  })

  it('warns when stock is set to zero', async () => {
    const { rows } = await preview([baseRecord({ new_stock: '0', reason: 'loss' })])
    expect(rows[0].status).toBe('warning')
    expect(rows[0].warnings).toContain('تحذير: المخزون سيصبح صفر')
  })

  it('warns on a large stock decrease (90%+ lower)', async () => {
    const { rows } = await preview([baseRecord({ new_stock: '1', reason: 'damage' })])
    expect(rows[0].status).toBe('warning')
    expect(rows[0].warnings).toContain('تحذير: انخفاض كبير في المخزون')
  })

  it('validates a variant row and matches by variant_id', async () => {
    const { rows } = await preview([baseRecord({ product_id: PRODUCT_A, variant_id: VARIANT_A, new_stock: '10', reason: 'restock' })])
    expect(rows[0]).toMatchObject({ kind: 'variant', status: 'ready', currentStock: 5, newStock: 10 })
  })

  it('rejects duplicate rows for the same product in the same file', async () => {
    const { rows } = await preview([
      baseRecord({ new_stock: '25', reason: 'restock' }),
      baseRecord({ new_stock: '30', reason: 'restock' })
    ])
    expect(rows[0].status).toBe('ready')
    expect(rows[1].status).toBe('error')
    expect(rows[1].errors).toContain('صف مكرر لنفس المنتج/المتغير في نفس الملف')
  })
})

describe('confirmStockRows — apply + movement + batch + back-in-stock', () => {
  it('updates product stock, records a movement, and creates a batch', async () => {
    const result = await confirmStockRows([toConfirmRow(2, baseRecord({ new_stock: '35', reason: 'restock' }))], ADMIN_ID)
    expect(result).toMatchObject({ updated: 1, skipped: 0, failed: 0 })

    const { rows: productRows } = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_A])
    expect(productRows[0].stock).toBe(35)

    const { rows: moveRows } = await pool.query(
      'SELECT type, quantity_change as "quantityChange", quantity_before as "quantityBefore", quantity_after as "quantityAfter", bulk_batch_id as "bulkBatchId" FROM stock_movements WHERE product_id = $1',
      [PRODUCT_A]
    )
    expect(moveRows).toHaveLength(1)
    expect(moveRows[0]).toMatchObject({ type: 'restock', quantityChange: 15, quantityBefore: 20, quantityAfter: 35, bulkBatchId: result.batchId })

    const detail = await getBatchDetail(result.batchId)
    expect(detail!.batch.operationType).toBe('bulk_stock_csv')
    expect(detail!.stockChanges).toHaveLength(1)
  })

  it('updates variant stock independently of the parent product', async () => {
    const result = await confirmStockRows(
      [toConfirmRow(2, baseRecord({ product_id: PRODUCT_A, variant_id: VARIANT_A, new_stock: '12', reason: 'restock' }))],
      ADMIN_ID
    )
    expect(result.updated).toBe(1)
    const { rows } = await pool.query('SELECT stock FROM product_variants WHERE id = $1', [VARIANT_A])
    expect(rows[0].stock).toBe(12)
  })

  it('clears a back-in-stock subscription when a restock brings an out-of-stock product back', async () => {
    await pool.query(
      `INSERT INTO back_in_stock_subscriptions (user_id, product_id, created_at) VALUES ($1, $2, now())`,
      [ADMIN_ID, PRODUCT_B]
    )
    const result = await confirmStockRows(
      [toConfirmRow(2, baseRecord({ product_id: PRODUCT_B, new_stock: '10', reason: 'restock' }))],
      ADMIN_ID
    )
    expect(result.updated).toBe(1)
    const { rows } = await pool.query('SELECT id FROM back_in_stock_subscriptions WHERE product_id = $1', [PRODUCT_B])
    expect(rows).toHaveLength(0)
  })

  it('never trusts current_stock from the uploaded file — re-reads the real value at confirm time', async () => {
    const result = await confirmStockRows(
      [toConfirmRow(2, baseRecord({ current_stock: '999', new_stock: '25', reason: 'adjustment' }))],
      ADMIN_ID
    )
    expect(result.updated).toBe(1)
    const { rows } = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_A])
    expect(rows[0].stock).toBe(25)
  })

  it('skips rows with no real change and rows that fail revalidation, without touching the database', async () => {
    const result = await confirmStockRows(
      [
        toConfirmRow(2, baseRecord({ new_stock: '20' })),
        toConfirmRow(3, baseRecord({ new_stock: '-5', reason: 'adjustment' }))
      ],
      ADMIN_ID
    )
    expect(result).toMatchObject({ updated: 0, skipped: 2, failed: 0 })
    const { rows } = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_A])
    expect(rows[0].stock).toBe(20)
  })
})

describe('previewStockAdjustment / confirmStockAdjustment — quick bulk adjustment', () => {
  it('previews a set_to adjustment across a category scope', async () => {
    const { rows } = await previewStockAdjustment({ scope: { categoryId: CATEGORY_ID }, operation: 'set_to', value: 40, reason: 'adjustment' })
    const forA = rows.find(r => r.productId === PRODUCT_A)!
    expect(forA).toMatchObject({ currentStock: 20, newStock: 40, quantityChange: 20, status: 'ready' })
  })

  it('recomputes from live stock at confirm time rather than trusting the preview', async () => {
    const input = { scope: { productIds: [PRODUCT_A] }, operation: 'increase_by' as const, value: 10, reason: 'restock' as const }
    await pool.query('UPDATE products SET stock = 100 WHERE id = $1', [PRODUCT_A])

    const result = await confirmStockAdjustment(input, [PRODUCT_A], ADMIN_ID)
    expect(result.updated).toBe(1)
    const { rows } = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_A])
    expect(rows[0].stock).toBe(110)
  })

  it('only applies to explicitly selected products even when scope matches more', async () => {
    const input = { scope: { categoryId: CATEGORY_ID }, operation: 'set_to' as const, value: 5, reason: 'damage' as const }
    const result = await confirmStockAdjustment(input, [PRODUCT_A], ADMIN_ID)
    expect(result.updated).toBe(1)

    const { rows: a } = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_A])
    expect(a[0].stock).toBe(5)
    const { rows: b } = await pool.query('SELECT stock FROM products WHERE id = $1', [PRODUCT_B])
    expect(b[0].stock).toBe(0)
  })
})
