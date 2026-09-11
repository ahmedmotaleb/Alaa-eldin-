import type { PoolClient } from 'pg'
import { getSellableStockMap, consumeBatchesFefo, restoreBatchConsumptionsForMovement } from './inventoryBatchService.js'

export interface LockedProduct {
  id: string
  name: string
  unit: string
  price: number
  available: boolean
  stock: number
}

export type InventoryErrorCode = 'product_not_found' | 'product_unavailable' | 'invalid_quantity' | 'insufficient_stock'

export interface InventoryErrorDetail {
  code: InventoryErrorCode
  productId: string
  available?: number
  requested?: number
}

export class InventoryValidationError extends Error {
  detail: InventoryErrorDetail
  constructor(detail: InventoryErrorDetail) {
    super(detail.code)
    this.detail = detail
  }
}

export const MAX_QUANTITY_PER_ITEM = 999

// يقفل كل صفوف المنتجات المطلوبة بترتيب ثابت (مرتبة بالـ id) — عشان لو أكتر من عملية دفع
// متزامنة بتحتوي على نفس المنتجات، الكل بيقفلها بنفس الترتيب فمفيش احتمال deadlock
// (عملية أ بتستنى ب اللي مستنية أ في نفس الوقت على قفل عكسي).
export async function lockProductsForOrder(client: PoolClient, productIds: string[]): Promise<Map<string, LockedProduct>> {
  const uniqueSortedIds = Array.from(new Set(productIds)).sort()
  if (uniqueSortedIds.length === 0) return new Map()

  const { rows } = await client.query<{
    id: string, name: string, unit: string, price: number, available: number, stock: number
  }>(
    `SELECT id, name, unit, price, available, stock FROM products WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`,
    [uniqueSortedIds]
  )

  const map = new Map<string, LockedProduct>()
  for (const row of rows) {
    map.set(row.id, { id: row.id, name: row.name, unit: row.unit, price: row.price, available: !!row.available, stock: row.stock })
  }

  // منتجات ليها دفعات (اتستلمت عن طريق نظام المشتريات) — الرصيد المستخدم في التحقق من
  // توفر الكمية بيبقى الرصيد "القابل للبيع" (بيستثني أي دفعة منتهية الصلاحية)، مش
  // products.stock الخام. منتجات من غير أي دفعة (مخزون قديم) تفضل تعتمد على الرصيد الخام.
  const sellableByProduct = await getSellableStockMap(client, uniqueSortedIds)
  for (const [productId, sellable] of sellableByProduct) {
    const product = map.get(productId)
    if (product) product.stock = sellable
  }

  return map
}

export function validateItemAgainstProduct(
  productId: string,
  quantity: number,
  product: LockedProduct | undefined
): InventoryErrorDetail | null {
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QUANTITY_PER_ITEM) {
    return { code: 'invalid_quantity', productId }
  }
  if (!product) return { code: 'product_not_found', productId }
  if (!product.available) return { code: 'product_unavailable', productId }
  if (product.stock < quantity) return { code: 'insufficient_stock', productId, available: product.stock, requested: quantity }
  return null
}

// خصم ذرّي: الشرط stock >= quantity جوه نفس جملة الـ UPDATE نفسها (مش قراءة منفصلة قبلها
// بفاصل زمني ممكن يتغير فيه أي حاجة) — خط دفاع أخير يمنع رصيد سالب حتى لو حصل أي تعارض
// غير متوقع رغم الـ FOR UPDATE. بيسجّل حركة 'sale' في نفس المعاملة، مرتبطة برقم الطلب.
export async function deductStockForOrder(client: PoolClient, productId: string, quantity: number, orderId: string): Promise<number> {
  const { rows } = await client.query<{ stock: number }>(
    'UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING stock',
    [quantity, productId]
  )
  const row = rows[0]
  if (!row) throw new InventoryValidationError({ code: 'insufficient_stock', productId, available: 0, requested: quantity })

  const { rows: movementRows } = await client.query<{ id: number }>(
    `INSERT INTO stock_movements (product_id, type, quantity_change, note, created_at, order_id, quantity_before, quantity_after)
     VALUES ($1, 'sale', $2, $3, $4, $5, $6, $7) RETURNING id`,
    [productId, -quantity, `بيع — طلب ${orderId}`, new Date().toISOString(), orderId, row.stock + quantity, row.stock]
  )
  await consumeBatchesFefo(client, productId, quantity, movementRows[0].id)
  return row.stock
}

// استرجاع مخزون طلب مُلغى — idempotent: لو فيه حركة cancel_restore مسجّلة لنفس الطلب
// بالفعل، مبيرجّعش المخزون تاني (يمنع تكرار الاسترجاع لو الإلغاء اتنفذ أكتر من مرة).
export async function restoreStockForCancelledOrder(client: PoolClient, orderId: string): Promise<'restored' | 'already_restored'> {
  const { rows: existing } = await client.query(
    `SELECT 1 FROM stock_movements WHERE order_id = $1 AND type = 'cancel_restore' LIMIT 1`,
    [orderId]
  )
  if (existing[0]) return 'already_restored'

  const { rows: items } = await client.query<{ productId: string, quantity: number }>(
    'SELECT product_id as "productId", quantity FROM order_items WHERE order_id = $1',
    [orderId]
  )

  for (const item of items) {
    const { rows } = await client.query<{ stock: number }>(
      'UPDATE products SET stock = stock + $1 WHERE id = $2 RETURNING stock',
      [item.quantity, item.productId]
    )
    const row = rows[0]
    if (!row) continue // المنتج اتحذف نهائياً — مفيش رصيد نرجّعله

    await client.query(
      `INSERT INTO stock_movements (product_id, type, quantity_change, note, created_at, order_id, quantity_before, quantity_after)
       VALUES ($1, 'cancel_restore', $2, $3, $4, $5, $6, $7)`,
      [item.productId, item.quantity, `إلغاء طلب ${orderId}`, new Date().toISOString(), orderId, row.stock - item.quantity, row.stock]
    )

    // نرجّع الكمية بالظبط لنفس الدفعات اللي اتاخدت منها وقت البيع (مش دفعة عشوائية) —
    // بيمنع أي انحراف بين إجمالي الدفعات وproducts.stock بعد إلغاء طلب.
    const { rows: saleMovementRows } = await client.query<{ id: number }>(
      `SELECT id FROM stock_movements WHERE order_id = $1 AND product_id = $2 AND type = 'sale' LIMIT 1`,
      [orderId, item.productId]
    )
    if (saleMovementRows[0]) await restoreBatchConsumptionsForMovement(client, saleMovementRows[0].id)
  }
  return 'restored'
}
