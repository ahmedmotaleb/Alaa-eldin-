// إشعارات فورية حقيقية عبر Web Push API القياسي في المتصفح — مش مرتبط بأي مزوّد خارجي
// محتاج حساب/توكن (زي Firebase)، بيعتمد على زوج مفاتيح VAPID مملوك للسيرفر نفسه. أي متصفح
// حديث (Chrome/Edge/Firefox، وSafari الحديثة) بيدعمه كـ Push API + Service Worker قياسي.
import crypto from 'node:crypto'
import webpush from 'web-push'
import { pool } from '../db.js'
import { userHasPermission } from './permissionService.js'
import { logEvent } from '../logger.js'

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:support@alaa-eldin.example'

export const pushConfigured = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)

if (pushConfigured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!)
}

export function getVapidPublicKey(): string | null {
  return VAPID_PUBLIC_KEY ?? null
}

export interface PushSubscriptionInput {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export async function saveSubscription(userId: string, sub: PushSubscriptionInput): Promise<void> {
  const id = crypto.randomUUID()
  await pool.query(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $2, p256dh = $4, auth = $5`,
    [id, userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
  )
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint])
}

// عدد الاشتراكات الحالية المخزّنة — تشخيص بسيط بس (مش "الاشتراكات الفعّالة فعلاً"، لأن أي
// اشتراك بيتأكد إنه بايت (404/410) بيتحذف تلقائياً وقت أول محاولة إرسال فاشلة له فعلياً
// (راجع sendPushToUser تحت) — يعني العدد ده أقرب تقدير عملي، مش ضمان قاطع إن كل صف لسه حي.
export async function countPushSubscriptions(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>('SELECT COUNT(*) as count FROM push_subscriptions')
  return Number(rows[0].count)
}

export interface NotificationPreferences {
  orderUpdates: boolean
  promotions: boolean
}

const DEFAULT_PREFERENCES: NotificationPreferences = { orderUpdates: true, promotions: false }

export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const { rows } = await pool.query<{ orderUpdates: number; promotions: number }>(
    'SELECT order_updates as "orderUpdates", promotions FROM notification_preferences WHERE user_id = $1',
    [userId]
  )
  if (!rows[0]) return DEFAULT_PREFERENCES
  return { orderUpdates: !!rows[0].orderUpdates, promotions: !!rows[0].promotions }
}

export async function setNotificationPreferences(userId: string, prefs: NotificationPreferences): Promise<void> {
  await pool.query(
    `INSERT INTO notification_preferences (user_id, order_updates, promotions, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE SET order_updates = $2, promotions = $3, updated_at = now()`,
    [userId, prefs.orderUpdates ? 1 : 0, prefs.promotions ? 1 : 0]
  )
}

// تفضيل إداري منفصل تماماً عن تفضيلات العميل فوق (order_updates/promotions) — افتراضياً
// متوقف لأي حساب، حتى لو عنده تفضيلات عميل أخرى مفعّلة بالفعل. راجع migration 0070.
export async function getAdminNewOrdersPreference(userId: string): Promise<boolean> {
  const { rows } = await pool.query<{ adminNewOrders: number }>(
    'SELECT admin_new_orders as "adminNewOrders" FROM notification_preferences WHERE user_id = $1',
    [userId]
  )
  return !!rows[0]?.adminNewOrders
}

export async function setAdminNewOrdersPreference(userId: string, enabled: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO notification_preferences (user_id, admin_new_orders, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET admin_new_orders = $2, updated_at = now()`,
    [userId, enabled ? 1 : 0]
  )
}

interface PushSubscriptionRow { id: string; endpoint: string; p256dh: string; auth: string }

// إرسال أفضل-جهد (best effort) — فشل إرسال إشعار لجهاز واحد (اشتراك منتهي مثلاً) أبداً ما
// بيوقفش أو يفشّل العملية الأصلية (زي تحديث حالة الطلب)؛ اشتراك راجع 404/410 من متصفح
// المستخدم بيتشال تلقائياً من الجدول لأنه بقى غير صالح نهائياً.
export async function sendPushToUser(userId: string, payload: { title: string; body: string; url?: string }): Promise<void> {
  if (!pushConfigured) return

  const { rows } = await pool.query<PushSubscriptionRow>(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [userId]
  )
  if (!rows.length) return

  const body = JSON.stringify(payload)
  await Promise.all(rows.map(async row => {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        body
      )
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode
      if (statusCode === 404 || statusCode === 410) {
        await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id])
      }
    }
  }))
}

