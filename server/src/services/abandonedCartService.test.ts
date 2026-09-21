import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { pool } from '../db.js'
import { upsertCartSnapshot, clearCartSnapshot, sendAbandonedCartReminders } from './abandonedCartService.js'
import * as pushService from './pushService.js'

const USER_A = 'test-user-cart-a'
const USER_B = 'test-user-cart-b'
const USER_C = 'test-user-cart-c'

async function insertUser(id: string) {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES ($1, $1 || '@test.local', 'x', 'عميل اختبار', now())`,
    [id]
  )
}

async function ageSnapshot(userId: string, hoursAgo: number) {
  await pool.query(`UPDATE cart_snapshots SET updated_at = now() - interval '${hoursAgo} hours' WHERE user_id = $1`, [userId])
}

async function insertOrder(id: string, userId: string, createdAt: string) {
  await pool.query(
    `INSERT INTO orders (id, order_number, user_id, customer_full_name, customer_mobile, customer_governorate, customer_address,
                          delivery_slot, payment_method, subtotal, delivery_fee, total, status, created_at)
     VALUES ($1, $1, $2, 'عميل', '01012345678', 'القاهرة', 'عنوان', 'morning', 'cod', 100, 0, 100, 'placed', $3::timestamptz)`,
    [id, userId, createdAt]
  )
}

async function resetFixtures() {
  await pool.query('DELETE FROM cart_snapshots')
  await pool.query('DELETE FROM order_items')
  await pool.query('DELETE FROM orders')
  await pool.query('DELETE FROM notification_preferences')
  await pool.query('DELETE FROM users WHERE id IN ($1, $2, $3)', [USER_A, USER_B, USER_C])
  await insertUser(USER_A)
  await insertUser(USER_B)
  await insertUser(USER_C)
  // العروض/التسويق مفعّلة افتراضياً في الاختبارات دي — نتحقق من حالة التعطيل بشكل صريح
  // في الاختبار المخصص لها بس.
  for (const id of [USER_A, USER_B, USER_C]) {
    await pool.query(
      `INSERT INTO notification_preferences (user_id, order_updates, promotions) VALUES ($1, 1, 1)`,
      [id]
    )
  }
}

beforeEach(async () => {
  await resetFixtures()
  vi.restoreAllMocks()
})

afterAll(async () => {
  await pool.end()
})

describe('upsertCartSnapshot / clearCartSnapshot', () => {
  it('stores a snapshot and clears it when items become empty', async () => {
    await upsertCartSnapshot(USER_A, [{ productId: 'p1', quantity: 2 }])
    const { rows: before } = await pool.query('SELECT * FROM cart_snapshots WHERE user_id = $1', [USER_A])
    expect(before).toHaveLength(1)

    await upsertCartSnapshot(USER_A, [])
    const { rows: after } = await pool.query('SELECT * FROM cart_snapshots WHERE user_id = $1', [USER_A])
    expect(after).toHaveLength(0)
  })

  it('resets reminder_sent_at whenever the cart is updated again', async () => {
    await upsertCartSnapshot(USER_A, [{ productId: 'p1', quantity: 1 }])
    await pool.query('UPDATE cart_snapshots SET reminder_sent_at = now() WHERE user_id = $1', [USER_A])
    await upsertCartSnapshot(USER_A, [{ productId: 'p1', quantity: 2 }])
    const { rows } = await pool.query('SELECT reminder_sent_at as "reminderSentAt" FROM cart_snapshots WHERE user_id = $1', [USER_A])
    expect(rows[0].reminderSentAt).toBeNull()
  })
})

describe('sendAbandonedCartReminders', () => {
  it('sends a reminder for a cart untouched for over 24 hours and marks it sent', async () => {
    const spy = vi.spyOn(pushService, 'sendPushToUser').mockResolvedValue(undefined)
    await upsertCartSnapshot(USER_A, [{ productId: 'p1', quantity: 3 }])
    await ageSnapshot(USER_A, 30)

    const stats = await sendAbandonedCartReminders()

    expect(stats).toEqual({ reminded: 1, skippedConverted: 0, skippedPreference: 0 })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(USER_A, expect.objectContaining({ url: '/cart' }))
    const { rows } = await pool.query('SELECT reminder_sent_at as "reminderSentAt" FROM cart_snapshots WHERE user_id = $1', [USER_A])
    expect(rows[0].reminderSentAt).not.toBeNull()
  })

  it('does not remind a cart updated recently (under the threshold)', async () => {
    const spy = vi.spyOn(pushService, 'sendPushToUser').mockResolvedValue(undefined)
    await upsertCartSnapshot(USER_A, [{ productId: 'p1', quantity: 1 }])
    const stats = await sendAbandonedCartReminders()
    expect(spy).not.toHaveBeenCalled()
    expect(stats.reminded).toBe(0)
  })

  it('does not remind a cart that has already been reminded once', async () => {
    const spy = vi.spyOn(pushService, 'sendPushToUser').mockResolvedValue(undefined)
    await upsertCartSnapshot(USER_A, [{ productId: 'p1', quantity: 1 }])
    await ageSnapshot(USER_A, 30)
    await pool.query('UPDATE cart_snapshots SET reminder_sent_at = now() WHERE user_id = $1', [USER_A])

    await sendAbandonedCartReminders()
    expect(spy).not.toHaveBeenCalled()
  })

  it('clears (without reminding) a stale cart when the customer already placed a real order since', async () => {
    const spy = vi.spyOn(pushService, 'sendPushToUser').mockResolvedValue(undefined)
    await upsertCartSnapshot(USER_B, [{ productId: 'p1', quantity: 1 }])
    await ageSnapshot(USER_B, 30)
    await insertOrder('cart-order-1', USER_B, new Date().toISOString())

    const stats = await sendAbandonedCartReminders()

    expect(stats).toEqual({ reminded: 0, skippedConverted: 1, skippedPreference: 0 })
    expect(spy).not.toHaveBeenCalled()
    const { rows } = await pool.query('SELECT 1 FROM cart_snapshots WHERE user_id = $1', [USER_B])
    expect(rows).toHaveLength(0)
  })

  it('respects the promotions notification preference — skips a customer who opted out, leaving the row re-checkable later', async () => {
    const spy = vi.spyOn(pushService, 'sendPushToUser').mockResolvedValue(undefined)
    await pool.query('UPDATE notification_preferences SET promotions = 0 WHERE user_id = $1', [USER_C])
    await upsertCartSnapshot(USER_C, [{ productId: 'p1', quantity: 1 }])
    await ageSnapshot(USER_C, 30)

    const stats = await sendAbandonedCartReminders()

    expect(stats).toEqual({ reminded: 0, skippedConverted: 0, skippedPreference: 1 })
    expect(spy).not.toHaveBeenCalled()
    const { rows } = await pool.query('SELECT reminder_sent_at as "reminderSentAt" FROM cart_snapshots WHERE user_id = $1', [USER_C])
    expect(rows).toHaveLength(1)
    // مهم: reminder_sent_at لازم يفضل NULL — التفضيل ممكن يتغيّر لاحقاً، فمينفعش الصف
    // ده يتقفل بشكل دائم من إعادة الفحص في تشغيلة قادمة لمجرد إنه اتفحص مرة واحدة.
    expect(rows[0].reminderSentAt).toBeNull()

    await pool.query('UPDATE notification_preferences SET promotions = 1 WHERE user_id = $1', [USER_C])
    const secondRunStats = await sendAbandonedCartReminders()
    expect(secondRunStats).toEqual({ reminded: 1, skippedConverted: 0, skippedPreference: 0 })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  // متطلّب "أمان تحت التداخل" (راجع docs/ABANDONED_CART_CRON.md): لو تشغيلتين اشتغلوا في
  // نفس الوقت بالخطأ على نفس المرشّح، لازم واحدة بس ترسل الإشعار — مش اتنين.
  it('sends the reminder exactly once even when two runs process the same candidate concurrently', async () => {
    const spy = vi.spyOn(pushService, 'sendPushToUser').mockResolvedValue(undefined)
    await upsertCartSnapshot(USER_A, [{ productId: 'p1', quantity: 1 }])
    await ageSnapshot(USER_A, 30)

    const [statsA, statsB] = await Promise.all([sendAbandonedCartReminders(), sendAbandonedCartReminders()])

    expect(spy).toHaveBeenCalledTimes(1)
    expect(statsA.reminded + statsB.reminded).toBe(1)
    const { rows } = await pool.query('SELECT reminder_sent_at as "reminderSentAt" FROM cart_snapshots WHERE user_id = $1', [USER_A])
    expect(rows[0].reminderSentAt).not.toBeNull()
  })
})
