import crypto from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool, withTransaction } from '../db.js'
import { toCsv, csvRecords, parseCsv } from '../csv.js'
import { createBatch, finalizeBatch, type BulkOperationType } from './bulkOperationBatchService.js'

// إصدار القالب — أي تغيير مستقبلي في شكل الأعمدة (إضافة/حذف/إعادة ترتيب معنى عمود) لازم
// يرفع الرقم ده، عشان ملف قديم اتنزّل قبل التغيير يترفض بوضوح بدل ما يتفسّر غلط بصمت.
export const PRICING_TEMPLATE_VERSION = '2'

export const PRICING_CSV_HEADERS = [
  'template_version', 'product_id', 'variant_id', 'sku', 'barcode', 'product_name', 'variant_name',
  'category', 'current_price', 'new_price', 'current_old_price', 'new_old_price', 'current_cost', 'new_cost'
] as const

const EASTERN_DIGITS = /[٠-٩]/

// حماية من حقن الصيغ في Excel/Sheets — أي خلية بتبدأ بـ = أو + أو - أو @ ممكن تتفسّر كصيغة
// حسابية أو أمر تنفيذي لو اتفتحت في برنامج جداول بيانات. بادئة علامة اقتباس واحدة (') بتخلي
// البرنامج يتعامل معاها كنص خام، من غير ما تتغيّر القيمة المعروضة فعلياً للمستخدم.
export function sanitizeCsvCell(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value
}

// تحقق صارم من قيمة سعر/تكلفة مُدخلة — أرقام غربية بس، فاصلة عشرية واحدة بحد أقصى خانتين
// عشريتين، من غير سالب، من غير أي نص إضافي (زي "EGP 20" أو "--"). أي قيمة مرفوضة بترجع null
// بدل ما تتفسّر بأي شكل تقريبي.
export function parseStrictPrice(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (EASTERN_DIGITS.test(trimmed)) return null
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

export type OldPriceAction = 'keep' | 'clear' | 'set'

export interface ParsedOldPrice {
  action: OldPriceAction
  value: number | null
  error: string | null
}

// "new_old_price" فاضي = خليه زي ما هو (keep). "CLEAR" (بأي حالة أحرف) = امسحه فعلياً
// (يبقى NULL). أي قيمة تانية لازم تتقرأ كسعر صحيح زي أي سعر عادي.
export function parseOldPriceCell(raw: string | undefined): ParsedOldPrice {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return { action: 'keep', value: null, error: null }
  if (trimmed.toUpperCase() === 'CLEAR') return { action: 'clear', value: null, error: null }
  const v = parseStrictPrice(trimmed)
  if (v === null) return { action: 'keep', value: null, error: 'قيمة السعر قبل الخصم غير صحيحة' }
  return { action: 'set', value: v, error: null }
}

export type PricingRowKind = 'product' | 'variant'
export type PricingRowStatus = 'ready' | 'no_change' | 'warning' | 'error'

export interface PricingPreviewRow {
  rowNumber: number
  kind: PricingRowKind
  productId: string
  variantId: string | null
  sku: string | null
  barcode: string
  productName: string
  variantName: string | null
  currentPrice: number
  newPrice: number
  priceChanged: boolean
  currentOldPriceAction: 'unchanged'
  currentOldPrice: number | null
  newOldPriceAction: OldPriceAction
  newOldPrice: number | null
  currentCost: number
  newCost: number
  costChanged: boolean
  difference: number
  percentChange: number | null
  status: PricingRowStatus
  errors: string[]
  warnings: string[]
}

interface CurrentProductRow {
  id: string
  name: string
  sku: string | null
  barcode: string
  price: number
  oldPrice: number | null
  cost: number
  categoryName: string
}

interface CurrentVariantRow {
  id: string
  productId: string
  name: string
  sku: string | null
  barcode: string
  price: number
  oldPrice: number | null
  cost: number
}

async function loadCurrentProducts(): Promise<Map<string, CurrentProductRow>> {
  const { rows } = await pool.query<CurrentProductRow>(
    `SELECT p.id, p.name, p.sku, p.barcode, p.price, p.old_price as "oldPrice", p.cost, c.name as "categoryName"
     FROM products p JOIN categories c ON c.id = p.category_id`
  )
  return new Map(rows.map(r => [r.id, r]))
}

async function loadCurrentVariants(): Promise<Map<string, CurrentVariantRow>> {
  const { rows } = await pool.query<CurrentVariantRow>(
    `SELECT id, product_id as "productId", name, sku, barcode, price, old_price as "oldPrice", cost FROM product_variants`
  )
  return new Map(rows.map(r => [r.id, r]))
}

export interface PricingTemplateFilters {
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
  oldPrice: number | null
  cost: number
  categoryName: string
  hasVariants: boolean
}

interface TemplateVariantRow {
  id: string
  productId: string
  name: string
  sku: string | null
  barcode: string
  price: number
  oldPrice: number | null
  cost: number
}

// القالب بيتولّد من قاعدة البيانات مباشرة، مش ملف فاضي عام — كل الفلاتر اختيارية ومطبّقة
// على مستوى المنتج (متغيرات منتج مطابق للفلتر بتتضمّن كلها تلقائياً).
export async function generatePricingTemplateCsv(filters: PricingTemplateFilters = {}): Promise<string> {
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
    `SELECT p.id, p.name, p.sku, p.barcode, p.price, p.old_price as "oldPrice", p.cost, c.name as "categoryName",
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
        `SELECT id, product_id as "productId", name, sku, barcode, price, old_price as "oldPrice", cost
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
        PRICING_TEMPLATE_VERSION, p.id, '', sanitizeCsvCell(p.sku ?? ''), sanitizeCsvCell(p.barcode),
        sanitizeCsvCell(p.name), '', sanitizeCsvCell(p.categoryName), p.price, '', p.oldPrice ?? '', '', p.cost, ''
      ])
    } else {
      for (const v of productVariants) {
        csvRows.push([
          PRICING_TEMPLATE_VERSION, p.id, v.id, sanitizeCsvCell(v.sku ?? ''), sanitizeCsvCell(v.barcode),
          sanitizeCsvCell(p.name), sanitizeCsvCell(v.name), sanitizeCsvCell(p.categoryName), v.price, '', v.oldPrice ?? '', '', v.cost, ''
        ])
      }
    }
  }

  return '﻿' + toCsv([...PRICING_CSV_HEADERS], csvRows)
}

