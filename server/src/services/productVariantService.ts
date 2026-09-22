import crypto from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool } from '../db.js'
import { getVariantSellableStock, consumeBatchesFefo, restoreBatchConsumptionsForMovement } from './inventoryBatchService.js'

export interface ProductVariant {
  id: string
  productId: string
  name: string
  sku: string | null
  barcode: string
  price: number
  oldPrice: number | null
  cost: number
  stock: number
  available: boolean
  sortOrder: number
  createdAt: string
}

interface VariantRow {
  id: string
  productId: string
  name: string
  sku: string | null
  barcode: string
  price: number
  oldPrice: number | null
  cost: number
  stock: number
  available: number
  sortOrder: number
  createdAt: string
}

const SELECT_VARIANT = `
  SELECT id, product_id as "productId", name, sku, barcode, price, old_price as "oldPrice", cost, stock, available, sort_order as "sortOrder", created_at as "createdAt"
  FROM product_variants
`

export async function listVariantsForProduct(productId: string): Promise<ProductVariant[]> {
  const { rows } = await pool.query<VariantRow>(
    `${SELECT_VARIANT} WHERE product_id = $1 ORDER BY sort_order ASC, created_at ASC`,
    [productId]
  )
  return rows.map(r => ({ ...r, available: !!r.available }))
}

export async function getVariant(id: string): Promise<ProductVariant | null> {
  const { rows } = await pool.query<VariantRow>(`${SELECT_VARIANT} WHERE id = $1`, [id])
  const row = rows[0]
  return row ? { ...row, available: !!row.available } : null
}

// حل دفعة من معرفات المتغيرات لحالتها الحالية — بتُستخدم من سلة العميل لإعادة التحقق من
// سعر/توفر/مخزون متغير مُختار قبل الدفع، بنفس مبدأ resolveProducts (أي id مش موجود بيتجاهل
// بصمت، مش خطأ — العنصر ده بيتشال من السلة تلقائياً في الواجهة).
export async function resolveVariants(ids: string[]): Promise<ProductVariant[]> {
  if (ids.length === 0) return []
  const { rows } = await pool.query<VariantRow>(`${SELECT_VARIANT} WHERE id = ANY($1::text[])`, [ids])
  return rows.map(r => ({ ...r, available: !!r.available }))
}

export interface VariantInput {
  name: string
  sku: string | null
  barcode: string
  price: number
  oldPrice: number | null
  cost: number
  stock: number
  available: boolean
  sortOrder: number
}

export async function createVariant(productId: string, input: VariantInput): Promise<ProductVariant> {
  const id = `var-${crypto.randomUUID()}`
  await pool.query(
    `INSERT INTO product_variants (id, product_id, name, sku, barcode, price, old_price, cost, stock, available, sort_order, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())`,
    [id, productId, input.name, input.sku, input.barcode, input.price, input.oldPrice, input.cost, input.stock, input.available ? 1 : 0, input.sortOrder]
  )
  return (await getVariant(id))!
}

// updatedByUserId اختياري عمداً (undefined لو الاستدعاء من مسار قديم/اختبار قبل ما نضيف
// تتبّع السعر/التكلفة) — لو موجود ومفيش تغيير فعلي في السعر أو التكلفة، مفيش أي صف تاريخ
// إضافي بيتكتب، بنفس مبدأ productService.updateProduct بالظبط.
export async function updateVariant(id: string, input: VariantInput, updatedByUserId?: string): Promise<ProductVariant | null> {
  const existing = await getVariant(id)
  if (!existing) return null

  const { rowCount } = await pool.query(
    `UPDATE product_variants SET name=$2, sku=$3, barcode=$4, price=$5, old_price=$6, cost=$7, stock=$8, available=$9, sort_order=$10
     WHERE id=$1`,
    [id, input.name, input.sku, input.barcode, input.price, input.oldPrice, input.cost, input.stock, input.available ? 1 : 0, input.sortOrder]
  )
  if (!rowCount) return null

  if (updatedByUserId) {
    if (input.cost !== existing.cost) {
      await pool.query(
        `INSERT INTO product_cost_history (id, product_id, variant_id, unit_cost, old_cost, source_type, source_id)
         VALUES ($1, $2, $3, $4, $5, 'manual_adjustment', $6)`,
        [crypto.randomUUID(), existing.productId, id, input.cost, existing.cost, updatedByUserId]
      )
    }
    if (input.price !== existing.price || input.oldPrice !== existing.oldPrice) {
      await pool.query(
        `INSERT INTO product_price_history (product_id, variant_id, old_price, new_price, old_old_price, new_old_price, source, admin_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'manual_edit', $7)`,
        [existing.productId, id, existing.price, input.price, existing.oldPrice ?? null, input.oldPrice, updatedByUserId]
      )
    }
  }

  return getVariant(id)
}

export type DeleteVariantResult = { ok: true } | { ok: false, error: 'variant_not_found' | 'variant_has_orders' }

