import { pool } from '../db.js'
import { getSellableStockMap } from './inventoryBatchService.js'

export type CostBasis = 'latest_cost' | 'weighted_average'

export interface InventoryValuationSummary {
  totalSellableQty: number
  inventoryCostValue: number
  expiredValue: number
  lowStockValue: number
  estimatedRevenueAtCurrentPrices: number
  estimatedGrossMarginPercent: number | null
  costBasis: CostBasis
}

// أساسين للتقييم:
// - "latest_cost" (products.cost — بيتحدّث تلقائياً بآخر تكلفة استلام، راجع goodsReceivingService.ts).
// - "متوسط تكلفة الشراء" (weighted_average): متوسط مرجّح لتكلفة كل الدفعات القابلة للبيع حالياً
//   (quantity_remaining > 0 وغير منتهية) من inventory_batches نفسها — مش رقم واحد ثابت، بيعكس
//   المزيج الفعلي لتكاليف الشراء المختلفة اللي لسه موجودة في المخزون. منتج ما استلمش أي دفعة
//   مسجّلة (نادر، زي منتج اتضاف يدوياً بمخزون ابتدائي من غير أمر شراء) بيرجع لـ latest_cost
//   كبديل، لأن مفيش تاريخ دفعات نحسب منه متوسط أصلاً.
//
// الاتنين تقديرات تشغيلية لصحة المخزون بس — مش تقييم محاسبي/ضريبي معتمد، وده موضّح في التسمية
// والواجهة عن قصد.
export async function getInventoryValuation(costBasis: CostBasis = 'latest_cost'): Promise<InventoryValuationSummary> {
  const { rows: products } = await pool.query<{ id: string; stock: number; cost: number; price: number; alertThreshold: number }>(
    `SELECT id, stock, cost, price, alert_threshold as "alertThreshold" FROM products`
  )
  const productIds = products.map(p => p.id)
  const sellableMap = await getSellableStockMap(pool, productIds)

  let weightedCostMap = new Map<string, number>()
  if (costBasis === 'weighted_average' && productIds.length) {
    const { rows } = await pool.query<{ productId: string; qty: string; costSum: string }>(
      `SELECT product_id as "productId", SUM(quantity_remaining) as qty, SUM(quantity_remaining * unit_cost) as "costSum"
       FROM inventory_batches
       WHERE quantity_remaining > 0 AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE) AND product_id = ANY($1::text[])
       GROUP BY product_id`,
      [productIds]
    )
    weightedCostMap = new Map(
      rows.filter(r => Number(r.qty) > 0).map(r => [r.productId, Number(r.costSum) / Number(r.qty)])
    )
  }

  function costFor(productId: string, latestCost: number): number {
    if (costBasis === 'latest_cost') return latestCost
    return weightedCostMap.get(productId) ?? latestCost
  }

  let totalSellableQty = 0
  let inventoryCostValue = 0
  let lowStockValue = 0
  let estimatedRevenueAtCurrentPrices = 0

  for (const p of products) {
    const sellable = sellableMap.get(p.id) ?? p.stock
    const unitCost = costFor(p.id, p.cost)
    totalSellableQty += sellable
    inventoryCostValue += sellable * unitCost
    estimatedRevenueAtCurrentPrices += sellable * p.price
    if (p.stock <= p.alertThreshold) lowStockValue += p.stock * unitCost
  }

  const { rows: expiredRows } = await pool.query<{ value: string | null }>(
    `SELECT SUM(quantity_remaining * unit_cost) as value
     FROM inventory_batches
     WHERE quantity_remaining > 0 AND expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE`
  )
  const expiredValue = Number(expiredRows[0].value ?? 0)

  const grossMargin = estimatedRevenueAtCurrentPrices - inventoryCostValue
  const estimatedGrossMarginPercent = estimatedRevenueAtCurrentPrices > 0
    ? Math.round((grossMargin / estimatedRevenueAtCurrentPrices) * 10000) / 100
    : null

  return {
    totalSellableQty,
    inventoryCostValue: Math.round(inventoryCostValue * 100) / 100,
    expiredValue: Math.round(expiredValue * 100) / 100,
    lowStockValue: Math.round(lowStockValue * 100) / 100,
    estimatedRevenueAtCurrentPrices: Math.round(estimatedRevenueAtCurrentPrices * 100) / 100,
    estimatedGrossMarginPercent,
    costBasis
  }
}
