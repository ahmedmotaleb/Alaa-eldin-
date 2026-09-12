import { Router } from 'express'
import { requireAuth } from '../auth.js'
import {
  getVapidPublicKey, pushConfigured, saveSubscription, removeSubscription,
  getNotificationPreferences, setNotificationPreferences
} from '../services/pushService.js'

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
