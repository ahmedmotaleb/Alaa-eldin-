import crypto from 'node:crypto'
import { withTransaction, pool } from '../db.js'
import type { PurchaseOrderStatus } from './purchaseOrderService.js'

export interface ReceiveItemInput {
  productId: string
  quantity: number
  unitCost: number
  batchNumber?: string | null
  expiryDate?: string | null
  manufacturedDate?: string | null
}

export interface ReceiveGoodsInput {
  purchaseOrderId: string
  items: ReceiveItemInput[]
  notes?: string
}

export interface GoodsReceiptRow {
  id: string
  receiptNumber: string
  purchaseOrderId: string
  poNumber: string
  supplierId: string
  supplierName: string
  receivedByUserId: string | null
  receivedAt: string
  notes: string
}

export interface GoodsReceiptItemRow {
  id: string
  goodsReceiptId: string
  productId: string
  productName: string
  quantity: number
  unitCost: number
  batchNumber: string | null
  expiryDate: string | null
  manufacturedDate: string | null
}

class ReceivingError extends Error {
  constructor(public code: string, public productId?: string) {
    super(code)
  }
}

// السيرفر هو مصدر الحقيقة الوحيد لكل خطوات الاستلام (قفل أمر الشراء -> التحقق من الكمية
// المتبقية -> الإيصال وبنوده -> تحديث كميات الاستلام -> دفعة مخزون -> زيادة المخزون ->
// حركة مخزون -> تاريخ التكلفة) — كل ده جوه معاملة واحدة ذرّية، مفيش أي خطوة بتتنفذ لوحدها
// من الواجهة مباشرة على المخزون.
export async function receiveGoodsForPurchaseOrder(
  input: ReceiveGoodsInput,
  receivedByUserId: string
): Promise<{ receipt: GoodsReceiptRow; items: GoodsReceiptItemRow[] } | { error: string; productId?: string }> {
  if (!input.items.length) return { error: 'no_items' }
  for (const item of input.items) {
    if (!item.productId || !Number.isFinite(item.quantity) || item.quantity <= 0) return { error: 'invalid_item' }
    if (!Number.isFinite(item.unitCost) || item.unitCost < 0) return { error: 'invalid_cost' }
  }

  try {
    return await withTransaction(async client => {
      const { rows: poRows } = await client.query<{ id: string; status: PurchaseOrderStatus; poNumber: string; supplierId: string }>(
        `SELECT id, status, po_number as "poNumber", supplier_id as "supplierId" FROM purchase_orders WHERE id = $1 FOR UPDATE`,
        [input.purchaseOrderId]
      )
      const po = poRows[0]
      if (!po) throw new ReceivingError('purchase_order_not_found')
      if (po.status !== 'submitted' && po.status !== 'partially_received') throw new ReceivingError('purchase_order_not_receivable')

      const { rows: poItemRows } = await client.query<{ id: string; productId: string; orderedQty: number; receivedQty: number }>(
        `SELECT id, product_id as "productId", ordered_qty as "orderedQty", received_qty as "receivedQty"
         FROM purchase_order_items WHERE purchase_order_id = $1 FOR UPDATE`,
        [po.id]
      )
      const poItemByProduct = new Map(poItemRows.map(r => [r.productId, r]))

      // نتحقق من كل البنود الأول قبل ما نغيّر أي حاجة — استلام جزئي غير صالح لبند واحد
      // يوقف الإيصال كله (كله أو ولا حاجة)، بدل ما يسيب استلام نصفه متسجل.
      for (const item of input.items) {
        const poItem = poItemByProduct.get(item.productId)
        if (!poItem) throw new ReceivingError('product_not_in_order', item.productId)
        const remaining = poItem.orderedQty - poItem.receivedQty
        if (item.quantity > remaining) throw new ReceivingError('exceeds_remaining_quantity', item.productId)

        const { rows: productRows } = await client.query<{ tracksExpiry: number }>(
          'SELECT tracks_expiry as "tracksExpiry" FROM products WHERE id = $1 FOR UPDATE',
          [item.productId]
        )
        if (!productRows[0]) throw new ReceivingError('product_not_found', item.productId)
        if (productRows[0].tracksExpiry && !item.expiryDate) throw new ReceivingError('expiry_date_required', item.productId)
      }

      const { rows: seqRows } = await client.query<{ n: number }>("SELECT nextval('goods_receipt_number_seq') as n")
      const receiptNumber = `GR-${seqRows[0].n}`
      const receiptId = crypto.randomUUID()

      await client.query(
        `INSERT INTO goods_receipts (id, receipt_number, purchase_order_id, supplier_id, received_by_user_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [receiptId, receiptNumber, po.id, po.supplierId, receivedByUserId, input.notes?.trim() ?? '']
      )

      const items: GoodsReceiptItemRow[] = []
      for (const item of input.items) {
        const receiptItemId = crypto.randomUUID()
        const { rows: productNameRows } = await client.query<{ name: string }>('SELECT name FROM products WHERE id = $1', [item.productId])

        await client.query(
          `INSERT INTO goods_receipt_items (id, goods_receipt_id, product_id, quantity, unit_cost, batch_number, expiry_date, manufactured_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [receiptItemId, receiptId, item.productId, item.quantity, item.unitCost, item.batchNumber ?? null, item.expiryDate ?? null, item.manufacturedDate ?? null]
        )

        const poItem = poItemByProduct.get(item.productId)!
        await client.query('UPDATE purchase_order_items SET received_qty = received_qty + $1 WHERE id = $2', [item.quantity, poItem.id])

        await client.query(
          `INSERT INTO inventory_batches (id, product_id, supplier_id, goods_receipt_item_id, batch_number, expiry_date, manufactured_date, quantity_received, quantity_remaining, unit_cost)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)`,
          [crypto.randomUUID(), item.productId, po.supplierId, receiptItemId, item.batchNumber ?? null, item.expiryDate ?? null, item.manufacturedDate ?? null, item.quantity, item.unitCost]
        )

        // آخر تكلفة استلام بتبقى تكلفة المنتج الحالية (latest cost) — راجع توثيق قيمة
        // المخزون (تقرير قيمة المخزون) لتفاصيل ليه latest_cost اتّخد بدل المتوسط المرجّح.
        const { rows: stockRows } = await client.query<{ stock: number }>(
          'UPDATE products SET stock = stock + $1, cost = $2 WHERE id = $3 RETURNING stock',
          [item.quantity, item.unitCost, item.productId]
        )
        const newStock = stockRows[0].stock

        await client.query(
          `INSERT INTO stock_movements (product_id, type, quantity_change, note, created_at, quantity_before, quantity_after)
           VALUES ($1, 'restock', $2, $3, $4, $5, $6)`,
          [item.productId, item.quantity, `استلام بضاعة — إيصال ${receiptNumber} (أمر شراء ${po.poNumber})`, new Date().toISOString(), newStock - item.quantity, newStock]
        )

        await client.query(
          `INSERT INTO product_cost_history (id, product_id, supplier_id, unit_cost, source_type, source_id)
           VALUES ($1, $2, $3, $4, 'purchase_receipt', $5)`,
          [crypto.randomUUID(), item.productId, po.supplierId, item.unitCost, receiptId]
        )

        items.push({
          id: receiptItemId, goodsReceiptId: receiptId, productId: item.productId, productName: productNameRows[0]?.name ?? '',
          quantity: item.quantity, unitCost: item.unitCost, batchNumber: item.batchNumber ?? null,
          expiryDate: item.expiryDate ?? null, manufacturedDate: item.manufacturedDate ?? null
        })
      }

      const { rows: updatedPoItems } = await client.query<{ orderedQty: number; receivedQty: number }>(
        'SELECT ordered_qty as "orderedQty", received_qty as "receivedQty" FROM purchase_order_items WHERE purchase_order_id = $1',
        [po.id]
      )
      const allReceived = updatedPoItems.every(i => i.receivedQty >= i.orderedQty)
      const anyReceived = updatedPoItems.some(i => i.receivedQty > 0)
      const newStatus: PurchaseOrderStatus = allReceived ? 'received' : anyReceived ? 'partially_received' : po.status
      await client.query('UPDATE purchase_orders SET status = $2, updated_at = now() WHERE id = $1', [po.id, newStatus])

      const { rows: supplierRows } = await client.query<{ name: string }>('SELECT name FROM suppliers WHERE id = $1', [po.supplierId])

      const receipt: GoodsReceiptRow = {
        id: receiptId, receiptNumber, purchaseOrderId: po.id, poNumber: po.poNumber, supplierId: po.supplierId,
        supplierName: supplierRows[0]?.name ?? '', receivedByUserId, receivedAt: new Date().toISOString(), notes: input.notes?.trim() ?? ''
      }
      return { receipt, items }
    })
  } catch (err) {
    if (err instanceof ReceivingError) return { error: err.code, productId: err.productId }
    throw err
  }
}

