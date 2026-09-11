import type { PoolClient } from 'pg'
import { pool } from '../db.js'

export interface ExpiryBatchRow {
  batchId: string
  productId: string
  productName: string
  batchNumber: string | null
  quantityRemaining: number
  unitCost: number
  expiryDate: string
  daysRemaining: number
  costValueAtRisk: number
}

export interface ExpiryDashboard {
  expired: ExpiryBatchRow[]
  within7Days: ExpiryBatchRow[]
  within30Days: ExpiryBatchRow[]
  within60Days: ExpiryBatchRow[]
}

// بيرجع كل الدفعات اللي عندها كمية متبقية وتاريخ صلاحية خلال آخر حد (60 يوم) — ومقسّمة هنا
// لأربع مجموعات: منتهية فعلاً، وخلال 7/30/60 يوم. دفعة منتهية بالفعل بتفضل ظاهرة هنا (مش
// بتتشال تلقائياً) لحد ما حد يعمل لها "شطب مخزون" (write-off) صريح — راجع مرحلة تسوية المخزون.
export async function getExpiryDashboard(): Promise<ExpiryDashboard> {
  const { rows } = await pool.query<{
    batchId: string; productId: string; productName: string; batchNumber: string | null
    quantityRemaining: number; unitCost: number; expiryDate: string; daysRemaining: number
  }>(
    `SELECT ib.id as "batchId", ib.product_id as "productId", p.name as "productName",
            ib.batch_number as "batchNumber", ib.quantity_remaining as "quantityRemaining",
            ib.unit_cost as "unitCost", ib.expiry_date as "expiryDate",
            (ib.expiry_date - CURRENT_DATE)::int as "daysRemaining"
     FROM inventory_batches ib
     JOIN products p ON p.id = ib.product_id
     WHERE ib.quantity_remaining > 0 AND ib.expiry_date IS NOT NULL
       AND ib.expiry_date <= CURRENT_DATE + 60
     ORDER BY ib.expiry_date ASC`
  )

  const withRisk: ExpiryBatchRow[] = rows.map(r => ({
    ...r,
    costValueAtRisk: Math.round(r.quantityRemaining * r.unitCost * 100) / 100
  }))

  return {
    expired: withRisk.filter(r => r.daysRemaining < 0),
    within7Days: withRisk.filter(r => r.daysRemaining >= 0 && r.daysRemaining <= 7),
    within30Days: withRisk.filter(r => r.daysRemaining > 7 && r.daysRemaining <= 30),
    within60Days: withRisk.filter(r => r.daysRemaining > 30 && r.daysRemaining <= 60)
  }
}

// رصيد قابل للبيع فعلاً — بيستثني أي دفعة منتهية الصلاحية. بيرجع null لو المنتج مالوش أي
// دفعات خالص (مخزون قديم قبل نظام الشراء/الاستلام) — الاستدعاء وقتها لازم يرجع لـ
// products.stock الخام زي ما كان دايماً، مش يعتبر الرصيد صفر.
export async function getSellableStock(client: PoolClient, productId: string): Promise<number | null> {
  const { rows } = await client.query<{ hasBatches: boolean; sellable: string }>(
    `SELECT COUNT(*) > 0 as "hasBatches",
            COALESCE(SUM(quantity_remaining) FILTER (WHERE expiry_date IS NULL OR expiry_date >= CURRENT_DATE), 0) as sellable
     FROM inventory_batches WHERE product_id = $1`,
    [productId]
  )
  if (!rows[0].hasBatches) return null
  return Number(rows[0].sellable)
}

// نفس فكرة getSellableStock لكن لمجموعة منتجات دفعة واحدة (تُستخدم وقت قفل منتجات الطلب) —
// بترجع خريطة المنتجات اللي ليها دفعات بس؛ أي منتج مش موجود في الخريطة يبقى من غير دفعات
// خالص، والمنادي لازم يفضل يستخدم products.stock الخام له.
export async function getSellableStockMap(client: PoolClient, productIds: string[]): Promise<Map<string, number>> {
  if (!productIds.length) return new Map()
  const { rows } = await client.query<{ productId: string; sellable: string }>(
    `SELECT product_id as "productId",
            COALESCE(SUM(quantity_remaining) FILTER (WHERE expiry_date IS NULL OR expiry_date >= CURRENT_DATE), 0) as sellable
     FROM inventory_batches WHERE product_id = ANY($1::text[]) GROUP BY product_id`,
    [productIds]
  )
  return new Map(rows.map(r => [r.productId, Number(r.sellable)]))
}

