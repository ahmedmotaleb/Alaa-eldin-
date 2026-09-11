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
