import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import {
  saveSubscription, removeSubscription, getNotificationPreferences, setNotificationPreferences,
  sendPushToUser, notifyOrderStatusChange, getVapidPublicKey, pushConfigured
} from './pushService.js'

const USER_ID = 'test-user-push'
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/test-endpoint-abc123'

async function resetFixtures() {
  await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1', [USER_ID])
  await pool.query('DELETE FROM notification_preferences WHERE user_id = $1', [USER_ID])
  await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at, is_admin, role)
     VALUES ($1, $1 || '@test.local', 'x', 'مستخدم اختبار الإشعارات', now(), 0, 'staff')`,
    [USER_ID]
  )
}

describe('pushService', () => {
  beforeEach(resetFixtures)
  afterAll(async () => {
    await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1', [USER_ID])
    await pool.query('DELETE FROM notification_preferences WHERE user_id = $1', [USER_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])
  })

  // بيئة الاختبار دي مالهاش مفاتيح VAPID حقيقية (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY) — فده
  // بيتأكد فعلياً إن pushConfigured=false هنا، نفس تحفظ WhatsApp/Cloudinary في هذا المشروع.
  it('reports push as not configured in this environment (no real VAPID keys)', () => {
    expect(pushConfigured).toBe(false)
    expect(getVapidPublicKey()).toBeNull()
  })

  it('saves a push subscription and upserts on the same endpoint', async () => {
    await saveSubscription(USER_ID, { endpoint: ENDPOINT, keys: { p256dh: 'key1', auth: 'auth1' } })
    const { rows } = await pool.query('SELECT p256dh, auth FROM push_subscriptions WHERE endpoint = $1', [ENDPOINT])
    expect(rows[0]).toEqual({ p256dh: 'key1', auth: 'auth1' })

    await saveSubscription(USER_ID, { endpoint: ENDPOINT, keys: { p256dh: 'key2', auth: 'auth2' } })
    const { rows: afterUpsert } = await pool.query('SELECT p256dh, auth FROM push_subscriptions WHERE endpoint = $1', [ENDPOINT])
    expect(afterUpsert).toHaveLength(1)
    expect(afterUpsert[0]).toEqual({ p256dh: 'key2', auth: 'auth2' })
  })

  it('removes a subscription by endpoint', async () => {
    await saveSubscription(USER_ID, { endpoint: ENDPOINT, keys: { p256dh: 'key1', auth: 'auth1' } })
    await removeSubscription(ENDPOINT)
    const { rows } = await pool.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [ENDPOINT])
    expect(rows).toHaveLength(0)
  })

  it('defaults to order updates on, promotions off for a user with no saved preferences', async () => {
    const prefs = await getNotificationPreferences(USER_ID)
    expect(prefs).toEqual({ orderUpdates: true, promotions: false })
  })

  it('saves and reads back custom preferences', async () => {
    await setNotificationPreferences(USER_ID, { orderUpdates: false, promotions: true })
    const prefs = await getNotificationPreferences(USER_ID)
    expect(prefs).toEqual({ orderUpdates: false, promotions: true })
  })

  it('upserts preferences on repeated saves for the same user', async () => {
    await setNotificationPreferences(USER_ID, { orderUpdates: false, promotions: true })
    await setNotificationPreferences(USER_ID, { orderUpdates: true, promotions: true })
    const prefs = await getNotificationPreferences(USER_ID)
    expect(prefs).toEqual({ orderUpdates: true, promotions: true })
  })

  it('sendPushToUser no-ops safely (does not throw) when push is not configured', async () => {
    await saveSubscription(USER_ID, { endpoint: ENDPOINT, keys: { p256dh: 'key1', auth: 'auth1' } })
    await expect(sendPushToUser(USER_ID, { title: 't', body: 'b' })).resolves.toBeUndefined()
  })

  it('notifyOrderStatusChange is a no-op for guest orders (no user id)', async () => {
    await expect(notifyOrderStatusChange(null, 'ALA-100001', 'delivered')).resolves.toBeUndefined()
  })

  it('notifyOrderStatusChange skips silently for an unrecognized status', async () => {
    await expect(notifyOrderStatusChange(USER_ID, 'ALA-100001', 'placed')).resolves.toBeUndefined()
  })

  it('notifyOrderStatusChange respects a disabled order_updates preference without throwing', async () => {
    await setNotificationPreferences(USER_ID, { orderUpdates: false, promotions: false })
    await expect(notifyOrderStatusChange(USER_ID, 'ALA-100001', 'delivered')).resolves.toBeUndefined()
  })
})
