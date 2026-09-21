import { pool } from '../db.js'
import { getExpiryDashboard } from './inventoryBatchService.js'

export type AlertSeverity = 'info' | 'warning' | 'critical'

export interface Alert {
  category: string
  label: string
  count: number
  severity: AlertSeverity
  link: string
}

// طلب "عالق" — لسه في حالة غير نهائية (مش تم التسليم ولا اتلغى) بعد أكتر من ٦ ساعات من
// إنشائه. الرقم ده ثابت بسيط (مش إعداد قابل للتعديل) بما إنه سياق توصيل يومي (سوبر ماركت)،
// مش نظام شحن طويل المدى — أي طلب فاضل بدون حركة بعد نص يوم يستاهل انتباه فعلي.
const STUCK_ORDER_HOURS = 6

// كل التنبيهات هنا محسوبة حيّة من الجداول الفعلية وقت الطلب — مفيش جدول تنبيهات منفصل ولا
// حالة "مقروء/غير مقروء" بتتخزن، لأن كل تنبيه هنا بيعبّر عن حالة حقيقية قائمة دلوقتي (عدد
// منتجات منخفضة المخزون الآن، طلبات عالقة الآن...) مش حدث تاريخي يحتاج تتبع/أرشفة.
// نافذة "حديثاً" لرسائل واتساب الفاشلة — آخر ٢٤ ساعة بس، عشان فشل قديم اتعالج أو بقى معروف
// مش يفضل ظاهر كتنبيه نشط للأبد.
const WHATSAPP_FAILURE_WINDOW_HOURS = 24

export async function getAlerts(): Promise<Alert[]> {
  const [
    outOfStockRows,
    lowStockRows,
    expiryDashboard,
    stuckOrdersRows,
    pendingCustomerReturnsRows,
    pendingSupplierReturnsRows,
    unsettledRiderRows,
    pendingPurchaseOrdersRows,
    whatsappFailedRows,
    openSupportTicketsRows
  ] = await Promise.all([
    pool.query<{ n: string }>(`SELECT COUNT(*) as n FROM products WHERE available = 1 AND stock <= 0`),
    pool.query<{ n: string }>(`SELECT COUNT(*) as n FROM products WHERE available = 1 AND stock > 0 AND stock <= alert_threshold`),
    getExpiryDashboard(),
    pool.query<{ n: string }>(
      `SELECT COUNT(*) as n FROM orders WHERE status NOT IN ('delivered', 'cancelled') AND created_at < now() - interval '${STUCK_ORDER_HOURS} hours'`
    ),
    pool.query<{ n: string }>(`SELECT COUNT(*) as n FROM customer_returns WHERE status = 'requested'`),
    pool.query<{ n: string }>(`SELECT COUNT(*) as n FROM supplier_returns WHERE status IN ('draft', 'approved')`),
    pool.query<{ riderCount: string; amount: string }>(
      `SELECT COUNT(DISTINCT rider_id) as "riderCount", COALESCE(SUM(total), 0) as amount
       FROM orders WHERE status = 'delivered' AND settlement_id IS NULL AND rider_id IS NOT NULL`
    ),
    pool.query<{ n: string }>(`SELECT COUNT(*) as n FROM purchase_orders WHERE status IN ('submitted', 'partially_received')`),
    pool.query<{ n: string }>(
      `SELECT COUNT(*) as n FROM whatsapp_messages WHERE status = 'failed' AND created_at > now() - interval '${WHATSAPP_FAILURE_WINDOW_HOURS} hours'`
    ),
    pool.query<{ n: string }>(`SELECT COUNT(*) as n FROM support_tickets WHERE status IN ('open', 'in_progress', 'waiting_customer')`)
  ])

  const alerts: Alert[] = []

  const outOfStockCount = Number(outOfStockRows.rows[0].n)
  if (outOfStockCount > 0) {
    alerts.push({ category: 'out_of_stock', label: 'منتجات نفدت تماماً', count: outOfStockCount, severity: 'critical', link: '/products/inv' })
  }

  const lowStockCount = Number(lowStockRows.rows[0].n)
  if (lowStockCount > 0) {
    alerts.push({ category: 'low_stock', label: 'منتجات منخفضة المخزون', count: lowStockCount, severity: 'warning', link: '/products/inv' })
  }

  const expiredCount = expiryDashboard.expired.length
  if (expiredCount > 0) {
    alerts.push({ category: 'expired_batches', label: 'دفعات منتهية الصلاحية لسه في المخزون', count: expiredCount, severity: 'critical', link: '/products/expiry' })
  }
  const expiringSoonCount = expiryDashboard.within7Days.length
  if (expiringSoonCount > 0) {
    alerts.push({ category: 'expiring_soon', label: 'دفعات هتنتهي خلال ٧ أيام', count: expiringSoonCount, severity: 'warning', link: '/products/expiry' })
  }

  const stuckOrdersCount = Number(stuckOrdersRows.rows[0].n)
  if (stuckOrdersCount > 0) {
    alerts.push({ category: 'stuck_orders', label: `طلبات عالقة أكتر من ${STUCK_ORDER_HOURS} ساعات`, count: stuckOrdersCount, severity: 'critical', link: '/orders/all' })
  }

  const pendingCustomerReturnsCount = Number(pendingCustomerReturnsRows.rows[0].n)
  if (pendingCustomerReturnsCount > 0) {
    alerts.push({ category: 'pending_customer_returns', label: 'مرتجعات عملاء بانتظار المراجعة', count: pendingCustomerReturnsCount, severity: 'info', link: '/orders/returns' })
  }

  const pendingSupplierReturnsCount = Number(pendingSupplierReturnsRows.rows[0].n)
  if (pendingSupplierReturnsCount > 0) {
    alerts.push({ category: 'pending_supplier_returns', label: 'مرتجعات موردين لسه معلّقة', count: pendingSupplierReturnsCount, severity: 'info', link: '/purchasing/supplier-returns' })
  }

  const unsettledRiderCount = Number(unsettledRiderRows.rows[0].riderCount)
  if (unsettledRiderCount > 0) {
    alerts.push({ category: 'unsettled_rider_cash', label: `مناديب عندهم كاش غير مُسوّى`, count: unsettledRiderCount, severity: 'warning', link: '/wallet/settle' })
  }

  const pendingPurchaseOrdersCount = Number(pendingPurchaseOrdersRows.rows[0].n)
  if (pendingPurchaseOrdersCount > 0) {
    alerts.push({ category: 'pending_purchase_orders', label: 'أوامر شراء بانتظار الاستلام', count: pendingPurchaseOrdersCount, severity: 'info', link: '/purchasing/orders' })
  }

  const whatsappFailedCount = Number(whatsappFailedRows.rows[0].n)
  if (whatsappFailedCount > 0) {
    alerts.push({ category: 'whatsapp_failed', label: 'رسائل واتساب فشل إرسالها', count: whatsappFailedCount, severity: 'warning', link: '/settings/integrations' })
  }

  const openSupportTicketsCount = Number(openSupportTicketsRows.rows[0].n)
  if (openSupportTicketsCount > 0) {
    alerts.push({ category: 'open_support_tickets', label: 'تذاكر دعم مفتوحة', count: openSupportTicketsCount, severity: 'info', link: '/support/tickets' })
  }

  return alerts
}