export function todayFilenameSuffix(): string {
  return new Date().toISOString().slice(0, 10)
}

const WARNING_MAJOR_DECREASE = 'تحذير: انخفاض كبير في السعر'
const WARNING_MAJOR_INCREASE = 'تحذير: ارتفاع كبير في السعر'
const WARNING_BELOW_COST = 'تحذير: سعر البيع أقل من التكلفة'
const WARNING_OLD_PRICE_NOT_HIGHER = 'تحذير: السعر القديم لا يزيد عن السعر الحالي'

function computeWarnings(currentPrice: number, newPrice: number, newCost: number, resolvedOldPrice: number | null): string[] {
  const warnings: string[] = []
  if (currentPrice > 0) {
    if (newPrice <= currentPrice * 0.5) warnings.push(WARNING_MAJOR_DECREASE)
    if (newPrice >= currentPrice * 2) warnings.push(WARNING_MAJOR_INCREASE)
  }
  if (newCost > newPrice) warnings.push(WARNING_BELOW_COST)
  if (resolvedOldPrice !== null && resolvedOldPrice <= newPrice) warnings.push(WARNING_OLD_PRICE_NOT_HIGHER)
  return warnings
}

export interface PricingChangeRequest {
  kind: PricingRowKind
  productId: string
  variantId: string | null
  newPrice: number
  newOldPriceAction: OldPriceAction
  newOldPrice: number | null
  newCost: number
}