const RECEIPT_SELECT = `
  SELECT gr.id, gr.receipt_number as "receiptNumber", gr.purchase_order_id as "purchaseOrderId",
         po.po_number as "poNumber", gr.supplier_id as "supplierId", s.name as "supplierName",
         gr.received_by_user_id as "receivedByUserId", gr.received_at as "receivedAt", gr.notes
  FROM goods_receipts gr
  JOIN purchase_orders po ON po.id = gr.purchase_order_id
  JOIN suppliers s ON s.id = gr.supplier_id
`

export async function listGoodsReceipts(params: { purchaseOrderId?: string } = {}): Promise<GoodsReceiptRow[]> {
  const conditions: string[] = []
  const values: unknown[] = []
  if (params.purchaseOrderId) { values.push(params.purchaseOrderId); conditions.push(`gr.purchase_order_id = $${values.length}`) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const { rows } = await pool.query<GoodsReceiptRow>(`${RECEIPT_SELECT} ${where} ORDER BY gr.received_at DESC`, values)
  return rows
}

export async function getGoodsReceiptById(id: string): Promise<{ receipt: GoodsReceiptRow; items: GoodsReceiptItemRow[] } | null> {
  const { rows } = await pool.query<GoodsReceiptRow>(`${RECEIPT_SELECT} WHERE gr.id = $1`, [id])
  if (!rows[0]) return null
  const { rows: items } = await pool.query<GoodsReceiptItemRow>(
    `SELECT gri.id, gri.goods_receipt_id as "goodsReceiptId", gri.product_id as "productId", p.name as "productName",
            gri.quantity, gri.unit_cost as "unitCost", gri.batch_number as "batchNumber",
            gri.expiry_date as "expiryDate", gri.manufactured_date as "manufacturedDate"
     FROM goods_receipt_items gri
     JOIN products p ON p.id = gri.product_id
     WHERE gri.goods_receipt_id = $1
     ORDER BY gri.id`,
    [id]
  )
  return { receipt: rows[0], items }
}
