import crypto from 'node:crypto'
import { pool, withTransaction } from '../db.js'
import { recordAuditLog } from './auditLogService.js'

export type BulkOperationType =
  | 'bulk_price_csv' | 'bulk_price_adjustment'
  | 'bulk_stock_csv' | 'bulk_stock_adjustment'
  | 'bulk_cost_csv'
export type BulkBatchStatus = 'completed' | 'rolled_back' | 'partially_rolled_back'

export interface BulkBatch {
  id: string
  operationType: BulkOperationType
  createdBy: string | null
  status: BulkBatchStatus
  totalRows: number
  successfulRows: number
  failedRows: number
  createdAt: string
  completedAt: string | null
}

const SELECT_BATCH = `
  SELECT id, operation_type as "operationType", created_by as "createdBy", status,
         total_rows as "totalRows", successful_rows as "successfulRows", failed_rows as "failedRows",
         created_at as "createdAt", completed_at as "completedAt"
  FROM bulk_operation_batches
`

// الدفعة بتتسجّل قبل معالجة أي صف — عشان صفوف السجل (price/cost history) تقدر تشاور عليها
// من نفس لحظة التنفيذ، مش بعد ما تخلص. الإجماليات بتتحدّث في finalizeBatch لما تخلص المعالجة.
export async function createBatch(operationType: BulkOperationType, createdBy: string): Promise<string> {
  const id = crypto.randomUUID()
  await pool.query(
    `INSERT INTO bulk_operation_batches (id, operation_type, created_by, status) VALUES ($1, $2, $3, 'completed')`,
    [id, operationType, createdBy]
  )
  return id
}

export async function finalizeBatch(batchId: string, totals: { totalRows: number, successfulRows: number, failedRows: number }): Promise<void> {
  await pool.query(
    `UPDATE bulk_operation_batches SET total_rows = $1, successful_rows = $2, failed_rows = $3, completed_at = now() WHERE id = $4`,
    [totals.totalRows, totals.successfulRows, totals.failedRows, batchId]
  )
}

export async function listBatches(operationType?: BulkOperationType): Promise<BulkBatch[]> {
  if (operationType) {
    const { rows } = await pool.query<BulkBatch>(`${SELECT_BATCH} WHERE operation_type = $1 ORDER BY created_at DESC`, [operationType])
    return rows
  }
  const { rows } = await pool.query<BulkBatch>(`${SELECT_BATCH} ORDER BY created_at DESC`)
  return rows
}

export async function getBatch(id: string): Promise<BulkBatch | null> {
  const { rows } = await pool.query<BulkBatch>(`${SELECT_BATCH} WHERE id = $1`, [id])
  return rows[0] ?? null
}

export interface PriceChangeDetail {
  productId: string
  variantId: string | null
  oldPrice: number
  newPrice: number
  oldOldPrice: number | null
  newOldPrice: number | null
  source: string
  createdAt: string
}

export interface CostChangeDetail {
  productId: string
  variantId: string | null
  oldCost: number | null
  newCost: number
  createdAt: string
}

export interface StockChangeDetail {
  productId: string
  variantId: string | null
  type: string
  quantityChange: number
  quantityBefore: number | null
  quantityAfter: number | null
  createdAt: string
}

export async function getBatchDetail(id: string): Promise<{ batch: BulkBatch, priceChanges: PriceChangeDetail[], costChanges: CostChangeDetail[], stockChanges: StockChangeDetail[] } | null> {
  const batch = await getBatch(id)
  if (!batch) return null

  const { rows: priceChanges } = await pool.query<PriceChangeDetail>(
    `SELECT product_id as "productId", variant_id as "variantId", old_price as "oldPrice", new_price as "newPrice",
            old_old_price as "oldOldPrice", new_old_price as "newOldPrice", source, created_at as "createdAt"
     FROM product_price_history WHERE bulk_batch_id = $1 ORDER BY id`,
    [id]
  )
  const { rows: costChanges } = await pool.query<CostChangeDetail>(
    `SELECT product_id as "productId", variant_id as "variantId", old_cost as "oldCost", unit_cost as "newCost", recorded_at as "createdAt"
     FROM product_cost_history WHERE bulk_batch_id = $1 ORDER BY id`,
    [id]
  )
  const { rows: stockChanges } = await pool.query<StockChangeDetail>(
    `SELECT product_id as "productId", variant_id as "variantId", type, quantity_change as "quantityChange",
            quantity_before as "quantityBefore", quantity_after as "quantityAfter", created_at as "createdAt"
     FROM stock_movements WHERE bulk_batch_id = $1 ORDER BY id`,
    [id]
  )
  return { batch, priceChanges, costChanges, stockChanges }
}

