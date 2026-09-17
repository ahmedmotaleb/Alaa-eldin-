import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import { parseCsv, csvRecords } from '../csv.js'
import {
  PRICING_TEMPLATE_VERSION, generatePricingTemplateCsv, previewPricingCsv, confirmPricingRows,
  parseStrictPrice, parseOldPriceCell, sanitizeCsvCell, previewAdjustment, confirmAdjustment,
  getMinMarginPercent, type ConfirmRowInput
} from './bulkPricingService.js'
import { getBatchDetail } from './bulkOperationBatchService.js'

const ADMIN_ID = 'test-user-bulkpricing-admin'
const CATEGORY_ID = 'test-cat-bulkpricing'
const PRODUCT_A = 'test-prod-bp-a'
const PRODUCT_B = 'test-prod-bp-b'
const VARIANT_A = 'test-variant-bp-a'

async function insertUser(id: string) {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, $1 || '@test.local', 'x', 'مدير اختبار', now())`,
    [id]
  )
}

async function insertProduct(id: string, name: string, price: number, oldPrice: number | null, cost: number, brand = 'ماركة اختبار') {
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, old_price, cost, unit, emoji, available, stock, brand, sku, barcode, created_at)
     VALUES ($1, $1, $2, $3, 'وصف', $4, $5, $6, 'قطعة', '🧪', 1, 20, $7, $8, $9, now())`,
    [id, CATEGORY_ID, name, price, oldPrice, cost, brand, `SKU-${id}`, `BAR-${id}`]
  )
}

// مسح مقيّد بمعرفات هذا الملف بس (مش DELETE عام على الجدول) — عشان لا يتعارض مع صفوف
// حقيقية من ملفات اختبار تانية بتشتغل في نفس تشغيلة الـ suite الكاملة. الجداول اللي
// أصلاً مقيّدة (product_price_history/product_cost_history/bulk_operation_batches/
// audit_logs) بتتمسح كاملة هنا لأن مفيش عمود يربطها بمعرف الملف مباشرة، لكن afterAll
// بتستدعي نفس الدالة تانية من غير إعادة إدراج، عشان محدش يسيب صفوف معلّقة تكسر
// DELETE FROM products العام في ملفات تانية بعد ما الملف ده يخلص.
async function cleanupFixtures() {
  await pool.query(`DELETE FROM stock_movements WHERE product_id IN ($1, $2) OR product_id LIKE 'test-prod-bp-chunk-%'`, [PRODUCT_A, PRODUCT_B])
  await pool.query('DELETE FROM product_price_history')
  await pool.query('DELETE FROM product_cost_history')
  await pool.query('DELETE FROM audit_logs')
  await pool.query('DELETE FROM bulk_operation_batches')
  await pool.query('DELETE FROM product_variants')
  await pool.query(`DELETE FROM products WHERE id IN ($1, $2) OR id LIKE 'test-prod-bp-chunk-%'`, [PRODUCT_A, PRODUCT_B])
  await pool.query(`DELETE FROM categories WHERE id = $1 OR id = 'test-cat-other-bp'`, [CATEGORY_ID])
  await pool.query('DELETE FROM users WHERE id = $1', [ADMIN_ID])
}

