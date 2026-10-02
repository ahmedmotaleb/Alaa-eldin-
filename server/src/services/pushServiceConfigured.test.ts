// اختبارات sendPushToUser/notifyAdminsOfNewOrder في حالة "مُفعّل فعلياً" (VAPID_PUBLIC_KEY/
// VAPID_PRIVATE_KEY متضبطين) — pushConfigured بيتحسب مرة واحدة وقت تحميل الموديول، فأي
// اختبار محتاج قيمة بيئة مختلفة لازم يضبط process.env الأول، بعدين vi.resetModules()،
// بعدين import ديناميكي جديد — نفس الأسلوب المتّبع في whatsappOrderConfirmation.test.ts.
// webpush.sendNotification نفسها بتتقلّد بالكامل — مفيش أي اتصال حقيقي بأي مزوّد بوش هنا.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_PUB = process.env.VAPID_PUBLIC_KEY
const ORIGINAL_PRIV = process.env.VAPID_PRIVATE_KEY

const USER_ID = 'test-user-push-configured'
const ENDPOINT_1 = 'https://fcm.googleapis.com/fcm/send/device-1'
const ENDPOINT_2 = 'https://fcm.googleapis.com/fcm/send/device-2'

let sendNotificationMock: ReturnType<typeof vi.fn>

async function loadConfigured() {
  process.env.VAPID_PUBLIC_KEY = 'test-public-key'
  process.env.VAPID_PRIVATE_KEY = 'test-private-key'
  sendNotificationMock = vi.fn().mockResolvedValue(undefined)
  vi.doMock('web-push', () => ({
    default: { setVapidDetails: vi.fn(), sendNotification: sendNotificationMock }
  }))
  vi.resetModules()
  const pushService = await import('./pushService.js')
  const { pool } = await import('../db.js')
  return { pushService, pool }
}

async function resetFixtures(pool: import('pg').Pool) {
  await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1', [USER_ID])
  await pool.query('DELETE FROM notification_preferences WHERE user_id = $1', [USER_ID])
  await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at, is_admin, role)
     VALUES ($1, $1 || '@test.local', 'x', 'مستخدم اختبار بوش مُفعّل', now(), 1, 'admin')`,
    [USER_ID]
  )
}

describe('pushService (VAPID configured, webpush delivery mocked)', () => {
  beforeEach(async () => {
    const { pool } = await loadConfigured()
    await resetFixtures(pool)
  })

  afterEach(async () => {
    vi.doUnmock('web-push')
    vi.resetModules()
    if (ORIGINAL_PUB === undefined) delete process.env.VAPID_PUBLIC_KEY
    else process.env.VAPID_PUBLIC_KEY = ORIGINAL_PUB
    if (ORIGINAL_PRIV === undefined) delete process.env.VAPID_PRIVATE_KEY
    else process.env.VAPID_PRIVATE_KEY = ORIGINAL_PRIV
    const { pool } = await import('../db.js')
    await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1', [USER_ID])
    await pool.query('DELETE FROM notification_preferences WHERE user_id = $1', [USER_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])
  })

  it('confirms VAPID is actually configured under these env vars', async () => {
    const { pushService } = await loadConfigured()
    expect(pushService.pushConfigured).toBe(true)
  })

  it('sends to every valid subscription for a user — multiple devices (phone/tablet/desktop)', async () => {
    const { pushService, pool } = await loadConfigured()
    await resetFixtures(pool)
    await pushService.saveSubscription(USER_ID, { endpoint: ENDPOINT_1, keys: { p256dh: 'k1', auth: 'a1' } })
    await pushService.saveSubscription(USER_ID, { endpoint: ENDPOINT_2, keys: { p256dh: 'k2', auth: 'a2' } })

    await pushService.sendPushToUser(USER_ID, { title: 'طلب جديد 🛒', body: 'ALA-1234 · أحمد محمد · 850.00 ج.م' })

    expect(sendNotificationMock).toHaveBeenCalledTimes(2)
    const calledEndpoints = sendNotificationMock.mock.calls.map((c: unknown[]) => (c[0] as { endpoint: string }).endpoint).sort()
    expect(calledEndpoints).toEqual([ENDPOINT_1, ENDPOINT_2].sort())
  })

  it('removes a subscription that returns 410 Gone, but still delivers to the other valid subscription', async () => {
    const { pushService, pool } = await loadConfigured()
    await resetFixtures(pool)
    await pushService.saveSubscription(USER_ID, { endpoint: ENDPOINT_1, keys: { p256dh: 'k1', auth: 'a1' } })
    await pushService.saveSubscription(USER_ID, { endpoint: ENDPOINT_2, keys: { p256dh: 'k2', auth: 'a2' } })

    sendNotificationMock.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint === ENDPOINT_1) {
        const err = new Error('Gone') as Error & { statusCode: number }
        err.statusCode = 410
        throw err
      }
    })

    await expect(pushService.sendPushToUser(USER_ID, { title: 't', body: 'b' })).resolves.toBeUndefined()

    expect(sendNotificationMock).toHaveBeenCalledTimes(2)
    const { rows } = await pool.query('SELECT endpoint FROM push_subscriptions WHERE user_id = $1', [USER_ID])
    expect(rows.map((r: { endpoint: string }) => r.endpoint)).toEqual([ENDPOINT_2])
  })

  it('a 404 from the push provider also removes the stale subscription without throwing', async () => {
    const { pushService, pool } = await loadConfigured()
    await resetFixtures(pool)
    await pushService.saveSubscription(USER_ID, { endpoint: ENDPOINT_1, keys: { p256dh: 'k1', auth: 'a1' } })

    sendNotificationMock.mockImplementation(async () => {
      const err = new Error('Not Found') as Error & { statusCode: number }
      err.statusCode = 404
      throw err
    })

    await expect(pushService.sendPushToUser(USER_ID, { title: 't', body: 'b' })).resolves.toBeUndefined()

    const { rows } = await pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [ENDPOINT_1])
    expect(rows).toHaveLength(0)
  })

  it('a dead subscription does not prevent the new-order push flow from completing (best effort, never throws)', async () => {
    const { pushService, pool } = await loadConfigured()
    await resetFixtures(pool)
    await pushService.setAdminNewOrdersPreference(USER_ID, true)
    await pushService.saveSubscription(USER_ID, { endpoint: ENDPOINT_1, keys: { p256dh: 'k1', auth: 'a1' } })

    sendNotificationMock.mockImplementation(async () => {
      throw new Error('network down, no statusCode at all')
    })

    await expect(
      pushService.notifyAdminsOfNewOrder({ id: 'order-1', orderNumber: 'ALA-900001', customerFullName: 'أحمد محمد', total: 850 })
    ).resolves.toBeUndefined()
  })

  it('does not repeatedly retry a subscription already removed for being dead (it is simply gone)', async () => {
    const { pushService, pool } = await loadConfigured()
    await resetFixtures(pool)
    await pushService.saveSubscription(USER_ID, { endpoint: ENDPOINT_1, keys: { p256dh: 'k1', auth: 'a1' } })
    sendNotificationMock.mockRejectedValue(Object.assign(new Error('Gone'), { statusCode: 410 }))

    await pushService.sendPushToUser(USER_ID, { title: 't', body: 'b' })
    expect(sendNotificationMock).toHaveBeenCalledTimes(1)

    // تاني مرة — الاشتراك اتشال خلاص، فمفيش أي محاولة إرسال تانية ليه.
    await pushService.sendPushToUser(USER_ID, { title: 't', body: 'b' })
    expect(sendNotificationMock).toHaveBeenCalledTimes(1)
  })
})
