import crypto from 'node:crypto'
import { pool, withTransaction } from '../db.js'
import { writeOffStockWithClient } from './stockWriteOffService.js'
import { restoreBatchConsumptionsForMovement } from './inventoryBatchService.js'

export type SupplierReturnStatus = 'draft' | 'approved' | 'sent' | 'completed' | 'cancelled'

// المخزون بينقص لحظة "approved" بس (قرار مؤكد)، مش وقت "draft". الإلغاء بعد الموافقة
// بيرجّع المخزون (راجع updateSupplierReturnStatus) — بعد "sent" مفيش رجوع، البضاعة خرجت فعلياً.
const ALLOWED_TRANSITIONS: Record<SupplierReturnStatus, SupplierReturnStatus[]> = {
  draft: ['approved', 'cancelled'],
  approved: ['sent', 'cancelled'],
  sent: ['completed'],
  completed: [],
  cancelled: []
}

export function canTransitionSupplierReturnStatus(from: SupplierReturnStatus, to: SupplierReturnStatus): boolean {
  if (from === to) return true
  return ALLOWED_TRANSITIONS[from].includes(to)
}

export interface SupplierReturnItemInput {
  productId: string
  batchId?: string | null
  quantity: number
  unitCost?: number
}

export interface SupplierReturnInput {
  supplierId: string
  purchaseOrderId?: string | null
  reason?: string
  items: SupplierReturnItemInput[]
}

export interface SupplierReturnRow {
  id: string
  returnNumber: string
  supplierId: string
  supplierName: string
  purchaseOrderId: string | null
  status: SupplierReturnStatus
  reason: string
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
}

export interface SupplierReturnItemRow {
  id: string
  supplierReturnId: string
  productId: string
  productName: string
  batchId: string | null
  quantity: number
  unitCost: number
}

const RETURN_SELECT = `
  SELECT sr.id, sr.return_number as "returnNumber", sr.supplier_id as "supplierId", s.name as "supplierName",
         sr.purchase_order_id as "purchaseOrderId", sr.status, sr.reason,
         sr.created_by_user_id as "createdByUserId", sr.created_at as "createdAt", sr.updated_at as "updatedAt"
  FROM supplier_returns sr
  JOIN suppliers s ON s.id = sr.supplier_id
`

function validateItems(items: SupplierReturnItemInput[]): string | null {
  if (!items.length) return 'no_items'
  for (const item of items) {
    if (!item.productId) return 'invalid_item'
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) return 'invalid_quantity'
  }
  return null
}

export async function createSupplierReturn(input: SupplierReturnInput, userId: string): Promise<SupplierReturnRow> {
  const itemsError = validateItems(input.items)
  if (itemsError) throw new Error(itemsError)

  return withTransaction(async client => {
    const { rows: seqRows } = await client.query<{ n: number }>("SELECT nextval('supplier_return_number_seq') as n")
    const returnNumber = `SR-${seqRows[0].n}`
    const id = crypto.randomUUID()

    await client.query(
      `INSERT INTO supplier_returns (id, return_number, supplier_id, purchase_order_id, status, reason, created_by_user_id)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6)`,
      [id, returnNumber, input.supplierId, input.purchaseOrderId ?? null, input.reason?.trim() ?? '', userId]
    )

    for (const item of input.items) {
      await client.query(
        `INSERT INTO supplier_return_items (id, supplier_return_id, product_id, batch_id, quantity, unit_cost)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [crypto.randomUUID(), id, item.productId, item.batchId ?? null, item.quantity, item.unitCost ?? 0]
      )
    }

    const { rows } = await client.query<SupplierReturnRow>(`${RETURN_SELECT} WHERE sr.id = $1`, [id])
    return rows[0]
  })
}

export async function listSupplierReturns(params: { status?: SupplierReturnStatus; supplierId?: string } = {}): Promise<SupplierReturnRow[]> {
  const conditions: string[] = []
  const values: unknown[] = []
  if (params.status) { values.push(params.status); conditions.push(`sr.status = $${values.length}`) }
  if (params.supplierId) { values.push(params.supplierId); conditions.push(`sr.supplier_id = $${values.length}`) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const { rows } = await pool.query<SupplierReturnRow>(`${RETURN_SELECT} ${where} ORDER BY sr.created_at DESC`, values)
  return rows
}

export async function getSupplierReturnById(id: string): Promise<{ supplierReturn: SupplierReturnRow; items: SupplierReturnItemRow[] } | null> {
  const { rows } = await pool.query<SupplierReturnRow>(`${RETURN_SELECT} WHERE sr.id = $1`, [id])
  if (!rows[0]) return null
  const { rows: items } = await pool.query<SupplierReturnItemRow>(
    `SELECT sri.id, sri.supplier_return_id as "supplierReturnId", sri.product_id as "productId", p.name as "productName",
            sri.batch_id as "batchId", sri.quantity, sri.unit_cost as "unitCost"
     FROM supplier_return_items sri
     JOIN products p ON p.id = sri.product_id
     WHERE sri.supplier_return_id = $1
     ORDER BY sri.id`,
    [id]
  )
  return { supplierReturn: rows[0], items }
}

export async function updateSupplierReturnStatus(
  id: string,
  toStatus: SupplierReturnStatus,
  userId: string
): Promise<SupplierReturnRow | { error: string }> {
  return withTransaction(async client => {
    const { rows: existing } = await client.query<{ status: SupplierReturnStatus; reason: string }>(
      'SELECT status, reason FROM supplier_returns WHERE id = $1 FOR UPDATE',
      [id]
    )
    if (!existing[0]) return { error: 'not_found' }
    const fromStatus = existing[0].status
    if (!canTransitionSupplierReturnStatus(fromStatus, toStatus)) return { error: 'invalid_transition' }

    const { rows: items } = await client.query<{ id: string; productId: string; batchId: string | null; quantity: number; stockMovementId: number | null }>(
      `SELECT id, product_id as "productId", batch_id as "batchId", quantity, stock_movement_id as "stockMovementId"
       FROM supplier_return_items WHERE supplier_return_id = $1`,
      [id]
    )

    // draft -> approved: ده اللحظة اللي المخزون فعلاً بينقص فيها (شطب بسبب "مرتجع لمورد").
    if (fromStatus === 'draft' && toStatus === 'approved') {
      for (const item of items) {
        const result = await writeOffStockWithClient(client, userId, {
          productId: item.productId, quantity: item.quantity, reason: 'supplier_return',
          note: `مرتجع مورد ${id}`, batchId: item.batchId ?? undefined
        })
        if ('error' in result) return { error: result.error }
        await client.query('UPDATE supplier_return_items SET stock_movement_id = $1 WHERE id = $2', [result.stockMovementId, item.id])
      }
    }

    // approved -> cancelled: نرجّع بالظبط لنفس الدفعات اللي اتاخد منها، ونزوّد المخزون تاني.
    if (fromStatus === 'approved' && toStatus === 'cancelled') {
      for (const item of items) {
        if (!item.stockMovementId) continue
        await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [item.quantity, item.productId])
        await restoreBatchConsumptionsForMovement(client, item.stockMovementId)
      }
    }

    await client.query('UPDATE supplier_returns SET status = $2, updated_at = now() WHERE id = $1', [id, toStatus])
    const { rows } = await client.query<SupplierReturnRow>(`${RETURN_SELECT} WHERE sr.id = $1`, [id])
    return rows[0]
  })
}
