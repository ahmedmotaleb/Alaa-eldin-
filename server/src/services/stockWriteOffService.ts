import type { PoolClient } from 'pg'
import { withTransaction } from '../db.js'
import { consumeBatchesForWriteOff } from './inventoryBatchService.js'

export type WriteOffReason = 'expired' | 'damaged' | 'lost' | 'inventory_adjustment' | 'supplier_return'

// نفس أنواع stock_movements.type الموجودة (damage/loss/adjustment) بتتغطى بأسباب الشطب دي —
// "منتهي الصلاحية" و"مرتجع لمورد" هما النوعين الجداد اللي اتضافوا في هذه المرحلة.
const REASON_TO_MOVEMENT_TYPE: Record<WriteOffReason, string> = {
  expired: 'expired',
  damaged: 'damage',
  lost: 'loss',
  inventory_adjustment: 'adjustment',
  supplier_return: 'supplier_return'
}

export interface WriteOffInput {
  productId: string
  quantity: number
  reason: WriteOffReason
  note?: string
  batchId?: string
}

// النواة الفعلية — بتاخد client جاهز (جوه معاملة حد تاني، زي مرتجعات الموردين) بدل ما تفتح
// معاملة خاصة بيها. بترجع رقم حركة المخزون كمان عشان أي مستدعي يقدر يعكسها بالظبط لاحقاً
// (مثال: إلغاء مرتجع مورد بعد ما اتوافق عليه).
export async function writeOffStockWithClient(
  client: PoolClient,
  userId: string,
  input: WriteOffInput
): Promise<{ newStock: number; stockMovementId: number } | { error: string }> {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return { error: 'invalid_quantity' }

  const { rows: productRows } = await client.query<{ stock: number }>(
    'SELECT stock FROM products WHERE id = $1 FOR UPDATE',
    [input.productId]
  )
  if (!productRows[0]) return { error: 'product_not_found' }
  if (productRows[0].stock < input.quantity) return { error: 'insufficient_stock' }

  const { rows: updated } = await client.query<{ stock: number }>(
    'UPDATE products SET stock = stock - $1 WHERE id = $2 RETURNING stock',
    [input.quantity, input.productId]
  )
  const newStock = updated[0].stock

  const { rows: movementRows } = await client.query<{ id: number }>(
    `INSERT INTO stock_movements (product_id, type, quantity_change, note, created_at, quantity_before, quantity_after, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      input.productId, REASON_TO_MOVEMENT_TYPE[input.reason], -input.quantity, input.note?.trim() ?? '',
      new Date().toISOString(), newStock + input.quantity, newStock, userId
    ]
  )

  if (input.batchId) {
    await client.query(
      'UPDATE inventory_batches SET quantity_remaining = GREATEST(quantity_remaining - $1, 0) WHERE id = $2 AND product_id = $3',
      [input.quantity, input.batchId, input.productId]
    )
    await client.query(
      'INSERT INTO batch_consumptions (stock_movement_id, batch_id, quantity) VALUES ($1, $2, $3)',
      [movementRows[0].id, input.batchId, input.quantity]
    )
  } else {
    await consumeBatchesForWriteOff(client, input.productId, input.quantity, movementRows[0].id, input.reason === 'expired')
  }

  return { newStock, stockMovementId: movementRows[0].id }
}

// كل شطب مخزون لازم يكون سيرفر-authoritative بالكامل: معاملة واحدة، حركة مخزون بسبب واضح
// وصاحب الإجراء، وتقليل فعلي من الدفعات (مش بس رقم products.stock الإجمالي) عشان الدفعات
// ما تنحرفش عن الإجمالي.
export async function writeOffStock(
  userId: string,
  input: WriteOffInput
): Promise<{ newStock: number } | { error: string }> {
  return withTransaction(client => writeOffStockWithClient(client, userId, input))
}
