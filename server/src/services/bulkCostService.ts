import type { PoolClient } from 'pg'
import { pool, withTransaction } from '../db.js'
import { toCsv, csvRecords, parseCsv } from '../csv.js'
import { createBatch, finalizeBatch, type BulkOperationType } from './bulkOperationBatchService.js'
import {
  sanitizeCsvCell, parseStrictPrice, getMinMarginPercent, insertCostHistory,
  type ApplyResult, type ApplyResultRow
} from './bulkPricingService.js'

// أداة مستقلة لتحديث التكلفة بالجملة فقط (بدون لمس السعر) — منفصلة عن bulkPricingService
// عشان صلاحية products.cost.bulk_update مختلفة عن products.pricing.bulk_update (فصل أدوار:
// موظف مشتريات ممكن يحدّث التكلفة بعد تغيير سعر المورد من غير ما يقدر يلمس السعر للعميل).
export const COST_TEMPLATE_VERSION = '1'

export const COST_CSV_HEADERS = [
  'template_version', 'product_id', 'variant_id', 'sku', 'barcode', 'product_name', 'variant_name',
  'category', 'current_cost', 'new_cost'
] as const

export type CostRowKind = 'product' | 'variant'
export type CostRowStatus = 'ready' | 'no_change' | 'warning' | 'error'

export interface CostPreviewRow {
  rowNumber: number
  kind: CostRowKind
  productId: string
  variantId: string | null
  sku: string | null
  barcode: string
  productName: string
  variantName: string | null
  currentPrice: number
  currentCost: number
  newCost: number
  costChanged: boolean
  status: CostRowStatus
  errors: string[]
  warnings: string[]
}

interface CurrentProductCostRow {
  id: string
  name: string
  sku: string | null
  barcode: string
  price: number
  cost: number
  categoryName: string
}

interface CurrentVariantCostRow {
  id: string
  productId: string
  name: string
  sku: string | null
  barcode: string
  price: number
  cost: number
}

async function loadCurrentProductsCost(): Promise<Map<string, CurrentProductCostRow>> {
  const { rows } = await pool.query<CurrentProductCostRow>(
    `SELECT p.id, p.name, p.sku, p.barcode, p.price, p.cost, c.name as "categoryName"
     FROM products p JOIN categories c ON c.id = p.category_id`
  )
  return new Map(rows.map(r => [r.id, r]))
}

async function loadCurrentVariantsCost(): Promise<Map<string, CurrentVariantCostRow>> {
  const { rows } = await pool.query<CurrentVariantCostRow>(
    `SELECT id, product_id as "productId", name, sku, barcode, price, cost FROM product_variants`
  )
  return new Map(rows.map(r => [r.id, r]))
}

export interface CostTemplateFilters {
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
  price: number
  cost: number
  categoryName: string
}

interface TemplateVariantRow {
  id: string
  productId: string
  name: string
  sku: string | null
  barcode: string
  price: number
  cost: number
}

export async function generateCostTemplateCsv(filters: CostTemplateFilters = {}): Promise<string> {
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
    `SELECT p.id, p.name, p.sku, p.barcode, p.price, p.cost, c.name as "categoryName",
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
        `SELECT id, product_id as "productId", name, sku, barcode, price, cost
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
        COST_TEMPLATE_VERSION, p.id, '', sanitizeCsvCell(p.sku ?? ''), sanitizeCsvCell(p.barcode),
        sanitizeCsvCell(p.name), '', sanitizeCsvCell(p.categoryName), p.cost, ''
      ])
    } else {
      for (const v of productVariants) {
        csvRows.push([
          COST_TEMPLATE_VERSION, p.id, v.id, sanitizeCsvCell(v.sku ?? ''), sanitizeCsvCell(v.barcode),
          sanitizeCsvCell(p.name), sanitizeCsvCell(v.name), sanitizeCsvCell(p.categoryName), v.cost, ''
        ])
      }
    }
  }

  return '﻿' + toCsv([...COST_CSV_HEADERS], csvRows)
}

export function todayFilenameSuffix(): string {
  return new Date().toISOString().slice(0, 10)
}

const WARNING_ABOVE_PRICE = 'تحذير: التكلفة الجديدة أعلى من سعر البيع الحالي'
const WARNING_MARGIN_BELOW_THRESHOLD = 'تحذير: الهامش أقل من الحد الأدنى المسموح'

function computeCostWarnings(currentPrice: number, newCost: number, minMarginPercent: number): string[] {
  const warnings: string[] = []
  if (newCost > currentPrice) {
    warnings.push(WARNING_ABOVE_PRICE)
  } else if (currentPrice > 0) {
    const marginPercent = ((currentPrice - newCost) / currentPrice) * 100
    if (marginPercent < minMarginPercent) warnings.push(WARNING_MARGIN_BELOW_THRESHOLD)
  }
  return warnings
}

