// إشعارات فورية حقيقية عبر Web Push API القياسي في المتصفح — مش مرتبط بأي مزوّد خارجي
// محتاج حساب/توكن (زي Firebase)، بيعتمد على زوج مفاتيح VAPID مملوك للسيرفر نفسه. أي متصفح
// حديث (Chrome/Edge/Firefox، وSafari الحديثة) بيدعمه كـ Push API + Service Worker قياسي.
import crypto from 'node:crypto'
import webpush from 'web-push'
import { pool } from '../db.js'

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
