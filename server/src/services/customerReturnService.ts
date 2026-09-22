import crypto from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool, withTransaction } from '../db.js'
import { notifyBackInStockIfNeeded } from './backInStockService.js'
import { restoreRedeemedPointsForOrder, reverseEarnedPointsForOrder } from './loyaltyService.js'

export type CustomerReturnStatus = 'requested' | 'approved' | 'received' | 'refunded' | 'rejected' | 'cancelled'
export type ReturnItemCondition = 'return_to_stock' | 'damaged' | 'expired' | 'discard'

// المخزون بيرجع بس لحظة "received" (استلام فعلي)، مش لحظة "requested" — محدش يقدر يزوّد
// مخزونه بمجرد ما "يطلب" مرتجع من غير ما يرجّع حاجة فعلياً. الاسترداد المالي (refunded)
// حالة تسجيل فقط — مفيش أي تحريك فلوس تلقائي (بيئة الدفع عند الاستلام).
const ALLOWED_TRANSITIONS: Record<CustomerReturnStatus, CustomerReturnStatus[]> = {
  requested: ['approved', 'rejected', 'cancelled'],
  approved: ['received', 'cancelled'],
  received: ['refunded'],
  refunded: [],
  rejected: [],
  cancelled: []
}

export function canTransitionCustomerReturnStatus(from: CustomerReturnStatus, to: CustomerReturnStatus): boolean {
  if (from === to) return true
  return ALLOWED_TRANSITIONS[from].includes(to)
}

export interface CustomerReturnItemInput {
  orderItemId: number
  productId: string
  variantId?: string | null
  quantity: number
  condition?: ReturnItemCondition
}

export interface CustomerReturnInput {
  orderId: string
  reason?: string
  notes?: string
  items: CustomerReturnItemInput[]
}

export interface CustomerReturnRow {
  id: string
  returnNumber: string
  orderId: string
  orderNumber: string
  customerId: string | null
  status: CustomerReturnStatus
  reason: string
  notes: string
  refundAmount: number
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
}

export interface CustomerReturnItemRow {
  id: string
  customerReturnId: string
  productId: string
  productName: string
  variantId: string | null
  variantName: string | null
  orderItemId: number
  quantity: number
  condition: ReturnItemCondition
  refundAmount: number
}

const RETURN_SELECT = `
  SELECT cr.id, cr.return_number as "returnNumber", cr.order_id as "orderId", o.order_number as "orderNumber",
         cr.customer_id as "customerId", cr.status, cr.reason, cr.notes, cr.refund_amount as "refundAmount",
         cr.created_by_user_id as "createdByUserId", cr.created_at as "createdAt", cr.updated_at as "updatedAt"
  FROM customer_returns cr
  JOIN orders o ON o.id = cr.order_id
`

// إجمالي الكمية المُرجعة فعلياً لبند طلب مُعيّن لحد الآن (من غير أي مرتجع اتلغى أو اترفض) —
// عشان لا يقدر حد يرجّع نفس المنتج مرتين أكتر من الكمية اللي فعلاً اتباعت.
async function getAlreadyReturnedQty(orderItemId: number): Promise<number> {
  const { rows } = await pool.query<{ total: string | null }>(
    `SELECT SUM(cri.quantity) as total
     FROM customer_return_items cri
     JOIN customer_returns cr ON cr.id = cri.customer_return_id
     WHERE cri.order_item_id = $1 AND cr.status NOT IN ('rejected', 'cancelled')`,
    [orderItemId]
  )
  return Number(rows[0].total ?? 0)
}

function validateItems(items: CustomerReturnItemInput[]): string | null {
  if (!items.length) return 'no_items'
  for (const item of items) {
    if (!item.orderItemId || !item.productId) return 'invalid_item'
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) return 'invalid_quantity'
  }
  return null
}

