import { pool } from '../db.js'

export interface RevenueDay {
  date: string
  revenue: number
  orderCount: number
}

export interface CategoryRevenue {
  categoryId: string
  categoryName: string
  revenue: number
}

export interface ProductRevenue {
  productId: string
  name: string
  qty: number
  revenue: number
}

export interface SlotRevenue {
  slot: string
  count: number
  revenue: number
}

export interface RegionRevenue {
  governorate: string
  count: number
  revenue: number
}

export interface StatusCount {
  status: string
  count: number
}

// الطلبات الملغاة لا تُحسب كإيراد فعلي في أي حساب هنا (إيراد يومي/منتج/قسم/محافظة/موعد) —
// نفس القاعدة المستخدمة أصلاً في adminCustomers.ts وfrequentlyPurchasedService.ts. بتفضل
// محسوبة ضمن "عدد الطلبات الكلي" وتفصيل الحالات بس (getOrdersBreakdown).

export async function getRevenueByDay(days: number): Promise<RevenueDay[]> {
  const { rows } = await pool.query<{ date: string, revenue: number, orderCount: number }>(
    `SELECT to_char(d.day, 'YYYY-MM-DD') as date,
            COALESCE(SUM(o.total), 0)::float as revenue,
            COUNT(o.id)::int as "orderCount"
     FROM generate_series((CURRENT_DATE - ($1::int - 1)), CURRENT_DATE, interval '1 day') AS d(day)
     LEFT JOIN orders o ON date_trunc('day', o.created_at) = d.day AND o.status != 'cancelled'
     GROUP BY d.day
     ORDER BY d.day`,
    [days]
  )
  return rows
}

export async function getOverviewStats(): Promise<{ totalRevenue: number, totalOrders: number, avgOrderValue: number }> {
  const { rows } = await pool.query<{ totalRevenue: number, revenueOrderCount: number, totalOrders: number }>(
    `SELECT
       COALESCE(SUM(total) FILTER (WHERE status != 'cancelled'), 0)::float as "totalRevenue",
       COUNT(*) FILTER (WHERE status != 'cancelled')::int as "revenueOrderCount",
       COUNT(*)::int as "totalOrders"
     FROM orders`
  )
  const row = rows[0]
  return {
    totalRevenue: row.totalRevenue,
    totalOrders: row.totalOrders,
    avgOrderValue: row.revenueOrderCount ? row.totalRevenue / row.revenueOrderCount : 0
  }
}

export async function getSalesStats(): Promise<{ totalRevenue: number, avgOrderValue: number, maxOrderValue: number }> {
  const { rows } = await pool.query<{ totalRevenue: number, orderCount: number, maxOrderValue: number }>(
    `SELECT COALESCE(SUM(total), 0)::float as "totalRevenue",
            COUNT(*)::int as "orderCount",
            COALESCE(MAX(total), 0)::float as "maxOrderValue"
     FROM orders WHERE status != 'cancelled'`
  )
  const row = rows[0]
  return {
    totalRevenue: row.totalRevenue,
    avgOrderValue: row.orderCount ? row.totalRevenue / row.orderCount : 0,
    maxOrderValue: row.maxOrderValue
  }
}

export async function getRevenueByCategory(): Promise<CategoryRevenue[]> {
  const { rows } = await pool.query<CategoryRevenue>(
    `SELECT c.id as "categoryId", c.name as "categoryName",
            COALESCE(SUM(rev.line_total), 0)::float as revenue
     FROM categories c
     LEFT JOIN products p ON p.category_id = c.id
     LEFT JOIN (
       SELECT oi.product_id, oi.line_total
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.status != 'cancelled'
     ) rev ON rev.product_id = p.id
     GROUP BY c.id, c.name
     ORDER BY revenue DESC`
  )
  return rows
}