// نقطة الدمج مع تغييرات حالة الطلب — بترسل بس لو عنده تفضيل تحديثات الطلب مفعّل (افتراضياً
// مفعّل). طلبات الزوار (بدون user_id) مالهاش أي اشتراكات أصلاً، فالدالة بترجع فوراً.
export async function notifyOrderStatusChange(userId: string | null, orderNumber: string, status: string): Promise<void> {
  if (!userId) return
  const prefs = await getNotificationPreferences(userId)
  if (!prefs.orderUpdates) return

  const STATUS_MESSAGE: Record<string, string> = {
    preparing: 'جاري تجهيز طلبك',
    ready_for_delivery: 'طلبك جاهز للتوصيل',
    out_for_delivery: 'طلبك في الطريق إليك',
    delivered: 'تم توصيل طلبك بنجاح',
    cancelled: 'تم إلغاء طلبك'
  }
  const message = STATUS_MESSAGE[status]
  if (!message) return

  await sendPushToUser(userId, { title: `طلبك ${orderNumber}`, body: message, url: '/orders' })
}

// إشعار العميل برد الأدمن أو تحديث حالة تذكرة الدعم — بيحترم نفس تفضيل "تحديثات الطلب"
// (مفيش تفضيل منفصل للدعم؛ التذاكر غالباً مرتبطة بالطلبات أصلاً، وإضافة تفضيل جديد كان
// هيحتاج migration وواجهة إعدادات إضافية لمكسب محدود). أبداً ما بيبعتش لو الإرسال مش مُعدّ.
export async function notifySupportTicketUpdate(
  customerId: string, ticketNumber: string, event: 'admin_replied' | 'resolved'
): Promise<void> {
  const prefs = await getNotificationPreferences(customerId)
  if (!prefs.orderUpdates) return

  const MESSAGE: Record<typeof event, string> = {
    admin_replied: 'وصلك رد جديد على تذكرة الدعم',
    resolved: 'تم حل تذكرة الدعم بتاعتك'
  }
  await sendPushToUser(customerId, { title: `تذكرة الدعم ${ticketNumber}`, body: MESSAGE[event], url: '/account/support' })
}

// إشعار الأدمن المُسند إليه التذكرة برد جديد من العميل — بيتبعت بس لو فيه أدمن معيّن فعلاً
// (تذكرة غير مُسندة بتظهر في تنبيه لوحة التحكم "تذاكر دعم مفتوحة" بدل ما نرسل بوش لكل مدير).
export async function notifyAssignedAdminOfReply(assignedAdminId: string, ticketNumber: string): Promise<void> {
  await sendPushToUser(assignedAdminId, { title: `تذكرة الدعم ${ticketNumber}`, body: 'رد جديد من العميل', url: '/support/tickets' })
}

export interface NewOrderNotificationInput {
  id: string
  orderNumber: string
  customerFullName: string
  total: number
}

// مُستخرَجة كدالة مستقلة قابلة للاختبار بمعزل عن webpush نفسه — بترجع فعلياً مين هيستقبل
// بوش "طلب جديد" (ids) من غير ما تبعت أي حاجة، عشان اختبارات RBAC/التفضيل تقدر تتأكد من
// منطق الاستهداف الصحيح حتى في بيئة من غير مفاتيح VAPID حقيقية (راجع pushConfigured).
export async function selectAdminNewOrderRecipients(): Promise<string[]> {
  const { rows: admins } = await pool.query<{ id: string; role: string; roleId: string | null }>(
    'SELECT id, role, role_id as "roleId" FROM users WHERE is_admin = 1'
  )
  if (!admins.length) return []

  const withOrdersView = (await Promise.all(
    admins.map(async a => ({ id: a.id, allowed: await userHasPermission({ isAdmin: true, role: a.role, roleId: a.roleId }, 'orders.view') }))
  )).filter(a => a.allowed).map(a => a.id)
  if (!withOrdersView.length) return []

  const { rows: prefRows } = await pool.query<{ userId: string }>(
    'SELECT user_id as "userId" FROM notification_preferences WHERE user_id = ANY($1::text[]) AND admin_new_orders = 1',
    [withOrdersView]
  )
  return prefRows.map(r => r.userId)
}

// بوش فوري لكل أدمن/موظف عنده (1) صلاحية orders.view فعلية (RBAC دقيق أو legacy fallback،
// نفس منطق permissionService بالظبط — مش كل is_admin=1 عنده بالضرورة orders.view)، و(2)
// فعّل تفضيل "إشعارات الطلبات الجديدة" صراحة على جهازه (admin_new_orders=1). أفضل-جهد بالكامل
// (راجع sendPushToUser) — فشل إرسال لجهاز/مستخدم واحد أبداً ما بيوقفش إنشاء الطلب نفسه، لأنها
// بتتنادى دايماً بعد commit الطلب بنجاح (راجع orderService.createOrder).
export async function notifyAdminsOfNewOrder(order: NewOrderNotificationInput): Promise<void> {
  const recipients = await selectAdminNewOrderRecipients()
  logEvent('admin_new_order_push_attempted', { orderId: order.id, orderNumber: order.orderNumber, recipientCount: recipients.length })
  if (!recipients.length) return

  const payload = {
    title: 'طلب جديد 🛒',
    body: `${order.orderNumber} · ${order.customerFullName} · ${order.total.toFixed(2)} ج.م`,
    url: `/admin/orders/all?highlight=${order.id}`
  }
  await Promise.allSettled(recipients.map(userId => sendPushToUser(userId, payload)))
}