// استهلاك الدفعات بترتيب "الأقرب لانتهاء الصلاحية الأول" (FEFO) — بيستثني الدفعات المنتهية
// فعلاً (مش قابلة للبيع أصلاً) والدفعات الفارغة. كل استهلاك بيتسجّل في batch_consumptions
// مربوط بحركة المخزون نفسها، عشان لو الطلب اتلغى بعدين نقدر نرجّع بالظبط لنفس الدفعات
// (مش نضيف كمية لدفعة عشوائية) ومنع أي انحراف بين إجمالي الدفعات وproducts.stock.
export async function consumeBatchesFefo(client: PoolClient, productId: string, quantity: number, stockMovementId: number): Promise<void> {
  const { rows: batches } = await client.query<{ id: string; quantityRemaining: number }>(
    `SELECT id, quantity_remaining as "quantityRemaining" FROM inventory_batches
     WHERE product_id = $1 AND quantity_remaining > 0 AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
     ORDER BY expiry_date ASC NULLS LAST, created_at ASC
     FOR UPDATE`,
    [productId]
  )
  let remaining = quantity
  for (const batch of batches) {
    if (remaining <= 0) break
    const take = Math.min(batch.quantityRemaining, remaining)
    await client.query('UPDATE inventory_batches SET quantity_remaining = quantity_remaining - $1 WHERE id = $2', [take, batch.id])
    await client.query('INSERT INTO batch_consumptions (stock_movement_id, batch_id, quantity) VALUES ($1, $2, $3)', [stockMovementId, batch.id, take])
    remaining -= take
  }
  // لو فضل remaining > 0 معناه مفيش دفعات كفاية رغم إن products.stock سمح بالعملية — ده
  // يدل على انحراف موجود بالفعل بين الاتنين، هتكشفه شاشة "فحص المخزون" (مرحلة لاحقة)،
  // مش حاجة نفشل بيع عميل حقيقي بسببها هنا.
}

// عكس consumeBatchesFefo بالظبط: بيرجّع الكمية لنفس الدفعات اللي اتاخدت منها أصلاً وقت
// البيع (من batch_consumptions المربوطة بحركة "sale" الأصلية) — مش دفعة عشوائية جديدة.
export async function restoreBatchConsumptionsForMovement(client: PoolClient, originalStockMovementId: number): Promise<void> {
  const { rows: consumptions } = await client.query<{ batchId: string; quantity: number }>(
    'SELECT batch_id as "batchId", quantity FROM batch_consumptions WHERE stock_movement_id = $1',
    [originalStockMovementId]
  )
  for (const c of consumptions) {
    await client.query('UPDATE inventory_batches SET quantity_remaining = quantity_remaining + $1 WHERE id = $2', [c.quantity, c.batchId])
  }
}

// استهلاك للشطب (write-off) — لو السبب "منتهي الصلاحية" بنستهلك من الدفعات المنتهية فعلاً
// أولاً (عكس البيع اللي بيستثنيها خالص)، وإلا FEFO عادي من أي دفعة فيها كمية.
export async function consumeBatchesForWriteOff(
  client: PoolClient, productId: string, quantity: number, stockMovementId: number, preferExpired: boolean
): Promise<void> {
  const orderClause = preferExpired
    ? `(expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE) DESC, expiry_date ASC NULLS LAST`
    : `expiry_date ASC NULLS LAST`
  const { rows: batches } = await client.query<{ id: string; quantityRemaining: number }>(
    `SELECT id, quantity_remaining as "quantityRemaining" FROM inventory_batches
     WHERE product_id = $1 AND quantity_remaining > 0
     ORDER BY ${orderClause}, created_at ASC
     FOR UPDATE`,
    [productId]
  )
  let remaining = quantity
  for (const batch of batches) {
    if (remaining <= 0) break
    const take = Math.min(batch.quantityRemaining, remaining)
    await client.query('UPDATE inventory_batches SET quantity_remaining = quantity_remaining - $1 WHERE id = $2', [take, batch.id])
    await client.query('INSERT INTO batch_consumptions (stock_movement_id, batch_id, quantity) VALUES ($1, $2, $3)', [stockMovementId, batch.id, take])
    remaining -= take
  }
}
