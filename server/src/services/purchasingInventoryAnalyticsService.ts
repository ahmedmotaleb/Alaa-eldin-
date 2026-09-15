import { pool } from '../db.js'
import { getSellableStockMap } from './inventoryBatchService.js'

export interface AnalyticsFilters {
  fromDate: string
  toDate: string
  supplierId?: string
  categoryId?: string
  limit: number
}

const SLOW_STOCK_DAYS_OF_COVER_THRESHOLD = 60

export interface ProductMovementRow {
  productId: string
  name: string
  categoryId: string
  sellableStock: number
  unitsSoldInPeriod: number
  avgDailySales: number
  daysOfCover: number | null
  marginPercent: number | null
}

export interface StockoutRow {
  productId: string
  name: string
  incidentCount: number
}

export interface SupplierMetricsRow {
  supplierId: string
  supplierName: string
  purchaseValue: number
  fillRatePercent: number | null
  avgLeadTimeDays: number | null
}

export interface PriceChangeRow {
  productId: string
  name: string
  oldestCost: number
  newestCost: number
  percentChange: number
}

export interface CategoryMarginRow {
  categoryId: string
  categoryName: string
  revenue: number
  approxCogs: number
  marginPercent: number | null
}

export interface PurchasingInventoryAnalytics {
  periodDays: number
  turnover: {
    // COGS_period هنا مقدّرة بتكلفة المنتج الحالية (products.cost) مضروبة في الكمية المباعة —
    // مش تكلفة تاريخية حقيقية وقت البيع (النظام مبيسجّلش تكلفة كل عملية بيع لحظة حدوثها)،
    // وقيمة المخزون المتوسطة هنا هي القيمة الحالية لحظة الاستعلام (مفيش سجل تاريخي يومي
    // للمخزون نقدر نحسب منه متوسط حقيقي عبر الفترة) — كلاهما تقدير موثّق، مش رقم محاسبي دقيق.
    costOfGoodsSoldEstimate: number
    currentInventoryCostValue: number
    turnoverRatio: number | null
  }
  daysOfCoverAverage: number | null
  deadStock: ProductMovementRow[]
  slowStock: ProductMovementRow[]
  fastStock: ProductMovementRow[]
  stockouts: { totalIncidents: number, byProduct: StockoutRow[] }
  expiry: { expiredValue: number, nearExpiryValue: number }
  suppliers: SupplierMetricsRow[]
  priceChanges: PriceChangeRow[]
  marginByProduct: ProductMovementRow[]
  marginByCategory: CategoryMarginRow[]
  lostSales: {
    // مؤشر (indicator) مبني على أصناف اتحددت "غير متوفرة" فعلياً وقت التجهيز (order_items.picked_status
    // = 'unavailable') — بيانات حقيقية مسجّلة، لكنه تقدير لقيمة مبيعات محتملة ضاعت، مش عدد
    // مبيعات ضايعة مؤكد (العميل ممكن يكون استبدل الصنف برضا أو الطلب اتوصّل بدونه من غير أثر مالي).
    incidentCount: number
    estimatedValue: number
  }
}