async function resetFixtures() {
  await cleanupFixtures()
  await pool.query('UPDATE store_settings SET min_margin_percent = 15 WHERE id = 1')
  await insertUser(ADMIN_ID)
  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'قسم اختبار', '🧪', '#fff', 1)`, [CATEGORY_ID])
  await insertProduct(PRODUCT_A, 'منتج أ', 100, 120, 50)
  await insertProduct(PRODUCT_B, 'منتج ب', 200, null, 80)
  await pool.query(
    `INSERT INTO product_variants (id, product_id, name, price, old_price, cost, stock, available, sku, barcode, created_at)
     VALUES ($1, $2, 'كبير', 60, 70, 30, 5, 1, $3, $4, now())`,
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
    template_version: PRICING_TEMPLATE_VERSION,
    product_id: PRODUCT_A, variant_id: '', sku: '', barcode: '', product_name: '', variant_name: '', category: '',
    current_price: '', new_price: '', current_old_price: '', new_old_price: '', current_cost: '', new_cost: '',
    ...overrides
  }
}

function toConfirmRow(rowNumber: number, record: Record<string, string>): ConfirmRowInput {
  return { rowNumber, record }
}

describe('parseStrictPrice', () => {
  it('accepts valid Western-digit prices with up to 2 decimals', () => {
    expect(parseStrictPrice('20')).toBe(20)
    expect(parseStrictPrice('20.5')).toBe(20.5)
    expect(parseStrictPrice('20.50')).toBe(20.5)
    expect(parseStrictPrice('1250.00')).toBe(1250)
  })

  it('rejects Eastern Arabic digits, commas, currency symbols, negatives, and >2 decimals', () => {
    expect(parseStrictPrice('١٢٥')).toBeNull()
    expect(parseStrictPrice('12,5')).toBeNull()
    expect(parseStrictPrice('abc')).toBeNull()
    expect(parseStrictPrice('-20')).toBeNull()
    expect(parseStrictPrice('12.999')).toBeNull()
    expect(parseStrictPrice('--')).toBeNull()
    expect(parseStrictPrice('EGP 20')).toBeNull()
  })
})

describe('parseOldPriceCell', () => {
  it('treats a blank cell as keep', () => {
    expect(parseOldPriceCell('')).toEqual({ action: 'keep', value: null, error: null })
    expect(parseOldPriceCell(undefined)).toEqual({ action: 'keep', value: null, error: null })
  })

  it('treats CLEAR (any case) as an explicit clear', () => {
    expect(parseOldPriceCell('CLEAR')).toEqual({ action: 'clear', value: null, error: null })
    expect(parseOldPriceCell('clear')).toEqual({ action: 'clear', value: null, error: null })
  })

  it('parses a real value as an explicit set', () => {
    expect(parseOldPriceCell('150')).toEqual({ action: 'set', value: 150, error: null })
  })
})

describe('sanitizeCsvCell (formula injection protection)', () => {
  it('prefixes cells starting with =, +, -, or @ with a single quote', () => {
    expect(sanitizeCsvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)")
    expect(sanitizeCsvCell('+1234')).toBe("'+1234")
    expect(sanitizeCsvCell('-cmd')).toBe("'-cmd")
    expect(sanitizeCsvCell('@mention')).toBe("'@mention")
  })

  it('leaves ordinary cells untouched', () => {
    expect(sanitizeCsvCell('لبن كامل الدسم')).toBe('لبن كامل الدسم')
    expect(sanitizeCsvCell('ALA-000123')).toBe('ALA-000123')
  })
})

describe('generatePricingTemplateCsv', () => {
  it('includes a UTF-8 BOM and reads back correctly with Arabic names intact', async () => {
    const csv = await generatePricingTemplateCsv()
    expect(csv.startsWith('﻿')).toBe(true)
    const { headers, rows } = parseCsv(csv.slice(1))
    expect(headers).toContain('product_name')
    const records = csvRecords({ headers, rows })
    expect(records.some(r => r.product_name === 'منتج أ')).toBe(true)
  })

  it('generates one row per variant for a product that has variants, and one row for a product with none', async () => {
    const csv = await generatePricingTemplateCsv()
    const { headers, rows } = parseCsv(csv.slice(1))
    const records = csvRecords({ headers, rows })
    const productARows = records.filter(r => r.product_id === PRODUCT_A)
    expect(productARows).toHaveLength(1)
    expect(productARows[0].variant_id).toBe(VARIANT_A)
    const productBRows = records.filter(r => r.product_id === PRODUCT_B)
    expect(productBRows).toHaveLength(1)
    expect(productBRows[0].variant_id).toBe('')
  })

  it('escapes a product name that would otherwise look like a spreadsheet formula', async () => {
    await pool.query('UPDATE products SET name = $1 WHERE id = $2', ['=cmd|/c calc', PRODUCT_B])
    const csv = await generatePricingTemplateCsv()
    const { headers, rows } = parseCsv(csv.slice(1))
    const records = csvRecords({ headers, rows })
    const row = records.find(r => r.product_id === PRODUCT_B)
    expect(row!.product_name).toBe("'=cmd|/c calc")
  })

  it('includes the current template_version on every row', async () => {
    const csv = await generatePricingTemplateCsv()
    const { headers, rows } = parseCsv(csv.slice(1))
    const records = csvRecords({ headers, rows })
    expect(records.every(r => r.template_version === PRICING_TEMPLATE_VERSION)).toBe(true)
  })

  it('applies category/brand/search filters', async () => {
    const otherCat = 'test-cat-other-bp'
    await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'قسم تاني', '🧪', '#fff', 2)`, [otherCat])
    await pool.query('UPDATE products SET category_id = $1 WHERE id = $2', [otherCat, PRODUCT_B])

    const csv = await generatePricingTemplateCsv({ categoryId: CATEGORY_ID })
    const { headers, rows } = parseCsv(csv.slice(1))
    const records = csvRecords({ headers, rows })
    expect(records.map(r => r.product_id)).toEqual([PRODUCT_A])
  })
})