export async function createCustomerReturn(input: CustomerReturnInput, userId: string | null): Promise<CustomerReturnRow | { error: string; orderItemId?: number }> {
  const itemsError = validateItems(input.items)
  if (itemsError) return { error: itemsError }

  return withTransaction(async client => {
    const { rows: orderRows } = await client.query<{ id: string; userId: string | null }>(
      'SELECT id, user_id as "userId" FROM orders WHERE id = $1',
      [input.orderId]
    )
    if (!orderRows[0]) return { error: 'order_not_found' }

    let refundAmount = 0
    for (const item of input.items) {
      const { rows: orderItemRows } = await client.query<{ productId: string; variantId: string | null; quantity: number; unitPrice: number }>(
        'SELECT product_id as "productId", variant_id as "variantId", quantity, unit_price as "unitPrice" FROM order_items WHERE id = $1 AND order_id = $2',
        [item.orderItemId, input.orderId]
      )
      const orderItem = orderItemRows[0]
      if (!orderItem || orderItem.productId !== item.productId) return { error: 'order_item_mismatch', orderItemId: item.orderItemId }
      if ((orderItem.variantId ?? null) !== (item.variantId ?? null)) return { error: 'order_item_mismatch', orderItemId: item.orderItemId }

      const alreadyReturned = await getAlreadyReturnedQty(item.orderItemId)
      if (alreadyReturned + item.quantity > orderItem.quantity) return { error: 'exceeds_sold_quantity', orderItemId: item.orderItemId }

      refundAmount += orderItem.unitPrice * item.quantity
    }
    refundAmount = Math.round(refundAmount * 100) / 100

    const { rows: seqRows } = await client.query<{ n: number }>("SELECT nextval('customer_return_number_seq') as n")
    const returnNumber = `CR-${seqRows[0].n}`
    const id = crypto.randomUUID()

    await client.query(
      `INSERT INTO customer_returns (id, return_number, order_id, customer_id, status, reason, notes, refund_amount, created_by_user_id)
       VALUES ($1, $2, $3, $4, 'requested', $5, $6, $7, $8)`,
      [id, returnNumber, input.orderId, orderRows[0].userId, input.reason?.trim() ?? '', input.notes?.trim() ?? '', refundAmount, userId]
    )

    for (const item of input.items) {
      const { rows: orderItemRows } = await client.query<{ unitPrice: number }>(
        'SELECT unit_price as "unitPrice" FROM order_items WHERE id = $1', [item.orderItemId]
      )
      await client.query(
        `INSERT INTO customer_return_items (id, customer_return_id, product_id, variant_id, order_item_id, quantity, condition, refund_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          crypto.randomUUID(), id, item.productId, item.variantId ?? null, item.orderItemId, item.quantity,
          item.condition ?? 'return_to_stock', Math.round(orderItemRows[0].unitPrice * item.quantity * 100) / 100
        ]
      )
    }

    const { rows } = await client.query<CustomerReturnRow>(`${RETURN_SELECT} WHERE cr.id = $1`, [id])
    return rows[0]
  })
}

export async function listCustomerReturns(params: { status?: CustomerReturnStatus; orderId?: string } = {}): Promise<CustomerReturnRow[]> {
  const conditions: string[] = []
  const values: unknown[] = []
  if (params.status) { values.push(params.status); conditions.push(`cr.status = $${values.length}`) }
  if (params.orderId) { values.push(params.orderId); conditions.push(`cr.order_id = $${values.length}`) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const { rows } = await pool.query<CustomerReturnRow>(`${RETURN_SELECT} ${where} ORDER BY cr.created_at DESC`, values)
  return rows
}

export async function getCustomerReturnById(id: string): Promise<{ customerReturn: CustomerReturnRow; items: CustomerReturnItemRow[] } | null> {
  const { rows } = await pool.query<CustomerReturnRow>(`${RETURN_SELECT} WHERE cr.id = $1`, [id])
  if (!rows[0]) return null
  const { rows: items } = await pool.query<CustomerReturnItemRow>(
    `SELECT cri.id, cri.customer_return_id as "customerReturnId", cri.product_id as "productId", p.name as "productName",
            cri.variant_id as "variantId", v.name as "variantName",
            cri.order_item_id as "orderItemId", cri.quantity, cri.condition, cri.refund_amount as "refundAmount"
     FROM customer_return_items cri
     JOIN products p ON p.id = cri.product_id
     LEFT JOIN product_variants v ON v.id = cri.variant_id
     WHERE cri.customer_return_id = $1
     ORDER BY cri.id`,
    [id]
  )
  return { customerReturn: rows[0], items }
}

export async function updateCustomerReturnStatus(
  id: string,
  toStatus: CustomerReturnStatus
): Promise<CustomerReturnRow | { error: string }> {
  return withTransaction(async client => {
    const { rows: existing } = await client.query<{ status: CustomerReturnStatus }>(
      'SELECT status FROM customer_returns WHERE id = $1 FOR UPDATE',
      [id]
    )
    if (!existing[0]) return { error: 'not_found' }
    const fromStatus = existing[0].status
    if (!canTransitionCustomerReturnStatus(fromStatus, toStatus)) return { error: 'invalid_transition' }

    // "received" هي اللحظة الوحيدة اللي المخزون بيتأثر فيها — وبس للأصناف اللي قرارها
    // "return_to_stock"؛ التالف/منتهي الصلاحية/المرفوض ما بيرجعش للمخزون خالص.
    if (toStatus === 'received') {
      const { rows: items } = await client.query<{ productId: string; variantId: string | null; quantity: number; condition: ReturnItemCondition }>(
        'SELECT product_id as "productId", variant_id as "variantId", quantity, condition FROM customer_return_items WHERE customer_return_id = $1',
        [id]
      )
      for (const item of items) {
        if (item.condition !== 'return_to_stock') continue
        if (item.variantId) {
          const { rows: stockRows } = await client.query<{ stock: number }>(
            'UPDATE product_variants SET stock = stock + $1 WHERE id = $2 RETURNING stock',
            [item.quantity, item.variantId]
          )
          if (!stockRows[0]) continue
          await client.query(
            `INSERT INTO stock_movements (product_id, variant_id, type, quantity_change, note, created_at, quantity_before, quantity_after)
             VALUES ($1, $2, 'return', $3, $4, $5, $6, $7)`,
            [item.productId, item.variantId, item.quantity, `مرتجع عميل ${id}`, new Date().toISOString(), stockRows[0].stock - item.quantity, stockRows[0].stock]
          )
          await notifyBackInStockIfNeeded(client, item.productId, item.variantId)
        } else {
          const { rows: stockRows } = await client.query<{ stock: number }>(
            'UPDATE products SET stock = stock + $1 WHERE id = $2 RETURNING stock',
            [item.quantity, item.productId]
          )
          if (!stockRows[0]) continue
          await client.query(
            `INSERT INTO stock_movements (product_id, type, quantity_change, note, created_at, quantity_before, quantity_after)
             VALUES ($1, 'return', $2, $3, $4, $5, $6)`,
            [item.productId, item.quantity, `مرتجع عميل ${id}`, new Date().toISOString(), stockRows[0].stock - item.quantity, stockRows[0].stock]
          )
          await notifyBackInStockIfNeeded(client, item.productId)
        }
      }
    }

    await client.query('UPDATE customer_returns SET status = $2, updated_at = now() WHERE id = $1', [id, toStatus])

    // "refunded" هي اللحظة الوحيدة اللي ممكن تعني إن الطلب "اتلغى فعلياً" بعد التسليم من
    // منظور الولاء — لو الطلب بقى مُرجَّع بالكامل (كل بند فيه اتغطّى برضه بمرتجعات غير
    // مرفوضة/ملغاة)، بنرجّع أي نقاط اتستخدمت فيه ونلغي أي نقاط اتكسبت منه. مرتجع جزئي (بعض
    // البنود بس) مش بيتعامل معاه هنا عمداً — راجع التعليق فوق reverseEarnedPointsForOrder
    // وreverseLoyaltyForFullyReturnedOrder تحت لتفاصيل هذا القيد.
    if (toStatus === 'refunded') {
      const { rows: returnRows } = await client.query<{ orderId: string }>('SELECT order_id as "orderId" FROM customer_returns WHERE id = $1', [id])
      const orderId = returnRows[0]?.orderId
      if (orderId && await isOrderFullyReturned(client, orderId)) {
        await restoreRedeemedPointsForOrder(client, orderId)
        await reverseEarnedPointsForOrder(client, orderId)
      }
    }

    const { rows } = await client.query<CustomerReturnRow>(`${RETURN_SELECT} WHERE cr.id = $1`, [id])
    return rows[0]
  })
}

// بيتأكد إن كل بنود الطلب (مش بس بند المرتجع الحالي) اتغطّت بالكامل بمرتجعات فعلية (غير
// مرفوضة/ملغاة) — ده الفرق بين "مرتجع كامل" و"مرتجع جزئي". مرتجع جزئي متعمّد إنه ما يتعاملش
// معاه هنا (لا استرجاع نقاط ولا إلغاء اكتساب جزئي) — حساب تناسبي دقيق يحتاج ربط كل نقطة
// مكتسبة/مستخدمة بسطر بعينه في الطلب، وده تعقيد وخطر عدم دقة برة نطاق هذه الدفعة؛ التوثيق
// ده صريح بدل اختراع حساب تناسبي غير موثوق.
async function isOrderFullyReturned(client: PoolClient, orderId: string): Promise<boolean> {
  const { rows } = await client.query<{ fullyReturned: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM order_items oi
       WHERE oi.order_id = $1
         AND oi.quantity > COALESCE((
           SELECT SUM(cri.quantity) FROM customer_return_items cri
           JOIN customer_returns cr ON cr.id = cri.customer_return_id
           WHERE cri.order_item_id = oi.id AND cr.status NOT IN ('rejected', 'cancelled')
         ), 0)
     ) as "fullyReturned"`,
    [orderId]
  )
  return !!rows[0]?.fullyReturned
}