// حذف متغير مسموح بس لو مفيش أي طلب حقيقي اشتراه قبل كده — order_items.variant_id بيشاور
// عليه بمفتاح أجنبي بدون ON DELETE، فمحاولة حذف متغير له تاريخ طلبات بترجع خطأ قاعدة بيانات
// فعلي (23503) بدل ما تسمح بحذف صامت يكسر لقطة الطلب القديمة.
export async function deleteVariant(id: string): Promise<DeleteVariantResult> {
  try {
    const { rowCount } = await pool.query('DELETE FROM product_variants WHERE id = $1', [id])
    if (!rowCount) return { ok: false, error: 'variant_not_found' }
    return { ok: true }
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === '23503') return { ok: false, error: 'variant_has_orders' }
    throw err
  }
}

export interface LockedVariant {
  id: string
  productId: string
  name: string
  price: number
  available: boolean
  stock: number
}

export async function lockVariantForOrder(client: PoolClient, variantId: string): Promise<LockedVariant | null> {
  const { rows } = await client.query<{ id: string, productId: string, name: string, price: number, available: number, stock: number }>(
    `SELECT id, product_id as "productId", name, price, available, stock FROM product_variants WHERE id = $1 FOR UPDATE`,
    [variantId]
  )
  const row = rows[0]
  if (!row) return null

  // نفس مبدأ lockProductsForOrder بالظبط: لو المتغير ده استُلم قبل كده عن طريق نظام
  // المشتريات وليه دفعات، الرصيد المستخدم في التحقق من التوفر بيبقى الرصيد "القابل للبيع"
  // (بيستثني أي دفعة منتهية الصلاحية) مش product_variants.stock الخام.
  const sellable = await getVariantSellableStock(client, variantId)
  const stock = sellable === null ? row.stock : sellable

  return { id: row.id, productId: row.productId, name: row.name, price: row.price, available: !!row.available, stock }
}

// خصم ذرّي لمخزون متغير — نفس مبدأ deductStockForOrder بالظبط (الشرط stock >= quantity
// جوه نفس جملة الـ UPDATE)، بس على product_variants بدل products. الحركة المسجّلة في
// stock_movements بتربط بالمنتج الأب (لتقارير المستوى الأعلى) وبالمتغير نفسه (variant_id)،
// واستهلاك الدفعات (لو المتغير ده ليه دفعات) بيتم بترتيب FEFO زي المنتج الأساسي بالظبط.
export async function deductVariantStock(client: PoolClient, variant: LockedVariant, quantity: number, orderId: string): Promise<void> {
  const { rows } = await client.query<{ stock: number }>(
    'UPDATE product_variants SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING stock',
    [quantity, variant.id]
  )
  if (!rows[0]) throw new Error('insufficient_variant_stock')

  const { rows: movementRows } = await client.query<{ id: number }>(
    `INSERT INTO stock_movements (product_id, variant_id, type, quantity_change, note, created_at, order_id, quantity_before, quantity_after)
     VALUES ($1, $2, 'sale', $3, $4, $5, $6, $7, $8) RETURNING id`,
    [variant.productId, variant.id, -quantity, `بيع متغير — طلب ${orderId}`, new Date().toISOString(), orderId, rows[0].stock + quantity, rows[0].stock]
  )
  await consumeBatchesFefo(client, variant.productId, quantity, movementRows[0].id, variant.id)
}

// استرجاع رصيد متغير — بيزوّد الرصيد + حركة موثّقة، وبيرجّع بالظبط لنفس الدفعات اللي
// اتاخدت منها وقت البيع الأصلي (لو المتغير ده ليه دفعات أصلاً) عن طريق البحث عن حركة
// 'sale' الأصلية بنفس الطلب والمتغير، بنفس مبدأ restoreProductStock في inventoryService.
export async function restoreVariantStock(client: PoolClient, variantId: string, quantity: number, orderId: string, movementType: 'cancel_restore' | 'substitution_restore' = 'cancel_restore'): Promise<void> {
  const { rows } = await client.query<{ stock: number, productId: string }>(
    'UPDATE product_variants SET stock = stock + $1 WHERE id = $2 RETURNING stock, product_id as "productId"',
    [quantity, variantId]
  )
  const row = rows[0]
  if (!row) return

  await client.query(
    `INSERT INTO stock_movements (product_id, variant_id, type, quantity_change, note, created_at, order_id, quantity_before, quantity_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [row.productId, variantId, movementType, quantity, `إلغاء طلب ${orderId}`, new Date().toISOString(), orderId, row.stock - quantity, row.stock]
  )

  const { rows: saleMovementRows } = await client.query<{ id: number }>(
    `SELECT id FROM stock_movements WHERE order_id = $1 AND variant_id = $2 AND type = 'sale' ORDER BY id LIMIT 1`,
    [orderId, variantId]
  )
  if (saleMovementRows[0]) await restoreBatchConsumptionsForMovement(client, saleMovementRows[0].id)
}
