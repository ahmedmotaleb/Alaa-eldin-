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

// استرجاع فعلي لرصيد منتج واحد (زيادة products.stock + حركة مخزون + استرجاع نفس الدفعات
// اللي اتاخد منها وقت البيع الأصلي) — منطق مشترك بين إلغاء الطلب كله واعتماد استبدال صنف
// واحد فيه، عشان مفيش نسخة تانية من نفس الحسابات في مكانين.
async function restoreProductStock(
  client: PoolClient,
  productId: string,
  quantity: number,
  orderId: string,
  movementType: 'cancel_restore' | 'substitution_restore',
  note: string
): Promise<void> {
  const { rows } = await client.query<{ stock: number }>(
    'UPDATE products SET stock = stock + $1 WHERE id = $2 RETURNING stock',
    [quantity, productId]
  )
  const row = rows[0]
  if (!row) return // المنتج اتحذف نهائياً — مفيش رصيد نرجّعله

  await client.query(
    `INSERT INTO stock_movements (product_id, type, quantity_change, note, created_at, order_id, quantity_before, quantity_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [productId, movementType, quantity, note, new Date().toISOString(), orderId, row.stock - quantity, row.stock]
  )

  // نرجّع الكمية بالظبط لنفس الدفعات اللي اتاخدت منها وقت البيع (مش دفعة عشوائية) —
  // بيمنع أي انحراف بين إجمالي الدفعات وproducts.stock بعد الاسترجاع.
  const { rows: saleMovementRows } = await client.query<{ id: number }>(
    `SELECT id FROM stock_movements WHERE order_id = $1 AND product_id = $2 AND type = 'sale' ORDER BY id LIMIT 1`,
    [orderId, productId]
  )
  if (saleMovementRows[0]) await restoreBatchConsumptionsForMovement(client, saleMovementRows[0].id)
}

// استرجاع مخزون طلب مُلغى — idempotent: لو فيه حركة cancel_restore مسجّلة لنفس الطلب
// بالفعل، مبيرجّعش المخزون تاني (يمنع تكرار الاسترجاع لو الإلغاء اتنفذ أكتر من مرة).
export async function restoreStockForCancelledOrder(client: PoolClient, orderId: string): Promise<'restored' | 'already_restored'> {
  const { rows: existing } = await client.query(
    `SELECT 1 FROM stock_movements WHERE order_id = $1 AND type = 'cancel_restore' LIMIT 1`,
    [orderId]
  )
  if (existing[0]) return 'already_restored'

  // صنف اتاعتمد استبداله فعلاً (substitution_status='approved') رصيده الأصلي اتسترجع
  // بالفعل وقت اعتماد الاستبدال — استرجاعه تاني هنا هيبقى تكرار خاطئ. اللي فعلاً لسه
  // "مُلتزم بيه" في هذه الحالة هو المنتج البديل (اللي اتخصم فعلاً)، مش الأصلي.
  const { rows: items } = await client.query<{ productId: string, quantity: number, substitutionStatus: string, replacementProductId: string | null, replacementQuantity: number | null }>(
    `SELECT product_id as "productId", quantity, substitution_status as "substitutionStatus",
            replacement_product_id as "replacementProductId", replacement_quantity as "replacementQuantity"
     FROM order_items WHERE order_id = $1`,
    [orderId]
  )

  for (const item of items) {
    if (item.substitutionStatus === 'approved' && item.replacementProductId && item.replacementQuantity) {
      await restoreProductStock(client, item.replacementProductId, item.replacementQuantity, orderId, 'cancel_restore', `إلغاء طلب ${orderId}`)
    } else {
      await restoreProductStock(client, item.productId, item.quantity, orderId, 'cancel_restore', `إلغاء طلب ${orderId}`)
    }
  }
  return 'restored'
}

// اعتماد استبدال صنف بمنتج بديل فعلي: بيخصم رصيد البديل (زي أي عملية بيع عادية، عبر
// deductStockForOrder نفسها) وبيرجّع رصيد الصنف الأصلي (لأنه مش هيتسلّم فعلياً). الاتنين
// في نفس المعاملة اللي بيستدعيها الكولر — مفيش commit جزئي ممكن يسيب المخزون في حالة نص متسقة.
export async function applySubstitutionStockMove(
  client: PoolClient,
  orderId: string,
  originalProductId: string,
  originalQuantity: number,
  replacementProductId: string,
  replacementQuantity: number
): Promise<void> {
  await deductStockForOrder(client, replacementProductId, replacementQuantity, orderId)
  await restoreProductStock(client, originalProductId, originalQuantity, orderId, 'substitution_restore', `استبدال صنف — طلب ${orderId}`)
}