// current_cost في الملف المرفوع أبداً ما بيتقروش من هنا — بيتجاهل تماماً، نفس مبدأ
// bulkPricingService.validatePricingRecord. الهامش بيتحسب مقابل سعر البيع الحالي فقط
// (الأداة دي مالهاش دخل بالسعر، بتغيّر التكلفة بس).
export function validateCostRecord(
  rowNumber: number,
  record: Record<string, string | undefined>,
  currentProducts: Map<string, CurrentProductCostRow>,
  currentVariants: Map<string, CurrentVariantCostRow>,
  seenKeys: Set<string>,
  minMarginPercent: number
): CostPreviewRow {
  const errors: string[] = []
  const warnings: string[] = []

  const productId = record.product_id?.trim() ?? ''
  const variantId = record.variant_id?.trim() || null
  const kind: CostRowKind = variantId ? 'variant' : 'product'

  if (record.template_version?.trim() !== COST_TEMPLATE_VERSION) {
    errors.push('إصدار الملف غير مدعوم. يرجى تحميل قالب جديد.')
  }
  if (!productId) errors.push('product_id مطلوب')

  let current: CurrentProductCostRow | CurrentVariantCostRow | null = null
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

  const newCostRaw = record.new_cost?.trim() ?? ''
  let newCost = current?.cost ?? 0
  let costChanged = false
  if (newCostRaw) {
    const parsed = parseStrictPrice(newCostRaw)
    if (parsed === null) errors.push('new_cost: قيمة غير صحيحة')
    else { newCost = parsed; costChanged = current !== null && parsed !== current.cost }
  }

  if (errors.length === 0 && current && costChanged) {
    warnings.push(...computeCostWarnings(current.price, newCost, minMarginPercent))
  }

  const status: CostRowStatus = errors.length > 0 ? 'error' : !costChanged ? 'no_change' : warnings.length > 0 ? 'warning' : 'ready'

  return {
    rowNumber,
    kind,
    productId: current ? (kind === 'variant' ? (current as CurrentVariantCostRow).productId : current.id) : productId,
    variantId,
    sku: current?.sku ?? null,
    barcode: current?.barcode ?? '',
    productName,
    variantName,
    currentPrice: current?.price ?? 0,
    currentCost: current?.cost ?? 0,
    newCost,
    costChanged,
    status,
    errors,
    warnings
  }
}

export interface CostPreviewSummary {
  totalRows: number
  ready: number
  noChange: number
  warnings: number
  errors: number
  increases: number
  decreases: number
}

export function summarizeCostRows(rows: CostPreviewRow[]): CostPreviewSummary {
  const changed = rows.filter(r => r.status === 'ready' || r.status === 'warning')
  return {
    totalRows: rows.length,
    ready: rows.filter(r => r.status === 'ready').length,
    noChange: rows.filter(r => r.status === 'no_change').length,
    warnings: rows.filter(r => r.status === 'warning').length,
    errors: rows.filter(r => r.status === 'error').length,
    increases: changed.filter(r => r.newCost > r.currentCost).length,
    decreases: changed.filter(r => r.newCost < r.currentCost).length
  }
}

export async function previewCostCsv(csvText: string): Promise<{ rows: CostPreviewRow[], summary: CostPreviewSummary }> {
  const { headers, rows: rawRows } = parseCsv(csvText)
  const records = csvRecords({ headers, rows: rawRows })
  const currentProducts = await loadCurrentProductsCost()
  const currentVariants = await loadCurrentVariantsCost()
  const seenKeys = new Set<string>()
  const minMarginPercent = await getMinMarginPercent()

  const rows = records.map((r, i) => validateCostRecord(i + 2, r, currentProducts, currentVariants, seenKeys, minMarginPercent))
  return { rows, summary: summarizeCostRows(rows) }
}

export interface CostConfirmRowInput {
  rowNumber: number
  record: Record<string, string | undefined>
}

const CHUNK_SIZE = 200

export async function confirmCostRows(selectedRows: CostConfirmRowInput[], adminUserId: string): Promise<ApplyResult> {
  const currentProducts = await loadCurrentProductsCost()
  const currentVariants = await loadCurrentVariantsCost()
  const seenKeys = new Set<string>()
  const minMarginPercent = await getMinMarginPercent()

  const revalidated = selectedRows.map(({ rowNumber, record }) =>
    validateCostRecord(rowNumber, record, currentProducts, currentVariants, seenKeys, minMarginPercent)
  )

  const batchId = await createBatch('bulk_cost_csv' as BulkOperationType, adminUserId)
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
          await applyOneCostRow(client, row, adminUserId, batchId)
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

async function applyOneCostRow(client: PoolClient, row: CostPreviewRow, adminUserId: string, batchId: string): Promise<void> {
  if (row.kind === 'variant' && row.variantId) {
    const { rows: current } = await client.query<{ cost: number }>('SELECT cost FROM product_variants WHERE id = $1 FOR UPDATE', [row.variantId])
    const cur = current[0]
    if (!cur) throw new Error('variant_not_found')
    if (cur.cost === row.newCost) return
    await client.query('UPDATE product_variants SET cost = $1 WHERE id = $2', [row.newCost, row.variantId])
    await insertCostHistory(client, row.productId, row.variantId, row.newCost, cur.cost, adminUserId, batchId)
  } else {
    const { rows: current } = await client.query<{ cost: number }>('SELECT cost FROM products WHERE id = $1 FOR UPDATE', [row.productId])
    const cur = current[0]
    if (!cur) throw new Error('product_not_found')
    if (cur.cost === row.newCost) return
    await client.query('UPDATE products SET cost = $1 WHERE id = $2', [row.newCost, row.productId])
    await insertCostHistory(client, row.productId, null, row.newCost, cur.cost, adminUserId, batchId)
  }
}