// المرحلة المشتركة بين معاينة CSV ومعاينة التعديل السريع — كل صف بيتقيّم مستقل عن الباقي
// غير التكرار داخل نفس الملف (نفس المنتج/المتغير مرتين). "current_price/current_cost" في
// أي CSV مرفوع أبداً ما بيتقروش من هنا — القيم الحالية بتُقرأ فقط من الخرائط اللي جايه من
// قاعدة البيانات فعلياً (loadCurrentProducts/loadCurrentVariants)، حتى لو الملف فيه قيم
// مختلفة تماماً في هذين العمودين (بيتجاهلوا تماماً، مجرد أعمدة معلوماتية للمستخدم بس).
export function validatePricingRecord(
  rowNumber: number,
  record: Record<string, string | undefined>,
  currentProducts: Map<string, CurrentProductRow>,
  currentVariants: Map<string, CurrentVariantRow>,
  seenKeys: Set<string>
): PricingPreviewRow {
  const errors: string[] = []
  const warnings: string[] = []

  const productId = record.product_id?.trim() ?? ''
  const variantId = record.variant_id?.trim() || null
  const kind: PricingRowKind = variantId ? 'variant' : 'product'

  if (record.template_version?.trim() !== PRICING_TEMPLATE_VERSION) {
    errors.push('إصدار الملف غير مدعوم. يرجى تحميل قالب جديد.')
  }

  if (!productId) errors.push('product_id مطلوب')

  let current: CurrentProductRow | CurrentVariantRow | null = null
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

  const newPriceRaw = record.new_price?.trim() ?? ''
  let newPrice = current?.price ?? 0
  let priceChanged = false
  if (newPriceRaw) {
    const parsed = parseStrictPrice(newPriceRaw)
    if (parsed === null) errors.push('new_price: قيمة غير صحيحة')
    else if (parsed <= 0) errors.push('new_price: يجب أن يكون أكبر من صفر')
    else { newPrice = parsed; priceChanged = current !== null && parsed !== current.price }
  }

  const oldPriceParsed = parseOldPriceCell(record.new_old_price)
  if (oldPriceParsed.error) errors.push(oldPriceParsed.error)
  if (oldPriceParsed.action === 'set' && oldPriceParsed.value !== null && oldPriceParsed.value <= 0) {
    errors.push('new_old_price: يجب أن يكون أكبر من صفر (استخدم CLEAR للمسح)')
  }

  const newCostRaw = record.new_cost?.trim() ?? ''
  let newCost = current?.cost ?? 0
  let costChanged = false
  if (newCostRaw) {
    const parsed = parseStrictPrice(newCostRaw)
    if (parsed === null) errors.push('new_cost: قيمة غير صحيحة')
    else { newCost = parsed; costChanged = current !== null && parsed !== current.cost }
  }

  const resolvedOldPrice = oldPriceParsed.action === 'clear' ? null : oldPriceParsed.action === 'set' ? oldPriceParsed.value : (current?.oldPrice ?? null)
  const oldPriceChanged = current !== null && oldPriceParsed.action !== 'keep' && resolvedOldPrice !== (current.oldPrice ?? null)

  if (errors.length === 0 && current) {
    warnings.push(...computeWarnings(current.price, newPrice, newCost, resolvedOldPrice))
  }

  const anyChange = priceChanged || costChanged || oldPriceChanged
  const status: PricingRowStatus = errors.length > 0 ? 'error' : !anyChange ? 'no_change' : warnings.length > 0 ? 'warning' : 'ready'

  return {
    rowNumber,
    kind,
    productId: current ? (kind === 'variant' ? (current as CurrentVariantRow).productId : current.id) : productId,
    variantId,
    sku: current?.sku ?? null,
    barcode: current?.barcode ?? '',
    productName,
    variantName,
    currentPrice: current?.price ?? 0,
    newPrice,
    priceChanged,
    currentOldPriceAction: 'unchanged',
    currentOldPrice: current?.oldPrice ?? null,
    newOldPriceAction: oldPriceParsed.action,
    newOldPrice: resolvedOldPrice,
    currentCost: current?.cost ?? 0,
    newCost,
    costChanged,
    difference: current ? newPrice - current.price : 0,
    percentChange: current && current.price > 0 ? ((newPrice - current.price) / current.price) * 100 : null,
    status,
    errors,
    warnings
  }
}

