import type { PoolClient } from 'pg'
import { pool, withTransaction } from '../db.js'
import { toCsv, csvRecords, parseCsv } from '../csv.js'
import { createBatch, finalizeBatch, type BulkOperationType } from './bulkOperationBatchService.js'
import { notifyBackInStockIfNeeded } from './backInStockService.js'
import { sanitizeCsvCell, type ApplyResult, type ApplyResultRow } from './bulkPricingService.js'

// نفس قائمة أسباب حركة المخزون القابلة للاختيار يدوياً في شاشة التعديل الفردي
// (server/src/routes/adminStockMovements.ts) — مصدر واحد للحقيقة، الأنواع التانية
// المسموحة في قيد stock_movements.type ('sale', 'cancel_restore', 'expired', ...) دي
// أنواع نظامية بتتسجّل تلقائياً من تدفقات تانية، مش قابلة للاختيار هنا ولا في CSV الجملة.
export const MANUAL_STOCK_REASONS = ['restock', 'return', 'damage', 'loss', 'adjustment'] as const
export type ManualStockReason = typeof MANUAL_STOCK_REASONS[number]

export const STOCK_TEMPLATE_VERSION = '1'

export const STOCK_CSV_HEADERS = [
  'template_version', 'product_id', 'variant_id', 'sku', 'barcode', 'product_name', 'variant_name',
  'category', 'current_stock', 'new_stock', 'reason'
] as const

const EASTERN_DIGITS = /[٠-٩]/