// بيستخدم اسم المنتج المخزّن في order_items نفسه (مش join على جدول المنتجات الحالي) — عشان
// منتج اتحذف أو اتغيّر اسمه لسه يظهر صح في التقرير التاريخي (نفس فلسفة "لقطة وقت الطلب"
// المستخدمة في order_items.name أصلاً). بياخد آخر اسم اتسجل بيه (أحدث طلب) لو الاسم اتغيّر.
export async function getTopProducts(): Promise<ProductRevenue[]> {
  const { rows } = await pool.query<ProductRevenue>(
    `SELECT oi.product_id as "productId",
            (array_agg(oi.name ORDER BY o.created_at DESC))[1] as name,
            SUM(oi.quantity)::int as qty,
            SUM(oi.line_total)::float as revenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.status != 'cancelled'
     GROUP BY oi.product_id
     ORDER BY revenue DESC`
  )
  return rows
}

export async function getRevenueBySlot(): Promise<SlotRevenue[]> {
  const { rows } = await pool.query<SlotRevenue>(
    `SELECT delivery_slot as slot, COUNT(*)::int as count, SUM(total)::float as revenue
     FROM orders
     WHERE status != 'cancelled'
     GROUP BY delivery_slot
     ORDER BY revenue DESC`
  )
  return rows
}

export async function getProductStats(): Promise<{ soldProductCount: number, totalProductCount: number }> {
  const [{ rows: soldRows }, { rows: totalRows }] = await Promise.all([
    pool.query<{ n: number }>(
      `SELECT COUNT(DISTINCT oi.product_id)::int as n
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.status != 'cancelled'`
    ),
    pool.query<{ n: number }>('SELECT COUNT(*)::int as n FROM products')
  ])
  return { soldProductCount: soldRows[0].n, totalProductCount: totalRows[0].n }
}

export async function getRegionRevenue(): Promise<RegionRevenue[]> {
  const { rows } = await pool.query<RegionRevenue>(
    `SELECT COALESCE(NULLIF(TRIM(customer_governorate), ''), 'غير محدد') as governorate,
            COUNT(*)::int as count, SUM(total)::float as revenue
     FROM orders
     WHERE status != 'cancelled'
     GROUP BY 1
     ORDER BY revenue DESC`
  )
  return rows
}

// عدد الطلبات وتفصيل الحالات هنا بيشمل الطلبات الملغاة (عكس باقي الدوال) — التبويب ده أصلاً
// معروض عشان يوضّح نسبة الإلغاء نفسها، فلازم يحسبها ضمن الإجمالي مش يستبعدها.
export async function getOrdersBreakdown(): Promise<{
  totalOrders: number
  cancelledCount: number
  avgItemsPerOrder: number
  statusCounts: StatusCount[]
}> {
  const [{ rows: totalsRows }, { rows: statusRows }, { rows: itemsRows }] = await Promise.all([
    pool.query<{ totalOrders: number, cancelledCount: number }>(
      `SELECT COUNT(*)::int as "totalOrders", COUNT(*) FILTER (WHERE status = 'cancelled')::int as "cancelledCount" FROM orders`
    ),
    pool.query<StatusCount>('SELECT status, COUNT(*)::int as count FROM orders GROUP BY status'),
    pool.query<{ n: number }>('SELECT COALESCE(SUM(quantity), 0)::int as n FROM order_items')
  ])
  const totalOrders = totalsRows[0].totalOrders
  return {
    totalOrders,
    cancelledCount: totalsRows[0].cancelledCount,
    avgItemsPerOrder: totalOrders ? itemsRows[0].n / totalOrders : 0,
    statusCounts: statusRows
  }
}

export async function getHomeSummary(): Promise<{
  todayRevenue: number
  todayOrderCount: number
  totalOrders: number
  newOrdersCount: number
}> {
  const { rows } = await pool.query<{ todayRevenue: number, todayOrderCount: number, totalOrders: number, newOrdersCount: number }>(
    `SELECT
       COALESCE(SUM(total) FILTER (
         WHERE status != 'cancelled' AND created_at >= date_trunc('day', now()) AND created_at < date_trunc('day', now()) + interval '1 day'
       ), 0)::float as "todayRevenue",
       COUNT(*) FILTER (
         WHERE status != 'cancelled' AND created_at >= date_trunc('day', now()) AND created_at < date_trunc('day', now()) + interval '1 day'
       )::int as "todayOrderCount",
       COUNT(*)::int as "totalOrders",
       COUNT(*) FILTER (WHERE status = 'placed')::int as "newOrdersCount"
     FROM orders`
  )
  return rows[0]
}