export interface ProductPriceHistoryEntry {
  id: number
  variantId: string | null
  variantName: string | null
  oldPrice: number
  newPrice: number
  oldOldPrice: number | null
  newOldPrice: number | null
  source: string
  adminName: string | null
  bulkBatchId: string | null
  createdAt: string
}

// سجل الأسعار الكامل لمنتج معيّن (بما فيه صفوف المتغيرات التابعة له) — لعرض تايم لاين "سجل
// الأسعار" في صفحة تعديل المنتج، الأحدث أولاً.
export async function getPriceHistoryForProduct(productId: string): Promise<ProductPriceHistoryEntry[]> {
  const { rows } = await pool.query<ProductPriceHistoryEntry>(
    `SELECT h.id, h.variant_id as "variantId", v.name as "variantName", h.old_price as "oldPrice", h.new_price as "newPrice",
            h.old_old_price as "oldOldPrice", h.new_old_price as "newOldPrice", h.source,
            u.full_name as "adminName", h.bulk_batch_id as "bulkBatchId", h.created_at as "createdAt"
     FROM product_price_history h
     LEFT JOIN product_variants v ON v.id = h.variant_id
     LEFT JOIN users u ON u.id = h.admin_user_id
     WHERE h.product_id = $1
     ORDER BY h.id DESC`,
    [productId]
  )
  return rows
}

export interface RollbackResult {
  rolledBackPrice: number
  rolledBackCost: number
  rolledBackStock: number
  conflicts: number
}

