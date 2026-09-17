import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import {
  COST_TEMPLATE_VERSION, generateCostTemplateCsv, previewCostCsv, confirmCostRows, type CostConfirmRowInput
} from './bulkCostService.js'
import { getBatchDetail, rollbackBatch } from './bulkOperationBatchService.js'

const ADMIN_ID = 'test-user-bulkcost-admin'
const CATEGORY_ID = 'test-cat-bulkcost'
const PRODUCT_A = 'test-prod-bc-a'
const PRODUCT_B = 'test-prod-bc-b'
const VARIANT_A = 'test-variant-bc-a'

async function insertUser(id: string) {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, $1 || '@test.local', 'x', 'مدير اختبار', now())`,
    [id]
  )
}

async function insertProduct(id: string, name: string, price: number, cost: number, brand = 'ماركة اختبار') {
  await pool.query(
    `INSERT INTO products (id, slug, category_id, name, description, price, cost, unit, emoji, available, stock, brand, sku, barcode, created_at)
     VALUES ($1, $1, $2, $3, 'وصف', $4, $5, 'قطعة', '🧪', 1, 20, $6, $7, $8, now())`,
    [id, CATEGORY_ID, name, price, cost, brand, `SKU-${id}`, `BAR-${id}`]
  )
}

// حذف مقيّد بمعرفات هذا الملف بس — afterAll بتستدعي نفس الدالة (من غير إعادة إدراج) عشان
// محدش يسيب صفوف معلّقة تكسر DELETE FROM products العام في ملفات تانية بعد ما الملف ده يخلص.
async function cleanupFixtures() {
  await pool.query(`DELETE FROM stock_movements WHERE product_id IN ($1, $2)`, [PRODUCT_A, PRODUCT_B])
  await pool.query('DELETE FROM product_price_history')
  await pool.query('DELETE FROM product_cost_history')
  await pool.query('DELETE FROM audit_logs')
  await pool.query('DELETE FROM bulk_operation_batches')
  await pool.query('DELETE FROM product_variants')
  await pool.query(`DELETE FROM products WHERE id IN ($1, $2)`, [PRODUCT_A, PRODUCT_B])
  await pool.query(`DELETE FROM categories WHERE id = $1`, [CATEGORY_ID])
  await pool.query('DELETE FROM users WHERE id = $1', [ADMIN_ID])
}

async function resetFixtures() {
  await cleanupFixtures()
  await pool.query('UPDATE store_settings SET min_margin_percent = 15 WHERE id = 1')
  await insertUser(ADMIN_ID)
  await pool.query(`INSERT INTO categories (id, name, emoji, tint, sort_order) VALUES ($1, 'قسم اختبار', '🧪', '#fff', 1)`, [CATEGORY_ID])
  await insertProduct(PRODUCT_A, 'منتج أ', 100, 50)
  await insertProduct(PRODUCT_B, 'منتج ب', 200, 80)
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
    template_version: COST_TEMPLATE_VERSION,
    product_id: PRODUCT_A, variant_id: '', sku: '', barcode: '', product_name: '', variant_name: '', category: '',
    current_cost: '', new_cost: '',
    ...overrides
  }
}

function toConfirmRow(rowNumber: number, record: Record<string, string>): CostConfirmRowInput {
  return { rowNumber, record }
}

describe('generateCostTemplateCsv', () => {
  it('includes current cost for products and variants, leaves new_cost blank', async () => {
    const csv = await generateCostTemplateCsv({ search: 'منتج أ' })
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain(PRODUCT_A)
    expect(csv).toContain(VARIANT_A)
  })
})

describe('previewCostCsv — validation', () => {
  async function preview(records: Record<string, string>[]) {
    const header = Object.keys(records[0] ?? baseRecord())
    const lines = [header.join(',')]
    for (const r of records) lines.push(header.map(h => r[h] ?? '').join(','))
    return previewCostCsv(lines.join('\r\n'))
  }

  it('rejects an unsupported template version', async () => {
    const { rows } = await preview([baseRecord({ template_version: '0' })])
    expect(rows[0].status).toBe('error')
  })

  it('marks a cost update as ready when margin stays healthy', async () => {
    const { rows } = await preview([baseRecord({ new_cost: '55' })]) // price 100 -> margin 45%
    expect(rows[0]).toMatchObject({ status: 'ready', currentCost: 50, newCost: 55, costChanged: true })
  })

  it('marks a row with no changed cost as no_change', async () => {
    const { rows } = await preview([baseRecord({ new_cost: '50' })])
    expect(rows[0].status).toBe('no_change')
  })

  it('rejects malformed, negative, and Eastern-digit new_cost values', async () => {
    const malformed = await preview([baseRecord({ new_cost: 'abc' })])
    expect(malformed.rows[0].status).toBe('error')
    const negative = await preview([baseRecord({ new_cost: '-10' })])
    expect(negative.rows[0].status).toBe('error')
    const eastern = await preview([baseRecord({ new_cost: '٥٠' })])
    expect(eastern.rows[0].status).toBe('error')
  })

  it('warns when the new cost exceeds the current selling price', async () => {
    const { rows } = await preview([baseRecord({ new_cost: '150' })]) // price 100
    expect(rows[0].status).toBe('warning')
    expect(rows[0].warnings).toContain('تحذير: التكلفة الجديدة أعلى من سعر البيع الحالي')
  })

  it('warns when the resulting margin falls below the configured minimum', async () => {
    const { rows } = await preview([baseRecord({ new_cost: '90' })]) // price 100 -> margin 10% < 15%
    expect(rows[0].status).toBe('warning')
    expect(rows[0].warnings).toContain('تحذير: الهامش أقل من الحد الأدنى المسموح')
  })

  it('does not warn on margin once the configured minimum is lowered below it', async () => {
    await pool.query('UPDATE store_settings SET min_margin_percent = 5 WHERE id = 1')
    const { rows } = await preview([baseRecord({ new_cost: '90' })])
    expect(rows[0].warnings).not.toContain('تحذير: الهامش أقل من الحد الأدنى المسموح')
  })

  it('validates a variant row and matches by variant_id', async () => {
    const { rows } = await preview([baseRecord({ product_id: PRODUCT_A, variant_id: VARIANT_A, new_cost: '35' })])
    expect(rows[0]).toMatchObject({ kind: 'variant', status: 'ready', currentCost: 30, newCost: 35 })
  })

  it('rejects duplicate rows for the same product in the same file', async () => {
    const { rows } = await preview([baseRecord({ new_cost: '55' }), baseRecord({ new_cost: '60' })])
    expect(rows[0].status).toBe('ready')
    expect(rows[1].status).toBe('error')
    expect(rows[1].errors).toContain('صف مكرر لنفس المنتج/المتغير في نفس الملف')
  })
})

describe('confirmCostRows — apply + cost history + audit + rollback', () => {
  it('updates a product cost, records cost history, and creates a bulk_cost_csv batch', async () => {
    const result = await confirmCostRows([toConfirmRow(2, baseRecord({ new_cost: '55' }))], ADMIN_ID)
    expect(result).toMatchObject({ updated: 1, skipped: 0, failed: 0 })

    const { rows: productRows } = await pool.query('SELECT cost FROM products WHERE id = $1', [PRODUCT_A])
    expect(productRows[0].cost).toBe(55)

    const detail = await getBatchDetail(result.batchId)
    expect(detail!.batch.operationType).toBe('bulk_cost_csv')
    expect(detail!.costChanges).toHaveLength(1)
    expect(detail!.costChanges[0]).toMatchObject({ productId: PRODUCT_A, oldCost: 50, newCost: 55 })
  })

  it('does not touch price when updating cost', async () => {
    await confirmCostRows([toConfirmRow(2, baseRecord({ new_cost: '55' }))], ADMIN_ID)
    const { rows } = await pool.query('SELECT price FROM products WHERE id = $1', [PRODUCT_A])
    expect(rows[0].price).toBe(100)
  })

  it('never trusts current_cost from the uploaded file — re-reads the real value at confirm time', async () => {
    const result = await confirmCostRows(
      [toConfirmRow(2, baseRecord({ current_cost: '999', new_cost: '60' }))],
      ADMIN_ID
    )
    expect(result.updated).toBe(1)
    const { rows } = await pool.query('SELECT cost FROM products WHERE id = $1', [PRODUCT_A])
    expect(rows[0].cost).toBe(60)
  })

  it('updates variant cost independently of the parent product', async () => {
    const result = await confirmCostRows(
      [toConfirmRow(2, baseRecord({ product_id: PRODUCT_A, variant_id: VARIANT_A, new_cost: '35' }))],
      ADMIN_ID
    )
    expect(result.updated).toBe(1)
    const { rows } = await pool.query('SELECT cost FROM product_variants WHERE id = $1', [VARIANT_A])
    expect(rows[0].cost).toBe(35)
  })

  it('skips rows with errors or no real change', async () => {
    const result = await confirmCostRows(
      [
        toConfirmRow(2, baseRecord({ new_cost: '50' })),
        toConfirmRow(3, baseRecord({ new_cost: 'abc' }))
      ],
      ADMIN_ID
    )
    expect(result).toMatchObject({ updated: 0, skipped: 2, failed: 0 })
  })

  it('can be rolled back cleanly through the shared batch rollback mechanism', async () => {
    const result = await confirmCostRows([toConfirmRow(2, baseRecord({ new_cost: '55' }))], ADMIN_ID)
    const rollback = await rollbackBatch(result.batchId, ADMIN_ID)
    expect(rollback).toEqual({ rolledBackPrice: 0, rolledBackCost: 1, rolledBackStock: 0, conflicts: 0 })

    const { rows } = await pool.query('SELECT cost FROM products WHERE id = $1', [PRODUCT_A])
    expect(rows[0].cost).toBe(50)
  })
})
