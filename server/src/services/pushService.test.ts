import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../db.js'
import {
  saveSubscription, removeSubscription, getNotificationPreferences, setNotificationPreferences,
  sendPushToUser, notifyOrderStatusChange, getVapidPublicKey, pushConfigured, countPushSubscriptions,
  getAdminNewOrdersPreference, setAdminNewOrdersPreference, selectAdminNewOrderRecipients, notifyAdminsOfNewOrder
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

  it('countPushSubscriptions reflects real rows in the table', async () => {
    const before = await countPushSubscriptions()
    await saveSubscription(USER_ID, { endpoint: ENDPOINT, keys: { p256dh: 'key1', auth: 'auth1' } })
    const after = await countPushSubscriptions()
    expect(after - before).toBe(1)
  })
})

// استهداف إشعار "طلب جديد" الإداري: RBAC (orders.view) + تفضيل admin_new_orders صراحة —
// نفس منطق permissionService.userHasPermission بالظبط، مش أي قائمة أدوار مكتوبة يدوياً هنا.
// بيئة الاختبار دي من غير VAPID حقيقي عمداً — selectAdminNewOrderRecipients بتحدد *مين*
// هيستقبل من غير ما تحتاج إرسال فعلي (راجع pushServiceConfigured.test.ts لاختبارات التسليم
// الفعلي زي أجهزة متعددة والاشتراكات الميتة).
describe('selectAdminNewOrderRecipients / notifyAdminsOfNewOrder (RBAC targeting)', () => {
  const ADMIN_FULL = 'test-push-admin-full' // legacy full admin: role_id=null, role='admin' — عنده orders.view عن طريق LEGACY_ADMIN_PERMISSIONS
  const ADMIN_NO_ORDERS_VIEW = 'test-push-admin-no-orders-view' // role-purchasing-officer: مفيهوش orders.view أصلاً
  const ADMIN_PREF_OFF = 'test-push-admin-pref-off' // عنده orders.view، بس مفعّلش التفضيل
  const ADMIN_PICKER = 'test-push-admin-picker' // role-picker: عنده orders.view كمان (دور مختلف تماماً عن ADMIN_FULL)
  const NON_ADMIN = 'test-push-non-admin' // is_admin=0 أصلاً — مش موظف لوحة تحكم خالص

  const ALL_IDS = [ADMIN_FULL, ADMIN_NO_ORDERS_VIEW, ADMIN_PREF_OFF, ADMIN_PICKER, NON_ADMIN]

  async function resetRbacFixtures() {
    await pool.query('DELETE FROM push_subscriptions WHERE user_id = ANY($1::text[])', [ALL_IDS])
    await pool.query('DELETE FROM notification_preferences WHERE user_id = ANY($1::text[])', [ALL_IDS])
    await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [ALL_IDS])

    async function makeUser(id: string, isAdmin: number, role: string, roleId: string | null) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, full_name, created_at, is_admin, role, role_id)
         VALUES ($1, $1 || '@test.local', 'x', 'مستخدم اختبار استهداف', now(), $2, $3, $4)`,
        [id, isAdmin, role, roleId]
      )
    }
    await makeUser(ADMIN_FULL, 1, 'admin', null)
    await makeUser(ADMIN_NO_ORDERS_VIEW, 1, 'staff', 'role-purchasing-officer')
    await makeUser(ADMIN_PREF_OFF, 1, 'admin', null)
    await makeUser(ADMIN_PICKER, 1, 'staff', 'role-picker')
    await makeUser(NON_ADMIN, 0, 'staff', null)
  }

  beforeEach(resetRbacFixtures)
  afterAll(async () => {
    await pool.query('DELETE FROM push_subscriptions WHERE user_id = ANY($1::text[])', [ALL_IDS])
    await pool.query('DELETE FROM notification_preferences WHERE user_id = ANY($1::text[])', [ALL_IDS])
    await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [ALL_IDS])
  })

  it('a legacy full admin with orders.view and the preference enabled is selected', async () => {
    await setAdminNewOrdersPreference(ADMIN_FULL, true)
    const recipients = await selectAdminNewOrderRecipients()
    expect(recipients).toContain(ADMIN_FULL)
  })

  it('an admin whose RBAC role lacks orders.view is NEVER selected, even with the preference enabled', async () => {
    await setAdminNewOrdersPreference(ADMIN_NO_ORDERS_VIEW, true)
    const recipients = await selectAdminNewOrderRecipients()
    expect(recipients).not.toContain(ADMIN_NO_ORDERS_VIEW)
  })

  it('an admin with orders.view but the preference left at its default (off) is NOT selected', async () => {
    // مفيش setAdminNewOrdersPreference هنا عمداً — الافتراضي admin_new_orders=0 (راجع migration 0070).
    const recipients = await selectAdminNewOrderRecipients()
    expect(recipients).not.toContain(ADMIN_PREF_OFF)
    expect(await getAdminNewOrdersPreference(ADMIN_PREF_OFF)).toBe(false)
  })

  it('a non-admin user is never selected regardless of any preference row', async () => {
    await setAdminNewOrdersPreference(NON_ADMIN, true)
    const recipients = await selectAdminNewOrderRecipients()
    expect(recipients).not.toContain(NON_ADMIN)
  })

  it('multiple eligible admins with different roles are ALL selected — not just one arbitrarily', async () => {
    await setAdminNewOrdersPreference(ADMIN_FULL, true)
    await setAdminNewOrdersPreference(ADMIN_PICKER, true)
    await setAdminNewOrdersPreference(ADMIN_NO_ORDERS_VIEW, true) // هيترفض برضه رغم التفضيل — RBAC الأول
    await setAdminNewOrdersPreference(ADMIN_PREF_OFF, false)

    const recipients = (await selectAdminNewOrderRecipients()).sort()
    expect(recipients).toEqual([ADMIN_FULL, ADMIN_PICKER].sort())
  })

  it('notifyAdminsOfNewOrder resolves without throwing even when zero admins are eligible', async () => {
    await expect(
      notifyAdminsOfNewOrder({ id: 'order-x', orderNumber: 'ALA-900002', customerFullName: 'عميل اختبار', total: 100 })
    ).resolves.toBeUndefined()
  })
})
