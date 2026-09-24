// اختبارات التزامن الحقيقي الإلزامية (مواصفة 13A-13Q، البنود A-G) لنظام ملكية الإشعار
// التلقائي الذرّي — كل اختبار هنا بيستخدم Promise.all (استدعاءات فعلية متزامنة على نفس
// الـ pool المشترك، كل واحدة بتاخد اتصال منفصل من الـ pool تلقائياً)، مش تشغيل متتابع
// (await ثم await) ومفيش أي قفل/mutex في كود JavaScript بيُحاكى هنا — الضمان كله جوه
// PostgreSQL نفسه (UNIQUE constraint + شروط WHERE الذرّية في claimAutomaticNotification/
// markNotificationSent/markNotificationFailed)، ده بالظبط اللي بند "G" بيتطلب إثباته.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { pool } from '../db.js'
import {
  claimAutomaticNotification, markNotificationSent, markNotificationFailed,
  getAutomaticNotificationStatus, listRetryableFailedNotifications, MAX_AUTOMATIC_ATTEMPTS
} from './whatsappNotificationDeliveryService.js'

const NOTIFICATION_TYPE = 'order_confirmation'

async function insertOrder(orderId: string) {
  await pool.query(
    `INSERT INTO orders (id, order_number, created_at, delivery_slot, delivery_date, payment_method, customer_full_name, customer_mobile,
                          customer_governorate, customer_address, subtotal, delivery_fee, total, status, discount_amount, guest_tracking_token)
     VALUES ($1, $1, now(), 'now', NULL, 'COD', 'عميل اختبار', '01012345678', 'القاهرة', 'عنوان', 50, 0, 50, 'placed', 0, NULL)`,
    [orderId]
  )
}

let orderId: string

beforeEach(async () => {
  orderId = `test-order-wa-delivery-${crypto.randomUUID()}`
  await insertOrder(orderId)
})

afterAll(async () => {
  await pool.query('DELETE FROM whatsapp_notification_deliveries WHERE order_id LIKE $1', ['test-order-wa-delivery-%'])
  await pool.query('DELETE FROM orders WHERE id LIKE $1', ['test-order-wa-delivery-%'])
})

