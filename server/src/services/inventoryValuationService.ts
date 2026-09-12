import { pool } from '../db.js'
import { getSellableStockMap } from './inventoryBatchService.js'

export interface InventoryValuationSummary {
  totalSellableQty: number
  inventoryCostValue: number
  expiredValue: number
  lowStockValue: number
  costBasis: 'latest_cost'
}

// أساس التقييم هنا هو "latest_cost" (products.cost — بيتحدّث تلقائياً بآخر تكلفة استلام،
// راجع goodsReceivingService.ts) مش متوسط مرجّح (weighted average). ده اختيار مبسّط ومقصود:
// حساب متوسط مرجّح حقيقي يحتاج تتبع تكلفة كل دفعة مستقلة عبر عمر المخزون بالكامل (ممكن يُضاف
// لاحقاً باستخدام inventory_batches.unit_cost فعلياً)، وده مش تقييم محاسبي معتمد على أي حال —
// مجرد تقدير تشغيلي لصحة المخزون، موثّق بوضوح بدل ما يُدّعى دقة محاسبية غير موجودة فعلاً.
export async function getInventoryValuation(): Promise<InventoryValuationSummary> {
  const { rows: products } = await pool.query<{ id: string; stock: number; cost: number; alertThreshold: number }>(
    `SELECT id, stock, cost, alert_threshold as "alertThreshold" FROM products`
  )
  const sellableMap = await getSellableStockMap(pool, products.map(p => p.id))

  let totalSellableQty = 0
  let inventoryCostValue = 0
  let lowStockValue = 0

  for (const p of products) {
    const sellable = sellableMap.get(p.id) ?? p.stock
    totalSellableQty += sellable
    inventoryCostValue += sellable * p.cost
    if (p.stock <= p.alertThreshold) lowStockValue += p.stock * p.cost
  }

  const { rows: expiredRows } = await pool.query<{ value: string | null }>(
    `SELECT SUM(quantity_remaining * unit_cost) as value
     FROM inventory_batches
     WHERE quantity_remaining > 0 AND expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE`
  )
  const expiredValue = Number(expiredRows[0].value ?? 0)

  return {
    totalSellableQty,
    inventoryCostValue: Math.round(inventoryCostValue * 100) / 100,
    expiredValue: Math.round(expiredValue * 100) / 100,
    lowStockValue: Math.round(lowStockValue * 100) / 100,
    costBasis: 'latest_cost'
  }
}
