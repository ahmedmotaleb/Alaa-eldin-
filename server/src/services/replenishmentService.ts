import { pool } from '../db.js'
import { getSellableStockMap } from './inventoryBatchService.js'

export interface ReplenishmentRow {
  productId: string
  productName: string
  currentStock: number
  avgDailySales7d: number
  avgDailySales30d: number
  daysOfCover: number | null
  incomingQty: number
  lastReceivedCost: number | null
  preferredSupplierId: string | null
  preferredSupplierName: string | null
  leadTimeDays: number | null
  minimumOrderQty: number | null
  suggestedReorderQty: number
}

// الصيغة موثّقة بالكامل هنا (وفي التقرير النهائي) — مفيش أي حسبة مخفية:
//
//   target_stock = avg_daily_sales_7d * target_days
//   suggested_reorder = max(target_stock - current_sellable_stock - incoming_qty, 0)
//
// incoming_qty = مجموع (الكمية المطلوبة - الكمية المُستلمة) في كل أوامر الشراء المفتوحة
// (submitted أو partially_received) لنفس المنتج — بدون طرحها، الاقتراح كان ممكن يقترح
// نفس الكمية تاني رغم إنها بالفعل في الطريق من مورد سابق (طلب مزدوج).
//
// لو فيه مورد مفضّل له حد أدنى للطلب (minimum_order_qty) والاقتراح المحسوب أقل منه لكن
// أكبر من صفر، بنرفعه لحد الأدنى المطلوب من المورد نفسه (تقريب واقعي، مش نظري بحت).
export async function getReplenishmentSuggestions(targetDays: number): Promise<ReplenishmentRow[]> {
  const { rows: products } = await pool.query<{ id: string; name: string; stock: number }>(
    `SELECT id, name, stock FROM products WHERE available = 1 ORDER BY name ASC`
  )
  if (!products.length) return []

  const productIds = products.map(p => p.id)

  const { rows: sales7 } = await pool.query<{ productId: string; total: string }>(
    `SELECT product_id as "productId", SUM(-quantity_change) as total
     FROM stock_movements
     WHERE type = 'sale' AND created_at >= now() - interval '7 days' AND product_id = ANY($1::text[])
     GROUP BY product_id`,
    [productIds]
  )
  const { rows: sales30 } = await pool.query<{ productId: string; total: string }>(
    `SELECT product_id as "productId", SUM(-quantity_change) as total
     FROM stock_movements
     WHERE type = 'sale' AND created_at >= now() - interval '30 days' AND product_id = ANY($1::text[])
     GROUP BY product_id`,
    [productIds]
  )
  const sales7Map = new Map(sales7.map(r => [r.productId, Number(r.total)]))
  const sales30Map = new Map(sales30.map(r => [r.productId, Number(r.total)]))

  const sellableMap = await getSellableStockMap(pool, productIds)

  const { rows: incoming } = await pool.query<{ productId: string; incoming: string }>(
    `SELECT poi.product_id as "productId", SUM(poi.ordered_qty - poi.received_qty) as incoming
     FROM purchase_order_items poi
     JOIN purchase_orders po ON po.id = poi.purchase_order_id
     WHERE po.status IN ('submitted', 'partially_received') AND poi.product_id = ANY($1::text[])
     GROUP BY poi.product_id`,
    [productIds]
  )
  const incomingMap = new Map(incoming.map(r => [r.productId, Number(r.incoming)]))

  const { rows: lastCosts } = await pool.query<{ productId: string; unitCost: number }>(
    `SELECT DISTINCT ON (product_id) product_id as "productId", unit_cost as "unitCost"
     FROM product_cost_history
     WHERE source_type = 'purchase_receipt' AND product_id = ANY($1::text[])
     ORDER BY product_id, recorded_at DESC`,
    [productIds]
  )
  const lastCostMap = new Map(lastCosts.map(r => [r.productId, r.unitCost]))

  const { rows: preferredSuppliers } = await pool.query<{
    productId: string; supplierId: string; supplierName: string; leadTimeDays: number | null; minimumOrderQty: number | null
  }>(
    `SELECT sp.product_id as "productId", sp.supplier_id as "supplierId", s.name as "supplierName",
            sp.lead_time_days as "leadTimeDays", sp.minimum_order_qty as "minimumOrderQty"
     FROM supplier_products sp
     JOIN suppliers s ON s.id = sp.supplier_id
     WHERE sp.preferred = 1 AND sp.product_id = ANY($1::text[])`,
    [productIds]
  )
  const preferredMap = new Map(preferredSuppliers.map(r => [r.productId, r]))

  return products.map(p => {
    const totalSold7 = sales7Map.get(p.id) ?? 0
    const totalSold30 = sales30Map.get(p.id) ?? 0
    const avgDailySales7d = Math.round((totalSold7 / 7) * 100) / 100
    const avgDailySales30d = Math.round((totalSold30 / 30) * 100) / 100
    const currentStock = sellableMap.get(p.id) ?? p.stock
    const preferred = preferredMap.get(p.id)
    const incomingQty = incomingMap.get(p.id) ?? 0

    const daysOfCover = avgDailySales7d > 0 ? Math.round((currentStock / avgDailySales7d) * 10) / 10 : null

    const targetStock = avgDailySales7d * targetDays
    let suggestedReorderQty = Math.max(Math.ceil(targetStock - currentStock - incomingQty), 0)
    if (suggestedReorderQty > 0 && preferred?.minimumOrderQty && suggestedReorderQty < preferred.minimumOrderQty) {
      suggestedReorderQty = preferred.minimumOrderQty
    }

    return {
      productId: p.id,
      productName: p.name,
      currentStock,
      avgDailySales7d,
      avgDailySales30d,
      daysOfCover,
      incomingQty,
      lastReceivedCost: lastCostMap.get(p.id) ?? null,
      preferredSupplierId: preferred?.supplierId ?? null,
      preferredSupplierName: preferred?.supplierName ?? null,
      leadTimeDays: preferred?.leadTimeDays ?? null,
      minimumOrderQty: preferred?.minimumOrderQty ?? null,
      suggestedReorderQty
    }
  })
}