// التراجع آمن: كل صف بيتراجع بس لو القيمة الحالية في قاعدة البيانات لسه بالظبط نفس القيمة
// اللي الدفعة كتبتها (يعني محدش عدّل المنتج يدوياً بعد كده) — غير كده بيتعامل كـ "تعارض"
// ويتسجّل بدون أي تعديل. التراجع نفسه بيتسجّل كصف تاريخ جديد (source='rollback')، مش تعديل
// أو حذف للصف الأصلي — نفس مبدأ الـ ledger في كل سجلات التاريخ التانية في المشروع.
export async function rollbackBatch(batchId: string, adminUserId: string): Promise<RollbackResult> {
  return withTransaction(async client => {
    let rolledBackPrice = 0
    let rolledBackCost = 0
    let conflicts = 0

    const { rows: priceRows } = await client.query<{
      productId: string, variantId: string | null, oldPrice: number, newPrice: number, oldOldPrice: number | null, newOldPrice: number | null
    }>(
      `SELECT DISTINCT ON (product_id, variant_id) product_id as "productId", variant_id as "variantId",
              old_price as "oldPrice", new_price as "newPrice", old_old_price as "oldOldPrice", new_old_price as "newOldPrice"
       FROM product_price_history WHERE bulk_batch_id = $1
       ORDER BY product_id, variant_id, id DESC`,
      [batchId]
    )

    for (const row of priceRows) {
      if (row.variantId) {
        const { rows: current } = await client.query<{ price: number, oldPrice: number | null }>(
          'SELECT price, old_price as "oldPrice" FROM product_variants WHERE id = $1 FOR UPDATE', [row.variantId]
        )
        const cur = current[0]
        if (!cur || cur.price !== row.newPrice || (cur.oldPrice ?? null) !== (row.newOldPrice ?? null)) { conflicts++; continue }
        await client.query('UPDATE product_variants SET price = $1, old_price = $2 WHERE id = $3', [row.oldPrice, row.oldOldPrice, row.variantId])
      } else {
        const { rows: current } = await client.query<{ price: number, oldPrice: number | null }>(
          'SELECT price, old_price as "oldPrice" FROM products WHERE id = $1 FOR UPDATE', [row.productId]
        )
        const cur = current[0]
        if (!cur || cur.price !== row.newPrice || (cur.oldPrice ?? null) !== (row.newOldPrice ?? null)) { conflicts++; continue }
        await client.query('UPDATE products SET price = $1, old_price = $2 WHERE id = $3', [row.oldPrice, row.oldOldPrice, row.productId])
      }
      await client.query(
        `INSERT INTO product_price_history (product_id, variant_id, old_price, new_price, old_old_price, new_old_price, source, admin_user_id, bulk_batch_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'rollback', $7, $8)`,
        [row.productId, row.variantId, row.newPrice, row.oldPrice, row.newOldPrice, row.oldOldPrice, adminUserId, batchId]
      )
      rolledBackPrice++
    }

    const { rows: costRows } = await client.query<{ productId: string, variantId: string | null, oldCost: number | null, newCost: number }>(
      `SELECT DISTINCT ON (product_id, variant_id) product_id as "productId", variant_id as "variantId",
              old_cost as "oldCost", unit_cost as "newCost"
       FROM product_cost_history WHERE bulk_batch_id = $1
       ORDER BY product_id, variant_id, id DESC`,
      [batchId]
    )

    for (const row of costRows) {
      if (row.oldCost === null) { conflicts++; continue }
      if (row.variantId) {
        const { rows: current } = await client.query<{ cost: number }>('SELECT cost FROM product_variants WHERE id = $1 FOR UPDATE', [row.variantId])
        const cur = current[0]
        if (!cur || cur.cost !== row.newCost) { conflicts++; continue }
        await client.query('UPDATE product_variants SET cost = $1 WHERE id = $2', [row.oldCost, row.variantId])
      } else {
        const { rows: current } = await client.query<{ cost: number }>('SELECT cost FROM products WHERE id = $1 FOR UPDATE', [row.productId])
        const cur = current[0]
        if (!cur || cur.cost !== row.newCost) { conflicts++; continue }
        await client.query('UPDATE products SET cost = $1 WHERE id = $2', [row.oldCost, row.productId])
      }
      await client.query(
        `INSERT INTO product_cost_history (id, product_id, variant_id, unit_cost, old_cost, source_type, source_id, bulk_batch_id)
         VALUES ($1, $2, $3, $4, $5, 'bulk_price_update', $6, $7)`,
        [crypto.randomUUID(), row.productId, row.variantId, row.oldCost, row.newCost, adminUserId, batchId]
      )
      rolledBackCost++
    }

    // المخزون رصيد جاري (running total) مش قيمة نقطية زي السعر/التكلفة — ممكن تتغيّر بعمليات
    // بيع/استلام حقيقية بين الدفعة والتراجع. نفس مبدأ التعارض: التراجع بيرفض يلمس أي صف
    // رصيده الحالي مش بالظبط "quantity_after" اللي الدفعة سجّلته آخر مرة.
    const { rows: stockRows } = await client.query<{
      productId: string, variantId: string | null, quantityChange: number, quantityBefore: number | null, quantityAfter: number | null
    }>(
      `SELECT DISTINCT ON (product_id, variant_id) product_id as "productId", variant_id as "variantId",
              quantity_change as "quantityChange", quantity_before as "quantityBefore", quantity_after as "quantityAfter"
       FROM stock_movements WHERE bulk_batch_id = $1
       ORDER BY product_id, variant_id, id DESC`,
      [batchId]
    )

    let rolledBackStock = 0
    for (const row of stockRows) {
      if (row.quantityBefore === null || row.quantityAfter === null) { conflicts++; continue }
      if (row.variantId) {
        const { rows: current } = await client.query<{ stock: number }>('SELECT stock FROM product_variants WHERE id = $1 FOR UPDATE', [row.variantId])
        const cur = current[0]
        if (!cur || cur.stock !== row.quantityAfter) { conflicts++; continue }
        await client.query('UPDATE product_variants SET stock = $1 WHERE id = $2', [row.quantityBefore, row.variantId])
      } else {
        const { rows: current } = await client.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1 FOR UPDATE', [row.productId])
        const cur = current[0]
        if (!cur || cur.stock !== row.quantityAfter) { conflicts++; continue }
        await client.query('UPDATE products SET stock = $1 WHERE id = $2', [row.quantityBefore, row.productId])
      }
      await client.query(
        `INSERT INTO stock_movements (product_id, variant_id, type, quantity_change, quantity_before, quantity_after, note, created_by_user_id, bulk_batch_id, created_at)
         VALUES ($1, $2, 'adjustment', $3, $4, $5, 'تراجع عن عملية جماعية', $6, $7, now())`,
        [row.productId, row.variantId, -row.quantityChange, row.quantityAfter, row.quantityBefore, adminUserId, batchId]
      )
      rolledBackStock++
    }

    const totalRolledBack = rolledBackPrice + rolledBackCost + rolledBackStock
    if (totalRolledBack > 0 || conflicts > 0) {
      const newStatus: BulkBatchStatus = conflicts === 0 ? 'rolled_back' : 'partially_rolled_back'
      await client.query('UPDATE bulk_operation_batches SET status = $1 WHERE id = $2', [newStatus, batchId])
    }

    await recordAuditLog({
      adminUserId, action: 'bulk_price_batch_rolled_back', entityType: 'bulk_operation_batch', entityId: batchId,
      newValues: { rolledBackPrice, rolledBackCost, rolledBackStock, conflicts }
    })

    return { rolledBackPrice, rolledBackCost, rolledBackStock, conflicts }
  })
}