// كمية صحيحة غير سالبة بس — نفس صرامة parseStrictPrice في bulkPricingService لكن بدون
// سماح بأي كسور عشرية (المخزون دايماً عدد صحيح من الوحدات).
export function parseStrictInteger(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (EASTERN_DIGITS.test(trimmed)) return null
  if (!/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

export type StockRowKind = 'product' | 'variant'
export type StockRowStatus = 'ready' | 'no_change' | 'warning' | 'error'

export interface StockPreviewRow {
  rowNumber: number
  kind: StockRowKind
  productId: string
  variantId: string | null
  sku: string | null
  barcode: string
  productName: string
  variantName: string | null
  currentStock: number
  newStock: number
  quantityChange: number
  reason: string | null
  status: StockRowStatus
  errors: string[]
  warnings: string[]
}

interface CurrentProductStockRow {
  id: string
  name: string
  sku: string | null
  barcode: string
  stock: number
  categoryName: string
}

interface CurrentVariantStockRow {
  id: string
  productId: string
  name: string
  sku: string | null
  barcode: string
  stock: number
}

async function loadCurrentProductsStock(): Promise<Map<string, CurrentProductStockRow>> {
  const { rows } = await pool.query<CurrentProductStockRow>(
    `SELECT p.id, p.name, p.sku, p.barcode, p.stock, c.name as "categoryName"
     FROM products p JOIN categories c ON c.id = p.category_id`
  )
  return new Map(rows.map(r => [r.id, r]))
}

async function loadCurrentVariantsStock(): Promise<Map<string, CurrentVariantStockRow>> {
  const { rows } = await pool.query<CurrentVariantStockRow>(
    `SELECT id, product_id as "productId", name, sku, barcode, stock FROM product_variants`
  )
  return new Map(rows.map(r => [r.id, r]))
}

export interface StockTemplateFilters {
  categoryId?: string
  brand?: string
  availableOnly?: boolean
  outOfStockOnly?: boolean
  hasVariants?: boolean
  noVariants?: boolean
  search?: string
}

interface TemplateProductRow {
  id: string
  name: string
  sku: string | null
  barcode: string
  stock: number
  categoryName: string
}

interface TemplateVariantRow {
  id: string
  productId: string
  name: string
  sku: string | null
  barcode: string
  stock: number
}

export async function generateStockTemplateCsv(filters: StockTemplateFilters = {}): Promise<string> {
  const conditions: string[] = []
  const params: unknown[] = []

  if (filters.categoryId) { params.push(filters.categoryId); conditions.push(`p.category_id = $${params.length}`) }
  if (filters.brand) { params.push(filters.brand); conditions.push(`p.brand = $${params.length}`) }
  if (filters.availableOnly) conditions.push(`p.available = 1`)
  if (filters.outOfStockOnly) conditions.push(`p.stock <= 0`)
  if (filters.search) {
    params.push(`%${filters.search}%`)
    conditions.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR p.barcode ILIKE $${params.length})`)
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const { rows: products } = await pool.query<TemplateProductRow & { variantCount: string }>(
    `SELECT p.id, p.name, p.sku, p.barcode, p.stock, c.name as "categoryName",
            (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id) as "variantCount"
     FROM products p JOIN categories c ON c.id = p.category_id
     ${whereClause}
     ORDER BY p.name`,
    params
  )

  const filteredProducts = products.filter(p => {
    const hasVariants = Number(p.variantCount) > 0
    if (filters.hasVariants && !hasVariants) return false
    if (filters.noVariants && hasVariants) return false
    return true
  })

  const productIds = filteredProducts.map(p => p.id)
  const { rows: variants } = productIds.length
    ? await pool.query<TemplateVariantRow>(
        `SELECT id, product_id as "productId", name, sku, barcode, stock
         FROM product_variants WHERE product_id = ANY($1::text[]) ORDER BY sort_order, created_at`,
        [productIds]
      )
    : { rows: [] }
  const variantsByProduct = new Map<string, TemplateVariantRow[]>()
  for (const v of variants) {
    if (!variantsByProduct.has(v.productId)) variantsByProduct.set(v.productId, [])
    variantsByProduct.get(v.productId)!.push(v)
  }

  const csvRows: unknown[][] = []
  for (const p of filteredProducts) {
    const productVariants = variantsByProduct.get(p.id) ?? []
    if (productVariants.length === 0) {
      csvRows.push([
        STOCK_TEMPLATE_VERSION, p.id, '', sanitizeCsvCell(p.sku ?? ''), sanitizeCsvCell(p.barcode),
        sanitizeCsvCell(p.name), '', sanitizeCsvCell(p.categoryName), p.stock, '', ''
      ])
    } else {
      for (const v of productVariants) {
        csvRows.push([
          STOCK_TEMPLATE_VERSION, p.id, v.id, sanitizeCsvCell(v.sku ?? ''), sanitizeCsvCell(v.barcode),
          sanitizeCsvCell(p.name), sanitizeCsvCell(v.name), sanitizeCsvCell(p.categoryName), v.stock, '', ''
        ])
      }
    }
  }

  return '﻿' + toCsv([...STOCK_CSV_HEADERS], csvRows)
}

export function todayFilenameSuffix(): string {
  return new Date().toISOString().slice(0, 10)
}

const WARNING_STOCK_ZEROED = 'تحذير: المخزون سيصبح صفر'
const WARNING_LARGE_DECREASE = 'تحذير: انخفاض كبير في المخزون'

function computeStockWarnings(currentStock: number, newStock: number): string[] {
  const warnings: string[] = []
  if (newStock === 0 && currentStock > 0) warnings.push(WARNING_STOCK_ZEROED)
  else if (currentStock > 0 && newStock <= currentStock * 0.1) warnings.push(WARNING_LARGE_DECREASE)
  return warnings
}

// نفس مبدأ validatePricingRecord بالظبط: current_stock في أي CSV مرفوع أبداً ما بيتقروش من
// هنا — القيم الحالية بتُقرأ فقط من الخرائط الجايه من قاعدة البيانات فعلياً.
export function validateStockRecord(
  rowNumber: number,
  record: Record<string, string | undefined>,
  currentProducts: Map<string, CurrentProductStockRow>,
  currentVariants: Map<string, CurrentVariantStockRow>,
  seenKeys: Set<string>
): StockPreviewRow {
  const errors: string[] = []
  const warnings: string[] = []

  const productId = record.product_id?.trim() ?? ''
  const variantId = record.variant_id?.trim() || null
  const kind: StockRowKind = variantId ? 'variant' : 'product'

  if (record.template_version?.trim() !== STOCK_TEMPLATE_VERSION) {
    errors.push('إصدار الملف غير مدعوم. يرجى تحميل قالب جديد.')
  }
  if (!productId) errors.push('product_id مطلوب')

  let current: CurrentProductStockRow | CurrentVariantStockRow | null = null
  let productName = ''
  let variantName: string | null = null
  let categoryOrParentOk = true

  if (variantId) {
    const variant = currentVariants.get(variantId)
    if (!variant) {
      errors.push('variant_id غير موجود')
    } else if (productId && variant.productId !== productId) {
      errors.push('هذا المتغير لا ينتمي إلى المنتج المذكور')
      categoryOrParentOk = false
    } else {
      current = variant
      variantName = variant.name
      const parentProduct = currentProducts.get(variant.productId)
      productName = parentProduct?.name ?? ''
    }
  } else if (productId) {
    const product = currentProducts.get(productId)
    if (!product) errors.push('product_id غير موجود')
    else { current = product; productName = product.name }
  }

  const dedupeKey = `${kind}:${variantId ?? productId}`
  if (productId && categoryOrParentOk) {
    if (seenKeys.has(dedupeKey)) errors.push('صف مكرر لنفس المنتج/المتغير في نفس الملف')
    else seenKeys.add(dedupeKey)
  }

  const newStockRaw = record.new_stock?.trim() ?? ''
  const reasonRaw = record.reason?.trim() ?? ''
  let newStock = current?.stock ?? 0
  let quantityChanged = false

  if (newStockRaw) {
    const parsed = parseStrictInteger(newStockRaw)
    if (parsed === null) errors.push('new_stock: قيمة غير صحيحة (رقم صحيح غير سالب فقط)')
    else {
      newStock = parsed
      quantityChanged = current !== null && parsed !== current.stock
      if (quantityChanged) {
        if (!reasonRaw) errors.push('reason مطلوب عند تغيير المخزون')
        else if (!(MANUAL_STOCK_REASONS as readonly string[]).includes(reasonRaw)) errors.push('reason: سبب غير صحيح')
      }
    }
  }

  if (errors.length === 0 && current && quantityChanged) {
    warnings.push(...computeStockWarnings(current.stock, newStock))
  }

  const status: StockRowStatus = errors.length > 0 ? 'error' : !quantityChanged ? 'no_change' : warnings.length > 0 ? 'warning' : 'ready'

  return {
    rowNumber,
    kind,
    productId: current ? (kind === 'variant' ? (current as CurrentVariantStockRow).productId : current.id) : productId,
    variantId,
    sku: current?.sku ?? null,
    barcode: current?.barcode ?? '',
    productName,
    variantName,
    currentStock: current?.stock ?? 0,
    newStock,
    quantityChange: current ? newStock - current.stock : 0,
    reason: quantityChanged ? reasonRaw : null,
    status,
    errors,
    warnings
  }
}

export interface StockPreviewSummary {
  totalRows: number
  ready: number
  noChange: number
  warnings: number
  errors: number
  increases: number
  decreases: number
}

export function summarizeStockRows(rows: StockPreviewRow[]): StockPreviewSummary {
  const changed = rows.filter(r => r.status === 'ready' || r.status === 'warning')
  return {
    totalRows: rows.length,
    ready: rows.filter(r => r.status === 'ready').length,
    noChange: rows.filter(r => r.status === 'no_change').length,
    warnings: rows.filter(r => r.status === 'warning').length,
    errors: rows.filter(r => r.status === 'error').length,
    increases: changed.filter(r => r.quantityChange > 0).length,
    decreases: changed.filter(r => r.quantityChange < 0).length
  }
}

export async function previewStockCsv(csvText: string): Promise<{ rows: StockPreviewRow[], summary: StockPreviewSummary }> {
  const { headers, rows: rawRows } = parseCsv(csvText)
  const records = csvRecords({ headers, rows: rawRows })
  const currentProducts = await loadCurrentProductsStock()
  const currentVariants = await loadCurrentVariantsStock()
  const seenKeys = new Set<string>()

  const rows = records.map((r, i) => validateStockRecord(i + 2, r, currentProducts, currentVariants, seenKeys))
  return { rows, summary: summarizeStockRows(rows) }
}

export interface StockConfirmRowInput {
  rowNumber: number
  record: Record<string, string | undefined>
}

const CHUNK_SIZE = 200

export async function confirmStockRows(
  selectedRows: StockConfirmRowInput[],
  adminUserId: string,
  operationType: BulkOperationType = 'bulk_stock_csv'
): Promise<ApplyResult> {
  const currentProducts = await loadCurrentProductsStock()
  const currentVariants = await loadCurrentVariantsStock()
  const seenKeys = new Set<string>()

  const revalidated = selectedRows.map(({ rowNumber, record }) =>
    validateStockRecord(rowNumber, record, currentProducts, currentVariants, seenKeys)
  )

  const batchId = await createBatch(operationType, adminUserId)
  const resultRows: ApplyResultRow[] = []
  let updated = 0, skipped = 0, failed = 0

  for (let start = 0; start < revalidated.length; start += CHUNK_SIZE) {
    const chunk = revalidated.slice(start, start + CHUNK_SIZE)
    await withTransaction(async client => {
      for (const row of chunk) {
        const base = { rowNumber: row.rowNumber, productId: row.productId, variantId: row.variantId, sku: row.sku, productName: row.productName }
        if (row.status === 'error') {
          resultRows.push({ ...base, result: 'skipped', reason: row.errors[0] ?? 'invalid_row' })
          skipped++
          continue
        }
        if (row.status === 'no_change') {
          resultRows.push({ ...base, result: 'skipped', reason: 'no_change' })
          skipped++
          continue
        }
        try {
          await applyOneStockRow(client, row, adminUserId, batchId)
          resultRows.push({ ...base, result: 'updated' })
          updated++
        } catch (err) {
          resultRows.push({ ...base, result: 'failed', reason: err instanceof Error ? err.message : 'unknown_error' })
          failed++
        }
      }
    })
  }

  await finalizeBatch(batchId, { totalRows: revalidated.length, successfulRows: updated, failedRows: failed + skipped })
  return { batchId, totalRows: revalidated.length, updated, skipped, failed, rows: resultRows }
}

async function applyOneStockRow(client: PoolClient, row: StockPreviewRow, adminUserId: string, batchId: string): Promise<void> {
  const reason = row.reason ?? 'adjustment'
  if (row.kind === 'variant' && row.variantId) {
    const { rows: current } = await client.query<{ stock: number }>('SELECT stock FROM product_variants WHERE id = $1 FOR UPDATE', [row.variantId])
    const cur = current[0]
    if (!cur) throw new Error('variant_not_found')
    const quantityChange = row.newStock - cur.stock
    if (quantityChange === 0) return

    await client.query('UPDATE product_variants SET stock = $1 WHERE id = $2', [row.newStock, row.variantId])
    await client.query(
      `INSERT INTO stock_movements (product_id, variant_id, type, quantity_change, quantity_before, quantity_after, note, created_by_user_id, bulk_batch_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'تحديث مخزون بالجملة', $7, $8, now())`,
      [row.productId, row.variantId, reason, quantityChange, cur.stock, row.newStock, adminUserId, batchId]
    )
  } else {
    const { rows: current } = await client.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1 FOR UPDATE', [row.productId])
    const cur = current[0]
    if (!cur) throw new Error('product_not_found')
    const quantityChange = row.newStock - cur.stock
    if (quantityChange === 0) return

    await client.query('UPDATE products SET stock = $1 WHERE id = $2', [row.newStock, row.productId])
    await client.query(
      `INSERT INTO stock_movements (product_id, variant_id, type, quantity_change, quantity_before, quantity_after, note, created_by_user_id, bulk_batch_id, created_at)
       VALUES ($1, NULL, $2, $3, $4, $5, 'تحديث مخزون بالجملة', $6, $7, now())`,
      [row.productId, reason, quantityChange, cur.stock, row.newStock, adminUserId, batchId]
    )
    if (quantityChange > 0) await notifyBackInStockIfNeeded(client, row.productId)
  }
}

// ============ التعديل السريع (تحديد قيمة/زيادة/خفض على نطاق منتجات) ============
// نطاق المنتجات بس في هذا الإصدار (بدون متغيرات) — نفس حدود الـ MVP المتّبعة في bulkPricingService.

export type StockAdjustmentOperation = 'set_to' | 'increase_by' | 'decrease_by'

export interface StockAdjustmentScope {
  productIds?: string[]
  categoryId?: string
  brand?: string
  allCatalog?: boolean
}

export interface StockAdjustmentInput {
  scope: StockAdjustmentScope
  operation: StockAdjustmentOperation
  value: number
  reason: ManualStockReason
}

function computeAdjustedStock(current: number, operation: StockAdjustmentOperation, value: number): number {
  switch (operation) {
    case 'set_to': return value
    case 'increase_by': return current + value
    case 'decrease_by': return current - value
  }
}

async function loadScopedProductsStock(scope: StockAdjustmentScope): Promise<CurrentProductStockRow[]> {
  if (scope.allCatalog) return [...(await loadCurrentProductsStock()).values()]

  const conditions: string[] = []
  const params: unknown[] = []
  if (scope.productIds && scope.productIds.length) { params.push(scope.productIds); conditions.push(`p.id = ANY($${params.length}::text[])`) }
  if (scope.categoryId) { params.push(scope.categoryId); conditions.push(`p.category_id = $${params.length}`) }
  if (scope.brand) { params.push(scope.brand); conditions.push(`p.brand = $${params.length}`) }
  if (conditions.length === 0) return []

  const { rows } = await pool.query<CurrentProductStockRow>(
    `SELECT p.id, p.name, p.sku, p.barcode, p.stock, c.name as "categoryName"
     FROM products p JOIN categories c ON c.id = p.category_id WHERE ${conditions.join(' AND ')}`,
    params
  )
  return rows
}

export async function previewStockAdjustment(input: StockAdjustmentInput): Promise<{ rows: StockPreviewRow[], summary: StockPreviewSummary }> {
  const products = await loadScopedProductsStock(input.scope)
  const rows: StockPreviewRow[] = products.map((p, i) => {
    const newStock = Math.round(computeAdjustedStock(p.stock, input.operation, input.value))
    const errors: string[] = []
    if (!Number.isFinite(newStock) || newStock < 0) errors.push('الكمية الناتجة غير صالحة (أقل من صفر)')
    const quantityChanged = errors.length === 0 && newStock !== p.stock
    const warnings = errors.length === 0 && quantityChanged ? computeStockWarnings(p.stock, newStock) : []
    const status: StockRowStatus = errors.length ? 'error' : !quantityChanged ? 'no_change' : warnings.length ? 'warning' : 'ready'

    return {
      rowNumber: i + 1,
      kind: 'product', productId: p.id, variantId: null, sku: p.sku, barcode: p.barcode,
      productName: p.name, variantName: null,
      currentStock: p.stock, newStock: errors.length ? p.stock : newStock,
      quantityChange: quantityChanged ? newStock - p.stock : 0,
      reason: quantityChanged ? input.reason : null,
      status, errors, warnings
    }
  })
  return { rows, summary: summarizeStockRows(rows) }
}

export async function confirmStockAdjustment(input: StockAdjustmentInput, selectedProductIds: string[], adminUserId: string): Promise<ApplyResult> {
  const { rows } = await previewStockAdjustment(input)
  const selectedSet = new Set(selectedProductIds)
  const toApply = rows.filter(r => selectedSet.has(r.productId) && (r.status === 'ready' || r.status === 'warning'))

  const batchId = await createBatch('bulk_stock_adjustment', adminUserId)
  const resultRows: ApplyResultRow[] = []
  let updated = 0, failed = 0

  for (let start = 0; start < toApply.length; start += CHUNK_SIZE) {
    const chunk = toApply.slice(start, start + CHUNK_SIZE)
    await withTransaction(async client => {
      for (const row of chunk) {
        const base = { rowNumber: row.rowNumber, productId: row.productId, variantId: row.variantId, sku: row.sku, productName: row.productName }
        try {
          await applyOneStockRow(client, row, adminUserId, batchId)
          resultRows.push({ ...base, result: 'updated' })
          updated++
        } catch (err) {
          resultRows.push({ ...base, result: 'failed', reason: err instanceof Error ? err.message : 'unknown_error' })
          failed++
        }
      }
    })
  }

  const skipped = Math.max(0, selectedProductIds.length - toApply.length)
  await finalizeBatch(batchId, { totalRows: selectedProductIds.length, successfulRows: updated, failedRows: failed + skipped })
  return { batchId, totalRows: selectedProductIds.length, updated, skipped, failed, rows: resultRows }
}