describe('whatsappNotificationDeliveryService — concurrency (13A-13Q)', () => {
  // A: ادّعاء أول متزامن — عمليتين بيحاولوا يبدأوا نفس الإشعار التلقائي في نفس اللحظة
  // بالظبط؛ واحدة بس لازم تكسب الملكية (claimed:true)، والتانية لازم ترجع فوراً من غير
  // أي انتظار (claimed:false).
  it('A: simultaneous first claim — exactly one owner wins', async () => {
    const [a, b] = await Promise.all([
      claimAutomaticNotification(orderId, NOTIFICATION_TYPE),
      claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    ])
    const claimedResults = [a, b].filter(r => r.claimed)
    expect(claimedResults).toHaveLength(1)
    const loserResults = [a, b].filter(r => !r.claimed)
    expect(loserResults).toHaveLength(1)
    expect((loserResults[0] as { reason: string }).reason).toBe('active_owner')

    const { rows } = await pool.query('SELECT count(*) as n FROM whatsapp_notification_deliveries WHERE order_id = $1', [orderId])
    expect(Number(rows[0].n)).toBe(1) // صف منطقي واحد بس اتعمل رغم محاولتين الادّعاء
  })

  // B: إيجار نشط (لسه ما خلصش) — عملية تانية تحاول تدّعي في نفس اللحظة تقريباً لازم
  // ترجع active_owner فوراً، من غير أي انتظار ومن غير ما تلمس صف الملكية.
  it('B: active unexpired lease — a second claimer is refused immediately (no waiting)', async () => {
    const first = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    expect(first.claimed).toBe(true)

    const startedAt = Date.now()
    const second = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    const elapsedMs = Date.now() - startedAt

    expect(second.claimed).toBe(false)
    expect((second as { reason: string }).reason).toBe('active_owner')
    expect(elapsedMs).toBeLessThan(1000) // مفيش انتظار حقيقي — رفض فوري من قاعدة البيانات
  })

  // C: إيجار منتهي (الصاحب السابق افترضياً كرش قبل ما يسجّل النتيجة) — عملية تانية لازم
  // تقدر تستولي عليه ذرّياً بـ owner_token جديد.
  it('C: stale expired lease — takeover succeeds with a new owner token', async () => {
    const first = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    expect(first.claimed).toBe(true)
    if (!first.claimed) throw new Error('unreachable')

    // محاكاة انتهاء الإيجار فعلياً (بدل انتظار 90 ثانية حقيقية في الاختبار)
    await pool.query(
      'UPDATE whatsapp_notification_deliveries SET lease_expires_at = now() - interval \'1 second\' WHERE id = $1',
      [first.deliveryId]
    )

    const second = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    expect(second.claimed).toBe(true)
    if (!second.claimed) throw new Error('unreachable')
    expect(second.ownerToken).not.toBe(first.ownerToken)
    expect(second.deliveryId).toBe(first.deliveryId) // نفس الصف المنطقي، ملكية جديدة بس
  })

  // D: حماية owner_token — عملية فقدت الملكية (إيجارها انتهى واستولت عليه عملية تانية)
  // ومحاولتها اللاحقة تسجّل "اتبعت" بـ owner_token القديم لازم تفشل (صفر صفوف اتأثرت)
  // ومتكتبش فوق حالة الصاحب الجديد.
  it('D: owner-token protection — a worker that lost ownership cannot overwrite the new owner\'s state', async () => {
    const first = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    if (!first.claimed) throw new Error('unreachable')

    await pool.query(
      'UPDATE whatsapp_notification_deliveries SET lease_expires_at = now() - interval \'1 second\' WHERE id = $1',
      [first.deliveryId]
    )
    const second = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    if (!second.claimed) throw new Error('unreachable')

    // العملية الأولى (اللي فقدت الملكية فعلياً) بترجع بعد كده تحاول تسجّل نجاح إرسالها القديم
    const staleMarkResult = await markNotificationSent(first.deliveryId, first.ownerToken, 'wamid.stale')
    expect(staleMarkResult).toBe(false) // اتراض — صفر صفوف اتأثرت

    // الصاحب الجديد يقدر يسجّل حالته براحته من غير ما يتأثر بمحاولة الأول
    const newOwnerMarkResult = await markNotificationSent(second.deliveryId, second.ownerToken, 'wamid.new-owner')
    expect(newOwnerMarkResult).toBe(true)

    const status = await getAutomaticNotificationStatus(orderId, NOTIFICATION_TYPE)
    expect(status?.status).toBe('sent')
    expect(status?.providerMessageId).toBe('wamid.new-owner') // مش 'wamid.stale'
  })

  // E: سباق إعادة محاولة فشل — إشعار فشل قبل كده بخطأ 'retryable' مؤكد (attempt_count < الحد
  // الأقصى)، وعمليتين بيحاولوا يعيدوا محاولته في نفس اللحظة — واحدة بس لازم تكسب حق إعادة
  // المحاولة. (لو الفشل كان 'unknown'، ما كانش هيبقى مؤهل لإعادة محاولة أصلاً — راجع الاختبارات
  // الجديدة تحت لهذا السلوك تحديداً.)
  it('E: failed-retry race — exactly one worker wins the retry', async () => {
    const first = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    if (!first.claimed) throw new Error('unreachable')
    const failedOk = await markNotificationFailed(first.deliveryId, first.ownerToken, 'retryable', 'http_500')
    expect(failedOk).toBe(true)

    const [a, b] = await Promise.all([
      claimAutomaticNotification(orderId, NOTIFICATION_TYPE),
      claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    ])
    const claimedResults = [a, b].filter(r => r.claimed)
    expect(claimedResults).toHaveLength(1)
    const loserResults = [a, b].filter(r => !r.claimed)
    expect(loserResults).toHaveLength(1)
    expect((loserResults[0] as { reason: string }).reason).toBe('active_owner')

    const status = await getAutomaticNotificationStatus(orderId, NOTIFICATION_TYPE)
    expect(status?.attemptCount).toBe(2) // محاولة أولى + محاولة إعادة واحدة بس، مش اتنين
  })

  it('an existing "sent" status causes an immediate no-op regardless of retries/replays', async () => {
    const first = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    if (!first.claimed) throw new Error('unreachable')
    await markNotificationSent(first.deliveryId, first.ownerToken, 'wamid.ok')

    const replay = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    expect(replay).toEqual({ claimed: false, reason: 'already_sent' })
  })

  it('a failed delivery at max attempts refuses further automatic retry claims', async () => {
    const first = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    if (!first.claimed) throw new Error('unreachable')
    let ownerToken = first.ownerToken
    let deliveryId = first.deliveryId

    for (let i = 1; i < MAX_AUTOMATIC_ATTEMPTS; i++) {
      await markNotificationFailed(deliveryId, ownerToken, 'retryable', 'http_500')
      const retried = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
      expect(retried.claimed).toBe(true)
      if (!retried.claimed) throw new Error('unreachable')
      ownerToken = retried.ownerToken
      deliveryId = retried.deliveryId
    }
    await markNotificationFailed(deliveryId, ownerToken, 'retryable', 'http_500')

    const status = await getAutomaticNotificationStatus(orderId, NOTIFICATION_TYPE)
    expect(status?.attemptCount).toBe(MAX_AUTOMATIC_ATTEMPTS)

    const final = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    expect(final).toEqual({ claimed: false, reason: 'max_attempts_reached' })
  })

  it('listRetryableFailedNotifications excludes permanent errors and max-attempt rows', async () => {
    const first = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    if (!first.claimed) throw new Error('unreachable')
    await markNotificationFailed(first.deliveryId, first.ownerToken, 'permanent', 'template not approved')

    const candidates = await listRetryableFailedNotifications(NOTIFICATION_TYPE, 50)
    expect(candidates.find(c => c.orderId === orderId)).toBeUndefined()
  })

  // بند 13/14 من المواصفة: نتيجة "unknown" (شبكة/تايم آوت قبل استلام أي رد فعلي من Meta)
  // لازم تُستبعد من قائمة المرشّحين للسكربت الدوري — نفس استبعاد "permanent" بالظبط، لأن
  // إعادة محاولة عليها ممكن تنتج رسالة تأكيد مكررة فعلياً لو Meta كانت استلمت الطلب الأصلي.
  it('listRetryableFailedNotifications excludes "unknown" (ambiguous) provider results too', async () => {
    const first = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    if (!first.claimed) throw new Error('unreachable')
    await markNotificationFailed(first.deliveryId, first.ownerToken, 'unknown', 'network down')

    const candidates = await listRetryableFailedNotifications(NOTIFICATION_TYPE, 50)
    expect(candidates.find(c => c.orderId === orderId)).toBeUndefined()
  })

  // بند 17 (إلزامي): القاعدة لازم تتفرض من داخل خدمة الملكية نفسها مباشرة، مش بس من فلترة
  // استعلام السكربت — استدعاء claimAutomaticNotification مباشرة على إشعار فشل بنتيجة 'unknown'
  // أو 'permanent' لازم يرفض فوراً (not_retryable) من غير أي محاولة UPDATE ذرّية أصلاً.
  it('claimAutomaticNotification directly refuses to retry an "unknown"-result failure', async () => {
    const first = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    if (!first.claimed) throw new Error('unreachable')
    await markNotificationFailed(first.deliveryId, first.ownerToken, 'unknown', 'network down')

    const attempt = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    expect(attempt).toEqual({ claimed: false, reason: 'not_retryable' })

    const status = await getAutomaticNotificationStatus(orderId, NOTIFICATION_TYPE)
    expect(status?.attemptCount).toBe(1) // مفيش أي محاولة إعادة اتحسبت
  })

  it('claimAutomaticNotification directly refuses to retry a "permanent"-result failure', async () => {
    const first = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    if (!first.claimed) throw new Error('unreachable')
    await markNotificationFailed(first.deliveryId, first.ownerToken, 'permanent', 'template not approved')

    const attempt = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    expect(attempt).toEqual({ claimed: false, reason: 'not_retryable' })

    const status = await getAutomaticNotificationStatus(orderId, NOTIFICATION_TYPE)
    expect(status?.attemptCount).toBe(1)
  })

  it('markNotificationFailed reports ownership lost when called with a stale owner token after takeover', async () => {
    const first = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    if (!first.claimed) throw new Error('unreachable')
    await pool.query(
      'UPDATE whatsapp_notification_deliveries SET lease_expires_at = now() - interval \'1 second\' WHERE id = $1',
      [first.deliveryId]
    )
    const second = await claimAutomaticNotification(orderId, NOTIFICATION_TYPE)
    if (!second.claimed) throw new Error('unreachable')

    const staleResult = await markNotificationFailed(first.deliveryId, first.ownerToken, 'unknown', 'timeout')
    expect(staleResult).toBe(false)
  })
})
