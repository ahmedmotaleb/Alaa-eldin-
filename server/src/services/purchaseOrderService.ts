import crypto from 'node:crypto'
import { pool, withTransaction } from '../db.js'

export type PurchaseOrderStatus = 'draft' | 'submitted' | 'partially_received' | 'received' | 'cancelled'

// أي انتقال حالة غير موجود هنا مرفوض — التسلسل الطبيعي draft -> submitted -> (partially_received) -> received،
// والإلغاء متاح من أي حالة نشطة قبل الاكتمال الكامل. partially_received/received بيتحطوا بس من مسار
// استلام البضاعة نفسه (المرحلة الجاية)، مش عبر هذا الـ endpoint اليدوي.
const ALLOWED_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['cancelled'],
  partially_received: ['cancelled'],
  received: [],
  cancelled: []
}

export function canTransitionPurchaseOrderStatus(from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean {
  if (from === to) return true
  return ALLOWED_TRANSITIONS[from].includes(to)
}

export interface PurchaseOrderItemInput {
  productId: string
  orderedQty: number
  unitCost: number
}

export interface PurchaseOrderInput {
  supplierId: string
  expectedDate?: string | null
  notes?: string
  discount?: number
  shippingCost?: number
  items: PurchaseOrderItemInput[]
}

export interface PurchaseOrderItemRow {
  id: string
  purchaseOrderId: string
  productId: string
  productName: string
  orderedQty: number
  receivedQty: number
  unitCost: number
  lineTotal: number
}

export interface PurchaseOrderRow {
  id: string
  poNumber: string
  supplierId: string
  supplierName: string
  status: PurchaseOrderStatus
  expectedDate: string | null
  notes: string
  subtotal: number
  discount: number
  shippingCost: number
  total: number
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
}

const PO_SELECT = `
  SELECT po.id, po.po_number as "poNumber", po.supplier_id as "supplierId", s.name as "supplierName",
         po.status, po.expected_date as "expectedDate", po.notes, po.subtotal, po.discount,
         po.shipping_cost as "shippingCost", po.total, po.created_by_user_id as "createdByUserId",
         po.created_at as "createdAt", po.updated_at as "updatedAt"
  FROM purchase_orders po
  JOIN suppliers s ON s.id = po.supplier_id
`

function validateItems(items: PurchaseOrderItemInput[]): string | null {
  if (!items.length) return 'no_items'
  for (const item of items) {
    if (!item.productId) return 'invalid_item'
    if (!Number.isFinite(item.orderedQty) || item.orderedQty <= 0) return 'invalid_quantity'
    if (!Number.isFinite(item.unitCost) || item.unitCost < 0) return 'invalid_cost'
  }
  return null
}

// السيرفر هو اللي بيحسب كل الإجماليات — مفيش أي رقم متبعت من الواجهة بيتصدّق زي ما هو،
// نفس مبدأ حساب إجمالي الطلبات العادية.
function computeTotals(items: PurchaseOrderItemInput[], discount: number, shippingCost: number) {
  const lineTotals = items.map(item => Math.round(item.orderedQty * item.unitCost * 100) / 100)
  const subtotal = Math.round(lineTotals.reduce((sum, n) => sum + n, 0) * 100) / 100
  const total = Math.max(0, subtotal - discount) + shippingCost
  return { lineTotals, subtotal, total: Math.round(total * 100) / 100 }
}

export async function createPurchaseOrder(input: PurchaseOrderInput, createdByUserId: string): Promise<PurchaseOrderRow> {
  const itemsError = validateItems(input.items)
  if (itemsError) throw new Error(itemsError)

  const discount = input.discount ?? 0
  const shippingCost = input.shippingCost ?? 0
  const { lineTotals, subtotal, total } = computeTotals(input.items, discount, shippingCost)

  return withTransaction(async client => {
    const { rows: seqRows } = await client.query<{ n: number }>("SELECT nextval('purchase_order_number_seq') as n")
    const poNumber = `PO-${seqRows[0].n}`
    const id = crypto.randomUUID()

    await client.query(
      `INSERT INTO purchase_orders (id, po_number, supplier_id, status, expected_date, notes, subtotal, discount, shipping_cost, total, created_by_user_id)
       VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10)`,
      [id, poNumber, input.supplierId, input.expectedDate ?? null, input.notes?.trim() ?? '', subtotal, discount, shippingCost, total, createdByUserId]
    )

    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i]
      await client.query(
        `INSERT INTO purchase_order_items (id, purchase_order_id, product_id, ordered_qty, unit_cost, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [crypto.randomUUID(), id, item.productId, item.orderedQty, item.unitCost, lineTotals[i]]
      )
    }

    const { rows } = await client.query<PurchaseOrderRow>(`${PO_SELECT} WHERE po.id = $1`, [id])
    return rows[0]
  })
}

export async function listPurchaseOrders(params: { status?: PurchaseOrderStatus; supplierId?: string; search?: string } = {}): Promise<PurchaseOrderRow[]> {
  const conditions: string[] = []
  const values: unknown[] = []
  if (params.status) { values.push(params.status); conditions.push(`po.status = $${values.length}`) }
  if (params.supplierId) { values.push(params.supplierId); conditions.push(`po.supplier_id = $${values.length}`) }
  if (params.search?.trim()) { values.push(`%${params.search.trim()}%`); conditions.push(`po.po_number ILIKE $${values.length}`) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const { rows } = await pool.query<PurchaseOrderRow>(`${PO_SELECT} ${where} ORDER BY po.created_at DESC`, values)
  return rows
}

export async function getPurchaseOrderById(id: string): Promise<{ order: PurchaseOrderRow; items: PurchaseOrderItemRow[] } | null> {
  const { rows } = await pool.query<PurchaseOrderRow>(`${PO_SELECT} WHERE po.id = $1`, [id])
  if (!rows[0]) return null

  const { rows: items } = await pool.query<PurchaseOrderItemRow>(
    `SELECT poi.id, poi.purchase_order_id as "purchaseOrderId", poi.product_id as "productId", p.name as "productName",
            poi.ordered_qty as "orderedQty", poi.received_qty as "receivedQty", poi.unit_cost as "unitCost", poi.line_total as "lineTotal"
     FROM purchase_order_items poi
     JOIN products p ON p.id = poi.product_id
     WHERE poi.purchase_order_id = $1
     ORDER BY poi.id`,
    [id]
  )
  return { order: rows[0], items }
}

// تعديل أمر شراء (استبدال كل البنود) — مسموح بس في حالة "draft"، عشان بعد ما يتبعت (submitted)
// أو يتستلم جزئياً/كلياً، أي تعديل في الكميات/التكلفة كان هيكسر حسابات الاستلام والمخزون.
export async function updateDraftPurchaseOrder(id: string, input: PurchaseOrderInput): Promise<PurchaseOrderRow | { error: string }> {
  const itemsError = validateItems(input.items)
  if (itemsError) return { error: itemsError }

  const discount = input.discount ?? 0
  const shippingCost = input.shippingCost ?? 0
  const { lineTotals, subtotal, total } = computeTotals(input.items, discount, shippingCost)

  return withTransaction(async client => {
    const { rows: existing } = await client.query<{ status: PurchaseOrderStatus }>(
      'SELECT status FROM purchase_orders WHERE id = $1 FOR UPDATE',
      [id]
    )
    if (!existing[0]) return { error: 'not_found' }
    if (existing[0].status !== 'draft') return { error: 'not_editable' }

    await client.query(
      `UPDATE purchase_orders SET supplier_id = $2, expected_date = $3, notes = $4,
         subtotal = $5, discount = $6, shipping_cost = $7, total = $8, updated_at = now()
       WHERE id = $1`,
      [id, input.supplierId, input.expectedDate ?? null, input.notes?.trim() ?? '', subtotal, discount, shippingCost, total]
    )
    await client.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [id])
    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i]
      await client.query(
        `INSERT INTO purchase_order_items (id, purchase_order_id, product_id, ordered_qty, unit_cost, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [crypto.randomUUID(), id, item.productId, item.orderedQty, item.unitCost, lineTotals[i]]
      )
    }

    const { rows } = await client.query<PurchaseOrderRow>(`${PO_SELECT} WHERE po.id = $1`, [id])
    return rows[0]
  })
}

export async function updatePurchaseOrderStatus(id: string, toStatus: PurchaseOrderStatus): Promise<PurchaseOrderRow | { error: string }> {
  return withTransaction(async client => {
    const { rows: existing } = await client.query<{ status: PurchaseOrderStatus }>(
      'SELECT status FROM purchase_orders WHERE id = $1 FOR UPDATE',
      [id]
    )
    if (!existing[0]) return { error: 'not_found' }
    if (!canTransitionPurchaseOrderStatus(existing[0].status, toStatus)) return { error: 'invalid_transition' }

    await client.query('UPDATE purchase_orders SET status = $2, updated_at = now() WHERE id = $1', [id, toStatus])
    const { rows } = await client.query<PurchaseOrderRow>(`${PO_SELECT} WHERE po.id = $1`, [id])
    return rows[0]
  })
}