export async function getPurchasingInventoryAnalytics(filters: AnalyticsFilters): Promise<PurchasingInventoryAnalytics> {
  const { fromDate, toDate, supplierId, categoryId, limit } = filters
  const periodDays = Math.max(1, Math.round((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000))

  // "من تاريخ" و"إلى تاريخ" هنا نصوص تقويمية صريحة (YYYY-MM-DD) بمعنى يوم عمل بتوقيت القاهرة
  // (زي مواعيد التوصيل بالظبط) — تحويلها لحدود TIMESTAMPTZ فعلية لازم يحصل عبر AT TIME ZONE
  // في بوستجرس نفسه (بتاعدة بيانات المناطق الزمنية الحقيقية بتاعته)، مش بحساب يدوي في Node،
  // عشان نتجنب أي خلط بين حدود اليوم بتوقيت UTC وحدوده الفعلية بتوقيت القاهرة.
  const { rows: boundsRows } = await pool.query<{ from: string; to: string }>(
    `SELECT ($1::date AT TIME ZONE 'Africa/Cairo') as from, (($2::date + 1) AT TIME ZONE 'Africa/Cairo') as to`,
    [fromDate, toDate]
  )
  const fromTimestamp = boundsRows[0].from
  const toTimestamp = boundsRows[0].to

  // ترقيم الـ placeholders هنا لازم يتحسب ديناميكياً حسب الفلاتر الفعلية المُمررة — لو
  // اعتمدنا على أرقام ثابتة ($3/$4) هتتكسر في حالة فلتر واحد بس (مثلاً مورد من غير قسم).
  const params: unknown[] = [fromTimestamp, toTimestamp]
  let categoryParamIdx: number | null = null
  let supplierParamIdx: number | null = null
  if (categoryId) { params.push(categoryId); categoryParamIdx = params.length }
  if (supplierId) { params.push(supplierId); supplierParamIdx = params.length }
  const categoryClause = categoryParamIdx ? `AND p.category_id = $${categoryParamIdx}` : ''
  const supplierClause = supplierParamIdx
    ? `AND EXISTS (SELECT 1 FROM supplier_products sp WHERE sp.product_id = p.id AND sp.supplier_id = $${supplierParamIdx})`
    : ''

  // حركة كل منتج خلال الفترة (كمية مباعة + إيراد) — استعلام واحد يغطي كل الكتالوج بدل ما نلف
  // على كل منتج لوحده (N+1).
  const { rows: movement } = await pool.query<{
    productId: string; name: string; categoryId: string; stock: number; cost: number; price: number
    unitsSold: string; revenue: string
  }>(
    `SELECT p.id as "productId", p.name, p.category_id as "categoryId", p.stock, p.cost, p.price,
            COALESCE(sales.qty, 0) as "unitsSold", COALESCE(sales.revenue, 0) as revenue
     FROM products p
     LEFT JOIN (
       SELECT oi.product_id, SUM(oi.quantity) as qty, SUM(oi.line_total) as revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.status != 'cancelled' AND o.created_at >= $1 AND o.created_at < $2
       GROUP BY oi.product_id
     ) sales ON sales.product_id = p.id
     WHERE 1=1 ${categoryClause} ${supplierClause}`,
    params
  )

  const sellableMap = await getSellableStockMap(pool, movement.map(m => m.productId))

  const rows: ProductMovementRow[] = movement.map(m => {
    const sellable = sellableMap.get(m.productId) ?? m.stock
    const unitsSold = Number(m.unitsSold)
    const avgDailySales = Math.round((unitsSold / periodDays) * 100) / 100
    const daysOfCover = avgDailySales > 0 ? Math.round((sellable / avgDailySales) * 10) / 10 : null
    const marginPercent = m.price > 0 ? Math.round(((m.price - m.cost) / m.price) * 10000) / 100 : null
    return {
      productId: m.productId,
      name: m.name,
      categoryId: m.categoryId,
      sellableStock: sellable,
      unitsSoldInPeriod: unitsSold,
      avgDailySales,
      daysOfCover,
      marginPercent
    }
  })

  const deadStock = rows
    .filter(r => r.unitsSoldInPeriod === 0 && r.sellableStock > 0)
    .sort((a, b) => b.sellableStock - a.sellableStock)
    .slice(0, limit)

  const slowMovers = rows.filter(r => r.unitsSoldInPeriod > 0 && r.daysOfCover !== null && r.daysOfCover > SLOW_STOCK_DAYS_OF_COVER_THRESHOLD)
  const slowStock = slowMovers.sort((a, b) => (b.daysOfCover ?? 0) - (a.daysOfCover ?? 0)).slice(0, limit)

  const fastStock = rows
    .filter(r => r.unitsSoldInPeriod > 0)
    .sort((a, b) => b.avgDailySales - a.avgDailySales)
    .slice(0, limit)

  const withSales = rows.filter(r => r.avgDailySales > 0 && r.daysOfCover !== null)
  const daysOfCoverAverage = withSales.length
    ? Math.round((withSales.reduce((sum, r) => sum + (r.daysOfCover ?? 0), 0) / withSales.length) * 10) / 10
    : null

  const marginByProduct = rows
    .filter(r => r.marginPercent !== null)
    .sort((a, b) => (a.marginPercent ?? 0) - (b.marginPercent ?? 0))
    .slice(0, limit)

  // هامش الربح لكل قسم — الإيراد حقيقي (من order_items الفعلية)، لكن تكلفة البضاعة المباعة
  // هنا مقدّرة بتكلفة المنتج الحالية (زي حساب الـ turnover بالظبط)، مش تكلفة تاريخية وقت البيع.
  const revenueByCategory = new Map<string, { categoryId: string; revenue: number; cogs: number }>()
  for (const r of rows) {
    const current = revenueByCategory.get(r.categoryId) ?? { categoryId: r.categoryId, revenue: 0, cogs: 0 }
    const productRow = movement.find(m => m.productId === r.productId)!
    current.revenue += Number(productRow.revenue)
    current.cogs += r.unitsSoldInPeriod * productRow.cost
    revenueByCategory.set(r.categoryId, current)
  }
  const { rows: categoryNames } = await pool.query<{ id: string; name: string }>('SELECT id, name FROM categories')
  const categoryNameMap = new Map(categoryNames.map(c => [c.id, c.name]))
  const marginByCategory: CategoryMarginRow[] = Array.from(revenueByCategory.values())
    .map(c => ({
      categoryId: c.categoryId,
      categoryName: categoryNameMap.get(c.categoryId) ?? c.categoryId,
      revenue: Math.round(c.revenue * 100) / 100,
      approxCogs: Math.round(c.cogs * 100) / 100,
      marginPercent: c.revenue > 0 ? Math.round(((c.revenue - c.cogs) / c.revenue) * 10000) / 100 : null
    }))
    .sort((a, b) => b.revenue - a.revenue)

  // تواتر نقص التوفر — عدد مرات فعلية اتحدد فيها صنف "غير متوفر" وقت التجهيز، من بيانات حقيقية
  // (order_items.picked_status)، مش تخمين.
  const { rows: stockoutRows } = await pool.query<{ productId: string; name: string; incidentCount: string }>(
    `SELECT oi.product_id as "productId", p.name, COUNT(*) as "incidentCount"
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     WHERE oi.picked_status = 'unavailable' AND o.created_at >= $1 AND o.created_at < $2
       ${categoryClause} ${supplierClause}
     GROUP BY oi.product_id, p.name
     ORDER BY COUNT(*) DESC
     LIMIT $${params.length + 1}`,
    [...params, limit]
  )
  const totalIncidents = stockoutRows.reduce((sum, r) => sum + Number(r.incidentCount), 0)

  // مؤشر مبيعات ضائعة — نفس مصدر البيانات (unavailable)، بس القيمة المالية بدل العدد.
  const { rows: lostSalesRows } = await pool.query<{ incidentCount: string; estimatedValue: string | null }>(
    `SELECT COUNT(*) as "incidentCount", SUM(oi.quantity * oi.unit_price) as "estimatedValue"
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     WHERE oi.picked_status = 'unavailable' AND o.created_at >= $1 AND o.created_at < $2
       ${categoryClause} ${supplierClause}`,
    params
  )

  // مش مقيّدة بالفترة عمداً (قيمة منتهية/قريبة الانتهاء "دلوقتي")، فبتاخد باراميترات مستقلة
  // تماماً بترقيم يبدأ من $1 (بدل ما تشارك fromTimestamp/toTimestamp غير المستخدمين هنا —
  // بوستجرس بيرفض أي استعلام فيه $3 من غير ما يبقى $1/$2 متسخدمين في نفس النص).
  const expiryParams: unknown[] = []
  let expiryCategoryIdx: number | null = null
  let expirySupplierIdx: number | null = null
  if (categoryId) { expiryParams.push(categoryId); expiryCategoryIdx = expiryParams.length }
  if (supplierId) { expiryParams.push(supplierId); expirySupplierIdx = expiryParams.length }
  const expiryCategoryClause = expiryCategoryIdx ? `AND p.category_id = $${expiryCategoryIdx}` : ''
  const expirySupplierClause = expirySupplierIdx ? `AND ib.supplier_id = $${expirySupplierIdx}` : ''

  const { rows: expiredRows } = await pool.query<{ value: string | null }>(
    `SELECT SUM(ib.quantity_remaining * ib.unit_cost) as value
     FROM inventory_batches ib
     JOIN products p ON p.id = ib.product_id
     WHERE ib.quantity_remaining > 0 AND ib.expiry_date IS NOT NULL AND ib.expiry_date < CURRENT_DATE
       ${expiryCategoryClause} ${expirySupplierClause}`,
    expiryParams
  )
  const { rows: nearExpiryRows } = await pool.query<{ value: string | null }>(
    `SELECT SUM(ib.quantity_remaining * ib.unit_cost) as value
     FROM inventory_batches ib
     JOIN products p ON p.id = ib.product_id
     WHERE ib.quantity_remaining > 0 AND ib.expiry_date IS NOT NULL
       AND ib.expiry_date >= CURRENT_DATE AND ib.expiry_date <= CURRENT_DATE + 30
       ${expiryCategoryClause} ${expirySupplierClause}`,
    expiryParams
  )

  // مقاييس الموردين: قيمة الشراء (كل أوامر الشراء المُنشأة في الفترة)، معدّل التنفيذ (الكمية
  // المُستلمة فعلياً / المطلوبة عبر كل بنود أوامر الشراء)، ومتوسط مهلة التوريد (من إنشاء أمر
  // الشراء لحد أول استلام فعلي له) — بيانات حقيقية بالكامل من purchase_orders/goods_receipts.
  const supplierParams: unknown[] = [fromTimestamp, toTimestamp]
  const supplierWhere = supplierId ? 'AND po.supplier_id = $3' : ''
  if (supplierId) supplierParams.push(supplierId)
  const { rows: suppliers } = await pool.query<{
    supplierId: string; supplierName: string; purchaseValue: string; orderedQty: string | null; receivedQty: string | null; avgLeadTimeDays: string | null
  }>(
    `SELECT s.id as "supplierId", s.name as "supplierName",
            COALESCE(SUM(po.total), 0) as "purchaseValue",
            SUM(poi.ordered_qty) as "orderedQty",
            SUM(poi.received_qty) as "receivedQty",
            AVG(EXTRACT(EPOCH FROM (first_receipt.received_at - po.created_at)) / 86400.0) as "avgLeadTimeDays"
     FROM suppliers s
     JOIN purchase_orders po ON po.supplier_id = s.id AND po.created_at >= $1 AND po.created_at < $2 ${supplierWhere}
     LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
     LEFT JOIN LATERAL (
       SELECT MIN(gr.received_at) as received_at FROM goods_receipts gr WHERE gr.purchase_order_id = po.id
     ) first_receipt ON true
     GROUP BY s.id, s.name
     ORDER BY "purchaseValue" DESC
     LIMIT $${supplierParams.length + 1}`,
    [...supplierParams, limit]
  )

  // تغيّر التكلفة عبر الوقت — من سجل تاريخ التكلفة الفعلي (product_cost_history)، مقارنة أقدم
  // وأحدث تكلفة مسجّلة داخل الفترة نفسها فقط (منتج له تسجيلة واحدة بس في الفترة مالوش "تغيّر" نقيسه).
  const priceParams: unknown[] = [fromTimestamp, toTimestamp]
  if (categoryId) priceParams.push(categoryId)
  const { rows: priceChangeRows } = await pool.query<{ productId: string; name: string; oldestCost: number; newestCost: number }>(
    `SELECT pch.product_id as "productId", p.name,
            (array_agg(pch.unit_cost ORDER BY pch.recorded_at ASC))[1] as "oldestCost",
            (array_agg(pch.unit_cost ORDER BY pch.recorded_at DESC))[1] as "newestCost"
     FROM product_cost_history pch
     JOIN products p ON p.id = pch.product_id
     WHERE pch.recorded_at >= $1 AND pch.recorded_at < $2 ${categoryId ? 'AND p.category_id = $3' : ''}
     GROUP BY pch.product_id, p.name
     HAVING COUNT(*) >= 2`,
    priceParams
  )
  const priceChanges: PriceChangeRow[] = priceChangeRows
    .map(r => ({
      productId: r.productId,
      name: r.name,
      oldestCost: r.oldestCost,
      newestCost: r.newestCost,
      percentChange: r.oldestCost > 0 ? Math.round(((r.newestCost - r.oldestCost) / r.oldestCost) * 10000) / 100 : 0
    }))
    .sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange))
    .slice(0, limit)

  const costOfGoodsSoldEstimate = Math.round(rows.reduce((sum, r) => {
    const productRow = movement.find(m => m.productId === r.productId)!
    return sum + r.unitsSoldInPeriod * productRow.cost
  }, 0) * 100) / 100
  const currentInventoryCostValue = Math.round(rows.reduce((sum, r) => {
    const productRow = movement.find(m => m.productId === r.productId)!
    return sum + r.sellableStock * productRow.cost
  }, 0) * 100) / 100

  return {
    periodDays,
    turnover: {
      costOfGoodsSoldEstimate,
      currentInventoryCostValue,
      turnoverRatio: currentInventoryCostValue > 0 ? Math.round((costOfGoodsSoldEstimate / currentInventoryCostValue) * 100) / 100 : null
    },
    daysOfCoverAverage,
    deadStock,
    slowStock,
    fastStock,
    stockouts: {
      totalIncidents,
      byProduct: stockoutRows.map(r => ({ productId: r.productId, name: r.name, incidentCount: Number(r.incidentCount) }))
    },
    expiry: {
      expiredValue: Math.round(Number(expiredRows[0].value ?? 0) * 100) / 100,
      nearExpiryValue: Math.round(Number(nearExpiryRows[0].value ?? 0) * 100) / 100
    },
    suppliers: suppliers.map(s => ({
      supplierId: s.supplierId,
      supplierName: s.supplierName,
      purchaseValue: Math.round(Number(s.purchaseValue) * 100) / 100,
      fillRatePercent: s.orderedQty && Number(s.orderedQty) > 0
        ? Math.round((Number(s.receivedQty ?? 0) / Number(s.orderedQty)) * 10000) / 100
        : null,
      avgLeadTimeDays: s.avgLeadTimeDays !== null ? Math.round(Number(s.avgLeadTimeDays) * 10) / 10 : null
    })),
    priceChanges,
    marginByProduct,
    marginByCategory,
    lostSales: {
      incidentCount: Number(lostSalesRows[0].incidentCount ?? 0),
      estimatedValue: Math.round(Number(lostSalesRows[0].estimatedValue ?? 0) * 100) / 100
    }
  }
}
