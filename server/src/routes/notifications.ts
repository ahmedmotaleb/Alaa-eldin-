import { Router } from 'express'
import { requireAuth, requireAdmin } from '../auth.js'
import {
  getVapidPublicKey, pushConfigured, saveSubscription, removeSubscription,
  getNotificationPreferences, setNotificationPreferences,
  getAdminNewOrdersPreference, setAdminNewOrdersPreference, sendPushToUser
} from '../services/pushService.js'
import { logEvent } from '../logger.js'

export const notificationsRouter = Router()

// المفتاح العام (VAPID public key) مش سر — لازم يكون متاح للمتصفح قبل أي اشتراك، فمتاح
// من غير تسجيل دخول (زي أي مفتاح عام تاني في نظام تشفير المفتاحين).
notificationsRouter.get('/vapid-public-key', (_req, res) => {
  res.json({ publicKey: getVapidPublicKey(), configured: pushConfigured })
})

notificationsRouter.use(requireAuth)

function isValidSubscription(body: unknown): body is { endpoint: string; keys: { p256dh: string; auth: string } } {
  const b = body as Record<string, unknown>
  const keys = b?.keys as Record<string, unknown> | undefined
  return typeof b?.endpoint === 'string' && !!b.endpoint.trim() &&
    typeof keys?.p256dh === 'string' && !!keys.p256dh.trim() &&
    typeof keys?.auth === 'string' && !!keys.auth.trim()
}

notificationsRouter.post('/subscribe', async (req, res) => {
  if (!isValidSubscription(req.body)) {
    res.status(400).json({ error: 'invalid_subscription' })
    return
  }
  await saveSubscription(req.user!.id, req.body)
  res.status(201).json({ ok: true })
})

notificationsRouter.delete('/subscribe', async (req, res) => {
  const endpoint = req.body?.endpoint
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    res.status(400).json({ error: 'missing_endpoint' })
    return
  }
  await removeSubscription(endpoint)
  res.status(204).end()
})

notificationsRouter.get('/preferences', async (req, res) => {
  const preferences = await getNotificationPreferences(req.user!.id)
  res.json({ preferences })
})

notificationsRouter.patch('/preferences', async (req, res) => {
  const b = req.body as Record<string, unknown>
  if (typeof b?.orderUpdates !== 'boolean' || typeof b?.promotions !== 'boolean') {
    res.status(400).json({ error: 'missing_fields' })
    return
  }
  await setNotificationPreferences(req.user!.id, { orderUpdates: b.orderUpdates, promotions: b.promotions })
  res.json({ preferences: { orderUpdates: b.orderUpdates, promotions: b.promotions } })
})

// تفضيل إداري منفصل تماماً عن تفضيلات العميل فوق — "إشعارات الطلبات الجديدة" على جهاز
// لوحة التحكم ده تحديداً. مقصورة على مستخدمين عندهم isAdmin فقط؛ عميل عادي (حتى لو مسجّل
// دخول) ميقدرش يقرأ أو يعدّل التفضيل الإداري ده.
notificationsRouter.get('/admin-preferences', requireAdmin, async (req, res) => {
  const newOrders = await getAdminNewOrdersPreference(req.user!.id)
  res.json({ newOrders })
})

notificationsRouter.patch('/admin-preferences', requireAdmin, async (req, res) => {
  const b = req.body as Record<string, unknown>
  if (typeof b?.newOrders !== 'boolean') {
    res.status(400).json({ error: 'missing_fields' })
    return
  }
  await setAdminNewOrdersPreference(req.user!.id, b.newOrders)
  logEvent('admin_notification_preference_changed', { userId: req.user!.id, newOrders: b.newOrders })
  res.json({ newOrders: b.newOrders })
})

// إشعار تجريبي — بيتبعت بس لاشتراكات الحساب الحالي نفسه (مش أي أدمن تاني)، عشان مدير يقدر
// يتأكد إن الجهاز ده شغّال صح من غير ما يحتاج ينشئ طلب وهمي فعلي.
notificationsRouter.post('/admin-test', requireAdmin, async (req, res) => {
  await sendPushToUser(req.user!.id, { title: 'اختبار الإشعارات', body: 'إشعارات طلبات علاء الدين تعمل بنجاح' })
  logEvent('admin_test_notification_sent', { userId: req.user!.id })
  res.status(204).end()
})