export async function previewPricingCsv(csvText: string): Promise<{ rows: PricingPreviewRow[], summary: PricingPreviewSummary }> {
  const { headers, rows: rawRows } = parseCsv(csvText)
  const records = csvRecords({ headers, rows: rawRows })
  const currentProducts = await loadCurrentProducts()
  const currentVariants = await loadCurrentVariants()
  const seenKeys = new Set<string>()

  const rows = records.map((r, i) => validatePricingRecord(i + 2, r, currentProducts, currentVariants, seenKeys))
  return { rows, summary: summarizePricingRows(rows) }
}

export interface PricingPreviewSummary {
  totalRows: number
  ready: number
  noChange: number
  warnings: number
  errors: number
  priceIncreases: number
  priceDecreases: number
  costChanges: number
  averagePricePercentChange: number | null
}

export function summarizePricingRows(rows: PricingPreviewRow[]): PricingPreviewSummary {
  const changed = rows.filter(r => r.status === 'ready' || r.status === 'warning')
  const percentChanges = changed.map(r => r.percentChange).filter((p): p is number => p !== null)
  return {
    totalRows: rows.length,
    ready: rows.filter(r => r.status === 'ready').length,
    noChange: rows.filter(r => r.status === 'no_change').length,
    warnings: rows.filter(r => r.status === 'warning').length,
    errors: rows.filter(r => r.status === 'error').length,
    priceIncreases: changed.filter(r => r.difference > 0).length,
    priceDecreases: changed.filter(r => r.difference < 0).length,
    costChanges: changed.filter(r => r.costChanged).length,
    averagePricePercentChange: percentChanges.length ? percentChanges.reduce((a, b) => a + b, 0) / percentChanges.length : null
  }
}

export interface ConfirmRowInput {
  rowNumber: number
  record: Record<string, string | undefined>
}

export interface ApplyResultRow {
  rowNumber: number
  productId: string
  variantId: string | null
  sku: string | null
  productName: string
  result: 'updated' | 'skipped' | 'failed'
  reason?: string
}

export interface ApplyResult {
  batchId: string
  totalRows: number
  updated: number
  skipped: number
  failed: number
  rows: ApplyResultRow[]
}

const CHUNK_SIZE = 200