describe('getMinMarginPercent', () => {
  it('reads the configured value from store_settings', async () => {
    expect(await getMinMarginPercent()).toBe(15)
    await pool.query('UPDATE store_settings SET min_margin_percent = 20 WHERE id = 1')
    expect(await getMinMarginPercent()).toBe(20)
  })
})

describe('previewPricingCsv — validation', () => {
  async function preview(records: Record<string, string>[]) {
    const header = Object.keys(records[0] ?? baseRecord())
    const lines = [header.join(',')]
    for (const r of records) lines.push(header.map(h => r[h] ?? '').join(','))
    return previewPricingCsv(lines.join('\r\n'))
  }

  it('rejects an unsupported template version', async () => {
    const { rows } = await preview([baseRecord({ template_version: '1' })])
    expect(rows[0].status).toBe('error')
    expect(rows[0].errors[0]).toContain('إصدار الملف غير مدعوم')
  })

  it('marks a product price update as ready and computes difference/percent', async () => {
    const { rows } = await preview([baseRecord({ new_price: '115' })])
    expect(rows[0]).toMatchObject({ status: 'ready', currentPrice: 100, newPrice: 115, difference: 15, percentChange: 15 })
  })

  it('marks a row with no changed fields as no_change', async () => {
    const { rows } = await preview([baseRecord()])
    expect(rows[0].status).toBe('no_change')
  })

  it('blank new_price/new_cost preserve the current values exactly', async () => {
    const { rows } = await preview([baseRecord({ new_cost: '55' })])
    expect(rows[0]).toMatchObject({ newPrice: 100, newCost: 55, priceChanged: false, costChanged: true })
  })

  it('CLEAR in new_old_price clears the old price', async () => {
    const { rows } = await preview([baseRecord({ new_old_price: 'CLEAR' })])
    expect(rows[0]).toMatchObject({ newOldPriceAction: 'clear', newOldPrice: null, status: 'ready' })
  })

  it('rejects an unknown product_id', async () => {
    const { rows } = await preview([baseRecord({ product_id: 'does-not-exist', new_price: '10' })])
    expect(rows[0].status).toBe('error')
    expect(rows[0].errors).toContain('product_id غير موجود')
  })

  it('rejects an unknown variant_id', async () => {
    const { rows } = await preview([baseRecord({ variant_id: 'does-not-exist', new_price: '10' })])
    expect(rows[0].status).toBe('error')
    expect(rows[0].errors).toContain('variant_id غير موجود')
  })

  it('rejects a variant that does not belong to the stated product', async () => {
    const { rows } = await preview([baseRecord({ product_id: PRODUCT_B, variant_id: VARIANT_A, new_price: '10' })])
    expect(rows[0].status).toBe('error')
    expect(rows[0].errors).toContain('هذا المتغير لا ينتمي إلى المنتج المذكور')
  })

  it('rejects duplicate rows for the same product in the same file', async () => {
    const { rows } = await preview([baseRecord({ new_price: '110' }), baseRecord({ new_price: '115' })])
    expect(rows[0].status).toBe('ready')
    expect(rows[1].status).toBe('error')
    expect(rows[1].errors).toContain('صف مكرر لنفس المنتج/المتغير في نفس الملف')
  })

  it('rejects malformed, negative, and Eastern-digit new_price values', async () => {
    const malformed = await preview([baseRecord({ new_price: 'abc' })])
    expect(malformed.rows[0].status).toBe('error')
    const negative = await preview([baseRecord({ new_price: '-20' })])
    expect(negative.rows[0].status).toBe('error')
    const eastern = await preview([baseRecord({ new_price: '١٢٥' })])
    expect(eastern.rows[0].status).toBe('error')
  })

  it('warns on a major price decrease (50%+ lower)', async () => {
    const { rows } = await preview([baseRecord({ new_price: '40' })])
    expect(rows[0].status).toBe('warning')
    expect(rows[0].warnings.some(w => w.includes('انخفاض كبير'))).toBe(true)
  })

  it('warns on a major price increase (100%+ higher)', async () => {
    const { rows } = await preview([baseRecord({ new_price: '250' })])
    expect(rows[0].status).toBe('warning')
    expect(rows[0].warnings.some(w => w.includes('ارتفاع كبير'))).toBe(true)
  })

  it('warns when the new cost exceeds the new selling price', async () => {
    const { rows } = await preview([baseRecord({ new_price: '105', new_cost: '110' })])
    expect(rows[0].warnings).toContain('تحذير: سعر البيع أقل من التكلفة')
  })

  it('warns when the resulting margin falls below the configured minimum', async () => {
    const { rows } = await preview([baseRecord({ new_price: '90', new_cost: '80' })])
    expect(rows[0].status).toBe('warning')
    expect(rows[0].warnings).toContain('تحذير: الهامش أقل من الحد الأدنى المسموح')
  })

  it('does not warn on margin once the configured minimum is lowered below it', async () => {
    await pool.query('UPDATE store_settings SET min_margin_percent = 5 WHERE id = 1')
    const { rows } = await preview([baseRecord({ new_price: '90', new_cost: '80' })])
    expect(rows[0].warnings).not.toContain('تحذير: الهامش أقل من الحد الأدنى المسموح')
  })

  it('warns when the old price no longer exceeds the new selling price', async () => {
    const { rows } = await preview([baseRecord({ new_price: '125' })]) // current_old_price is 120
    expect(rows[0].warnings).toContain('تحذير: السعر القديم لا يزيد عن السعر الحالي')
  })

  it('validates a variant row and matches by variant_id', async () => {
    const { rows } = await preview([baseRecord({ product_id: PRODUCT_A, variant_id: VARIANT_A, new_price: '65' })])
    expect(rows[0]).toMatchObject({ kind: 'variant', status: 'ready', currentPrice: 60, newPrice: 65 })
  })
})