// التأكيد بياخد صفوف CSV الخام (مش نتيجة المعاينة المحسوبة) وبيعيد كل التحقق والقراءة من
// قاعدة البيانات من الصفر — نفس دالة التحقق بالظبط المستخدمة في المعاينة، بس هنا القيم
// "الحالية" بتتقرأ لحظة التأكيد فعلياً (مش وقت المعاينة)، فلو حد غيّر المنتج بين اللحظتين
// الفحص بيتكرر بقيم محدّثة. أي صف مطلوب تحديده لكن طلع غلط أو "بدون تغيير" وقت التأكيد
// بيتسجّل كـ "متخطّى" (skipped)، مش يفشل العملية كلها.
export async function confirmPricingRows(
  selectedRows: ConfirmRowInput[],
  adminUserId: string,
  operationType: BulkOperationType = 'bulk_price_csv'
): Promise<ApplyResult> {
  const currentProducts = await loadCurrentProducts()
  const currentVariants = await loadCurrentVariants()
  const seenKeys = new Set<string>()

  const revalidated = selectedRows.map(({ rowNumber, record }) =>
    validatePricingRecord(rowNumber, record, currentProducts, currentVariants, seenKeys)
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
          await applyOneRow(client, row, adminUserId, batchId)
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

async function applyOneRow(client: PoolClient, row: PricingPreviewRow, adminUserId: string, batchId: string, source: 'bulk_csv' | 'bulk_adjustment' = 'bulk_csv'): Promise<void> {
  if (row.kind === 'variant' && row.variantId) {
    const { rows: current } = await client.query<{ price: number, oldPrice: number | null, cost: number }>(
      'SELECT price, old_price as "oldPrice", cost FROM product_variants WHERE id = $1 FOR UPDATE', [row.variantId]
    )
    const cur = current[0]
    if (!cur) throw new Error('variant_not_found')

    await client.query('UPDATE product_variants SET price = $1, old_price = $2, cost = $3 WHERE id = $4', [row.newPrice, row.newOldPrice, row.newCost, row.variantId])

    if (row.priceChanged || row.newOldPrice !== (cur.oldPrice ?? null)) {
      await client.query(
        `INSERT INTO product_price_history (product_id, variant_id, old_price, new_price, old_old_price, new_old_price, source, admin_user_id, bulk_batch_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [row.productId, row.variantId, cur.price, row.newPrice, cur.oldPrice, row.newOldPrice, source, adminUserId, batchId]
      )
    }
    if (row.costChanged) {
      await insertCostHistory(client, row.productId, row.variantId, row.newCost, cur.cost, adminUserId, batchId)
    }
  } else {
    const { rows: current } = await client.query<{ price: number, oldPrice: number | null, cost: number }>(
      'SELECT price, old_price as "oldPrice", cost FROM products WHERE id = $1 FOR UPDATE', [row.productId]
    )
    const cur = current[0]
    if (!cur) throw new Error('product_not_found')

    await client.query('UPDATE products SET price = $1, old_price = $2, cost = $3 WHERE id = $4', [row.newPrice, row.newOldPrice, row.newCost, row.productId])

    if (row.priceChanged || row.newOldPrice !== (cur.oldPrice ?? null)) {
      await client.query(
        `INSERT INTO product_price_history (product_id, variant_id, old_price, new_price, old_old_price, new_old_price, source, admin_user_id, bulk_batch_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [row.productId, null, cur.price, row.newPrice, cur.oldPrice, row.newOldPrice, source, adminUserId, batchId]
      )
    }
    if (row.costChanged) {
      await insertCostHistory(client, row.productId, null, row.newCost, cur.cost, adminUserId, batchId)
    }
  }
}

async function insertCostHistory(client: PoolClient, productId: string, variantId: string | null, newCost: number, oldCost: number, adminUserId: string, batchId: string): Promise<void> {
  await client.query(
    `INSERT INTO product_cost_history (id, product_id, variant_id, unit_cost, old_cost, source_type, source_id, bulk_batch_id)
     VALUES ($1, $2, $3, $4, $5, 'bulk_price_update', $6, $7)`,
    [crypto.randomUUID(), productId, variantId, newCost, oldCost, adminUserId, batchId]
  )
}

// ============ التعديل السريع (زيادة/خفض نسبة أو مبلغ ثابت على نطاق) ============
// نطاق المنتجات بس في هذا الإصدار (بدون متغيرات) — نفس حدود الـ MVP المتّبعة في كل مكان
// تاني بالمشروع لمتغيرات المنتج، موثّقة صراحة هنا كقرار نطاق مقصود.

export type AdjustmentOperation = 'increase_percent' | 'decrease_percent' | 'increase_fixed' | 'decrease_fixed'
export type AdjustmentRounding = 'none' | 'nearest_0_5' | 'nearest_1' | 'nearest_5'

export interface AdjustmentScope {
  productIds?: string[]
  categoryId?: string
  brand?: string
  allCatalog?: boolean
}

export interface AdjustmentInput {
  scope: AdjustmentScope
  operation: AdjustmentOperation
  value: number
  rounding: AdjustmentRounding
}

function applyRounding(price: number, rounding: AdjustmentRounding): number {
  switch (rounding) {
    case 'nearest_0_5': return Math.round(price / 0.5) * 0.5
    case 'nearest_1': return Math.round(price)
    case 'nearest_5': return Math.round(price / 5) * 5
    default: return price
  }
}

function computeAdjustedPrice(current: number, operation: AdjustmentOperation, value: number): number {
  switch (operation) {
    case 'increase_percent': return current * (1 + value / 100)
    case 'decrease_percent': return current * (1 - value / 100)
    case 'increase_fixed': return current + value
    case 'decrease_fixed': return current - value
  }
}

async function loadScopedProducts(scope: AdjustmentScope): Promise<CurrentProductRow[]> {
  if (scope.allCatalog) return [...(await loadCurrentProducts()).values()]

  const conditions: string[] = []
  const params: unknown[] = []
  if (scope.productIds && scope.productIds.length) { params.push(scope.productIds); conditions.push(`p.id = ANY($${params.length}::text[])`) }
  if (scope.categoryId) { params.push(scope.categoryId); conditions.push(`p.category_id = $${params.length}`) }
  if (scope.brand) { params.push(scope.brand); conditions.push(`p.brand = $${params.length}`) }
  if (conditions.length === 0) return []

  const { rows } = await pool.query<CurrentProductRow>(
    `SELECT p.id, p.name, p.sku, p.barcode, p.price, p.old_price as "oldPrice", p.cost, c.name as "categoryName"
     FROM products p JOIN categories c ON c.id = p.category_id WHERE ${conditions.join(' AND ')}`,
    params
  )
  return rows
}

// المعاينة والتأكيد بيعيدوا حساب النتيجة من الصفر كل مرة من قيم السعر الحالية الفعلية في
// قاعدة البيانات — الفرونت إند أبداً مش بيبعت أي سعر محسوب مسبقاً يتم الوثوق بيه وقت التأكيد.
export async function previewAdjustment(input: AdjustmentInput): Promise<{ rows: PricingPreviewRow[], summary: PricingPreviewSummary }> {
  const products = await loadScopedProducts(input.scope)
  const rows: PricingPreviewRow[] = products.map((p, i) => {
    const raw = computeAdjustedPrice(p.price, input.operation, input.value)
    const rounded = applyRounding(raw, input.rounding)
    const newPrice = Math.round(rounded * 100) / 100
    const errors: string[] = []
    if (!Number.isFinite(newPrice) || newPrice <= 0) errors.push('السعر الناتج غير صالح (أقل من أو يساوي صفر)')
    const priceChanged = errors.length === 0 && newPrice !== p.price
    const warnings = errors.length === 0 ? computeWarnings(p.price, newPrice, p.cost, p.oldPrice) : []
    const status: PricingRowStatus = errors.length ? 'error' : !priceChanged ? 'no_change' : warnings.length ? 'warning' : 'ready'

    return {
      rowNumber: i + 1,
      kind: 'product', productId: p.id, variantId: null, sku: p.sku, barcode: p.barcode,
      productName: p.name, variantName: null,
      currentPrice: p.price, newPrice: errors.length ? p.price : newPrice, priceChanged,
      currentOldPriceAction: 'unchanged', currentOldPrice: p.oldPrice, newOldPriceAction: 'keep', newOldPrice: p.oldPrice,
      currentCost: p.cost, newCost: p.cost, costChanged: false,
      difference: priceChanged ? newPrice - p.price : 0,
      percentChange: p.price > 0 ? ((newPrice - p.price) / p.price) * 100 : null,
      status, errors, warnings
    }
  })
  return { rows, summary: summarizePricingRows(rows) }
}

export async function confirmAdjustment(input: AdjustmentInput, selectedProductIds: string[], adminUserId: string): Promise<ApplyResult> {
  const { rows } = await previewAdjustment(input)
  const selectedSet = new Set(selectedProductIds)
  const toApply = rows.filter(r => selectedSet.has(r.productId) && (r.status === 'ready' || r.status === 'warning'))

  const batchId = await createBatch('bulk_price_adjustment', adminUserId)
  const resultRows: ApplyResultRow[] = []
  let updated = 0, failed = 0

  for (let start = 0; start < toApply.length; start += CHUNK_SIZE) {
    const chunk = toApply.slice(start, start + CHUNK_SIZE)
    await withTransaction(async client => {
      for (const row of chunk) {
        const base = { rowNumber: row.rowNumber, productId: row.productId, variantId: row.variantId, sku: row.sku, productName: row.productName }
        try {
          await applyOneRow(client, row, adminUserId, batchId, 'bulk_adjustment')
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