describe('confirmPricingRows — apply + cost history + audit + rollback data', () => {
  it('updates a product price, records price history, and creates a batch', async () => {
    const result = await confirmPricingRows([toConfirmRow(2, baseRecord({ new_price: '130' }))], ADMIN_ID)
    expect(result.updated).toBe(1)
    expect(result.failed).toBe(0)

    const { rows } = await pool.query('SELECT price FROM products WHERE id = $1', [PRODUCT_A])
    expect(rows[0].price).toBe(130)

    const detail = await getBatchDetail(result.batchId)
    expect(detail!.priceChanges).toHaveLength(1)
    expect(detail!.priceChanges[0]).toMatchObject({ oldPrice: 100, newPrice: 130, productId: PRODUCT_A })
  })

  it('updates a variant price independently of its parent product', async () => {
    const result = await confirmPricingRows(
      [toConfirmRow(2, baseRecord({ product_id: PRODUCT_A, variant_id: VARIANT_A, new_price: '65' }))],
      ADMIN_ID
    )
    expect(result.updated).toBe(1)
    const { rows: variantRows } = await pool.query('SELECT price FROM product_variants WHERE id = $1', [VARIANT_A])
    expect(variantRows[0].price).toBe(65)
    const { rows: productRows } = await pool.query('SELECT price FROM products WHERE id = $1', [PRODUCT_A])
    expect(productRows[0].price).toBe(100)
  })

  it('updates cost and writes to product_cost_history with source bulk_price_update', async () => {
    const result = await confirmPricingRows([toConfirmRow(2, baseRecord({ new_cost: '75' }))], ADMIN_ID)
    expect(result.updated).toBe(1)
    const { rows } = await pool.query(
      `SELECT unit_cost as "unitCost", old_cost as "oldCost", source_type as "sourceType" FROM product_cost_history WHERE product_id = $1`,
      [PRODUCT_A]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ unitCost: 75, oldCost: 50, sourceType: 'bulk_price_update' })
  })

  it('clears the old price when CLEAR is submitted', async () => {
    await confirmPricingRows([toConfirmRow(2, baseRecord({ new_old_price: 'CLEAR' }))], ADMIN_ID)
    const { rows } = await pool.query('SELECT old_price as "oldPrice" FROM products WHERE id = $1', [PRODUCT_A])
    expect(rows[0].oldPrice).toBeNull()
  })

  it('skips a no-change row without writing any history', async () => {
    const result = await confirmPricingRows([toConfirmRow(2, baseRecord())], ADMIN_ID)
    expect(result.updated).toBe(0)
    expect(result.skipped).toBe(1)
    const { rows } = await pool.query('SELECT count(*) as n FROM product_price_history WHERE product_id = $1', [PRODUCT_A])
    expect(Number(rows[0].n)).toBe(0)
  })

  it('skips an invalid row (re-validated at confirm time) instead of failing the whole batch', async () => {
    const result = await confirmPricingRows(
      [toConfirmRow(2, baseRecord({ new_price: '130' })), toConfirmRow(3, baseRecord({ product_id: 'unknown', new_price: '10' }))],
      ADMIN_ID
    )
    expect(result.updated).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('records a batch-level audit-visible summary via finalizeBatch totals', async () => {
    const result = await confirmPricingRows(
      [toConfirmRow(2, baseRecord({ new_price: '130' })), toConfirmRow(3, baseRecord())],
      ADMIN_ID
    )
    const detail = await getBatchDetail(result.batchId)
    expect(detail!.batch).toMatchObject({ totalRows: 2, successfulRows: 1 })
  })

  it('re-reads current values from the database at confirm time rather than trusting current_price/current_cost in the CSV', async () => {
    // الملف بيدّعي إن السعر الحالي 999 (كذب) — لازم يتجاهل تماماً ويحسب الفرق من قاعدة
    // البيانات الفعلية (100)، مش من العمود المُدّعى.
    const result = await confirmPricingRows(
      [toConfirmRow(2, baseRecord({ current_price: '999', new_price: '130' }))],
      ADMIN_ID
    )
    expect(result.updated).toBe(1)
    const detail = await getBatchDetail(result.batchId)
    expect(detail!.priceChanges[0].oldPrice).toBe(100)
  })

  it('handles a batch larger than the chunk size (200) across multiple transactions', async () => {
    for (let i = 0; i < 5; i++) {
      await insertProduct(`test-prod-bp-chunk-${i}`, `منتج ${i}`, 50, null, 20)
    }
    const rows = Array.from({ length: 5 }, (_, i) => toConfirmRow(i + 2, baseRecord({ product_id: `test-prod-bp-chunk-${i}`, new_price: '60' })))
    const result = await confirmPricingRows(rows, ADMIN_ID)
    expect(result.updated).toBe(5)
  })
})

describe('previewAdjustment / confirmAdjustment — quick bulk adjustment', () => {
  it('previews a percentage increase across a category with no rounding', async () => {
    const { rows } = await previewAdjustment({ scope: { categoryId: CATEGORY_ID }, operation: 'increase_percent', value: 10, rounding: 'none' })
    const a = rows.find(r => r.productId === PRODUCT_A)!
    expect(a.newPrice).toBe(110)
    const b = rows.find(r => r.productId === PRODUCT_B)!
    expect(b.newPrice).toBe(220)
  })

  it('applies rounding to the nearest 5 and shows the resulting price in preview', async () => {
    const { rows } = await previewAdjustment({ scope: { productIds: [PRODUCT_A] }, operation: 'increase_fixed', value: 3, rounding: 'nearest_5' })
    expect(rows[0].newPrice).toBe(105)
  })

  it('rejects a fixed decrease that would make the price zero or negative', async () => {
    const { rows } = await previewAdjustment({ scope: { productIds: [PRODUCT_A] }, operation: 'decrease_fixed', value: 100, rounding: 'none' })
    expect(rows[0].status).toBe('error')
  })

  it('confirmAdjustment recomputes fresh from the database and only applies selected rows', async () => {
    const result = await confirmAdjustment(
      { scope: { categoryId: CATEGORY_ID }, operation: 'increase_percent', value: 10, rounding: 'none' },
      [PRODUCT_A],
      ADMIN_ID
    )
    expect(result.updated).toBe(1)
    const { rows: a } = await pool.query('SELECT price FROM products WHERE id = $1', [PRODUCT_A])
    expect(a[0].price).toBe(110)
    const { rows: b } = await pool.query('SELECT price FROM products WHERE id = $1', [PRODUCT_B])
    expect(b[0].price).toBe(200)
  })

  it('records bulk_price_adjustment as the batch operation type', async () => {
    const result = await confirmAdjustment(
      { scope: { productIds: [PRODUCT_A] }, operation: 'increase_percent', value: 10, rounding: 'none' },
      [PRODUCT_A],
      ADMIN_ID
    )
    const detail = await getBatchDetail(result.batchId)
    expect(detail!.batch.operationType).toBe('bulk_price_adjustment')
  })
})
