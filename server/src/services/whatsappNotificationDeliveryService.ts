// ملكية ذرّية (atomic ownership) لإشعار واتساب تلقائي واحد لكل (طلب، نوع إشعار) — منفصلة
// تماماً عن سجل المحاولات whatsapp_messages (اللي بيفضل يسجّل كل محاولة إرسال فعلية، تلقائية
// أو يدوية، من غير أي علاقة بالملكية هنا). الهدف: تحت تزامن حقيقي (أكتر من نسخة سيرفر على
// Railway، إعادة محاولة checkout، إعادة تشغيل السيرفر) — عملية سيرفر واحدة بالظبط تكسب حق
// بدء إرسال تلقائي واحد لنفس الطلب في نفس اللحظة، ومفيش أي إرسال تلقائي مكرر.
//
// كل قرار "هل أنا صاحب الملكية؟" بيتحدد من نتيجة UPDATE/INSERT شرطي واحد (WHERE ... RETURNING)
// جوه PostgreSQL نفسه، مش من قراءة SELECT سابقة — القراءة (لو حصلت) بتُستخدم بس لتحديد أي
// جملة شرطية نحاول، أما القرار الفعلي دايماً من نتيجة الجملة الشرطية ذاتها.
import crypto from 'node:crypto'
import { pool } from '../db.js'
import { logEvent, logWarn } from '../logger.js'

export const AUTOMATIC_NOTIFICATION_LEASE_SECONDS = 90
export const MAX_AUTOMATIC_ATTEMPTS = 5

export type ClaimResult =
  | { claimed: true; deliveryId: string; ownerToken: string; attemptCount: number }
  | { claimed: false; reason: 'already_sent' | 'active_owner' | 'max_attempts_reached' }

interface DeliveryRow {
  id: string
  status: 'pending' | 'sent' | 'failed'
  attemptCount: number
}

// أول ادّعاء ملكية لإشعار تلقائي غير موجود أصلاً — إدراج ذرّي واحد (ON CONFLICT DO NOTHING)،
// فلو عمليتين حاولتا في نفس اللحظة بالظبط، واحدة بس هي اللي هترجع صف (RETURNING)، والتانية
// هترجع صف فاضي فوراً من غير أي انتظار.
async function tryFirstClaim(orderId: string, notificationType: string, ownerToken: string): Promise<DeliveryRow | null> {
  const { rows } = await pool.query<DeliveryRow>(
    `INSERT INTO whatsapp_notification_deliveries
       (id, order_id, notification_type, status, owner_token, claimed_at, lease_expires_at, attempt_count, created_at, updated_at)
     VALUES ($1, $2, $3, 'pending', $4, now(), now() + ($5 || ' seconds')::interval, 1, now(), now())
     ON CONFLICT (order_id, notification_type) DO NOTHING
     RETURNING id, status, attempt_count as "attemptCount"`,
    [crypto.randomUUID(), orderId, notificationType, ownerToken, AUTOMATIC_NOTIFICATION_LEASE_SECONDS]
  )
  return rows[0] ?? null
}

// استيلاء على إيجار منتهي (الصاحب السابق ممكن يكون العملية بتاعته اتوقفت فجأة/كرشت قبل ما
// يسجّل نتيجة) — شرط "lease_expires_at <= now()" جوه الـ WHERE نفسه هو الضمان الذرّي: لو
// عمليتين حاولتا الاستيلاء في نفس اللحظة، الأولى اللي تاخد قفل الصف بتحدّث lease_expires_at
// لمستقبل قريب، فالتانية لما تيجي تنفّذ شرطها بعد كده هتلاقي الشرط مبقاش متحقق (0 صفوف).
async function tryLeaseTakeover(deliveryId: string, ownerToken: string): Promise<DeliveryRow | null> {
  const { rows } = await pool.query<DeliveryRow>(
    `UPDATE whatsapp_notification_deliveries
     SET owner_token = $2, claimed_at = now(), lease_expires_at = now() + ($3 || ' seconds')::interval,
         attempt_count = attempt_count + 1, updated_at = now()
     WHERE id = $1 AND status = 'pending' AND lease_expires_at <= now()
     RETURNING id, status, attempt_count as "attemptCount"`,
    [deliveryId, ownerToken, AUTOMATIC_NOTIFICATION_LEASE_SECONDS]
  )
  return rows[0] ?? null
}

// إعادة محاولة مُتحكَّم فيها لإشعار فشل قبل كده — نفس مبدأ الاستيلاء تماماً، بس الشرط هنا
// status='failed' AND attempt_count < الحد الأقصى، وبيرجّع الحالة لـ 'pending' مع owner_token
// جديد قبل أي محاولة إرسال فعلية.
async function tryFailedRetryClaim(deliveryId: string, ownerToken: string): Promise<DeliveryRow | null> {
  const { rows } = await pool.query<DeliveryRow>(
    `UPDATE whatsapp_notification_deliveries
     SET status = 'pending', owner_token = $2, claimed_at = now(),
         lease_expires_at = now() + ($3 || ' seconds')::interval, attempt_count = attempt_count + 1, updated_at = now()
     WHERE id = $1 AND status = 'failed' AND attempt_count < $4
     RETURNING id, status, attempt_count as "attemptCount"`,
    [deliveryId, ownerToken, AUTOMATIC_NOTIFICATION_LEASE_SECONDS, MAX_AUTOMATIC_ATTEMPTS]
  )
  return rows[0] ?? null
}

// نقطة الدخول الوحيدة لادّعاء حق بدء إرسال تلقائي — بترجع claimed:true بس لو فعلاً كسبنا
// الملكية (وبس وقتها مسموح ننادي Meta). أي نتيجة تانية معناها "عملية تانية هي صاحبة الحق
// دلوقتي أو خلصت المهمة فعلاً" — من غير أي انتظار على الصاحب الأول.
export async function claimAutomaticNotification(orderId: string, notificationType: string): Promise<ClaimResult> {
  const ownerToken = crypto.randomUUID()

  const firstClaim = await tryFirstClaim(orderId, notificationType, ownerToken)
  if (firstClaim) {
    logEvent('whatsapp_notification_claimed', { orderId, notificationType, attemptCount: firstClaim.attemptCount })
    return { claimed: true, deliveryId: firstClaim.id, ownerToken, attemptCount: firstClaim.attemptCount }
  }

  // في صف موجود بالفعل — قراءة واحدة بس لتحديد أي محاولة ذرّية نجرّب (القرار النهائي دايماً
  // من نتيجة الـ UPDATE الشرطي نفسه تحت، مش من القراءة دي).
  const { rows: existingRows } = await pool.query<DeliveryRow>(
    `SELECT id, status, attempt_count as "attemptCount" FROM whatsapp_notification_deliveries
     WHERE order_id = $1 AND notification_type = $2`,
    [orderId, notificationType]
  )
  const existing = existingRows[0]
  if (!existing) {
    // سباق نادر جداً غير متوقع عملياً — نتصرف بأمان كـ "مش صاحب الحق".
    logWarn('whatsapp_notification_claim_conflict', { orderId, notificationType })
    return { claimed: false, reason: 'active_owner' }
  }

  if (existing.status === 'sent') {
    return { claimed: false, reason: 'already_sent' }
  }

  if (existing.status === 'pending') {
    const takenOver = await tryLeaseTakeover(existing.id, ownerToken)
    if (takenOver) {
      logEvent('whatsapp_notification_lease_reclaimed', { orderId, notificationType, attemptCount: takenOver.attemptCount })
      return { claimed: true, deliveryId: takenOver.id, ownerToken, attemptCount: takenOver.attemptCount }
    }
    logWarn('whatsapp_notification_claim_conflict', { orderId, notificationType })
    return { claimed: false, reason: 'active_owner' }
  }

  // existing.status === 'failed'
  if (existing.attemptCount >= MAX_AUTOMATIC_ATTEMPTS) {
    return { claimed: false, reason: 'max_attempts_reached' }
  }
  const retried = await tryFailedRetryClaim(existing.id, ownerToken)
  if (retried) {
    logEvent('whatsapp_notification_claimed', { orderId, notificationType, attemptCount: retried.attemptCount })
    return { claimed: true, deliveryId: retried.id, ownerToken, attemptCount: retried.attemptCount }
  }
  logWarn('whatsapp_notification_claim_conflict', { orderId, notificationType })
  return { claimed: false, reason: 'active_owner' }
}

// تحديث حالة الإشعار لـ "اتبعت" — بس لو لسه صاحب الإيجار نفسه (owner_token) وبقى في حالة
// pending فعلاً؛ لو مفيش صفوف اتحدّثت، معناها الملكية ضاعت (انتهى الإيجار وعملية تانية
// استولت) قبل ما نسجّل النتيجة — نرفض نكتب فوق حالة الصاحب الجديد ونسجّل الحدث بس.
export async function markNotificationSent(deliveryId: string, ownerToken: string, providerMessageId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `UPDATE whatsapp_notification_deliveries
     SET status = 'sent', provider_message_id = $3, sent_at = now(), owner_token = NULL, lease_expires_at = NULL, updated_at = now()
     WHERE id = $1 AND owner_token = $2 AND status = 'pending'
     RETURNING id`,
    [deliveryId, ownerToken, providerMessageId]
  )
  if (!rows[0]) {
    logWarn('whatsapp_notification_ownership_lost', { deliveryId })
    return false
  }
  logEvent('whatsapp_notification_sent', { deliveryId })
  return true
}

// نفس مبدأ markNotificationSent — بس لحالة الفشل. lastError ممكن يبقى بادئ بـ "unknown:"
// (نتيجة مزوّد غير معروفة، راجع تعليق sendOrderConfirmationWhatsApp) أو "permanent:"
// (خطأ إعدادي مش هيتحل بإعادة محاولة) أو من غير بادئة (خطأ قابل لإعادة المحاولة عادي).
export async function markNotificationFailed(deliveryId: string, ownerToken: string, lastError: string): Promise<boolean> {
  const { rows } = await pool.query(
    `UPDATE whatsapp_notification_deliveries
     SET status = 'failed', last_error = $3, owner_token = NULL, lease_expires_at = NULL, updated_at = now()
     WHERE id = $1 AND owner_token = $2 AND status = 'pending'
     RETURNING id`,
    [deliveryId, ownerToken, lastError]
  )
  if (!rows[0]) {
    logWarn('whatsapp_notification_ownership_lost', { deliveryId })
    return false
  }
  logEvent('whatsapp_notification_failed', { deliveryId, error: lastError })
  return true
}

export interface NotificationDeliveryStatusRow {
  status: 'pending' | 'sent' | 'failed'
  attemptCount: number
  providerMessageId: string | null
  lastError: string | null
  sentAt: string | null
  updatedAt: string
}

// حالة الإشعار التلقائي المنطقي الحالية لطلب معيّن — للعرض في لوحة التحكم (مش للاعتماد
// عليها كقرار ملكية، الملكية دايماً بتتحسم من claim*/mark* فوق بس).
export async function getAutomaticNotificationStatus(orderId: string, notificationType: string): Promise<NotificationDeliveryStatusRow | null> {
  const { rows } = await pool.query<NotificationDeliveryStatusRow>(
    `SELECT status, attempt_count as "attemptCount", provider_message_id as "providerMessageId",
            last_error as "lastError", sent_at as "sentAt", updated_at as "updatedAt"
     FROM whatsapp_notification_deliveries WHERE order_id = $1 AND notification_type = $2`,
    [orderId, notificationType]
  )
  return rows[0] ?? null
}

export interface RetryableDeliveryRow {
  id: string
  orderId: string
  attemptCount: number
}

// دفعة محدودة من الإشعارات الفاشلة القابلة لإعادة المحاولة (مش أخطاء دائمة/إعدادية) —
// تُستخدم من سكربت إعادة المحاولة الدوري (راجع whatsappRetryFailedConfirmations.ts).
export async function listRetryableFailedNotifications(notificationType: string, batchSize: number): Promise<RetryableDeliveryRow[]> {
  const { rows } = await pool.query<RetryableDeliveryRow>(
    `SELECT id, order_id as "orderId", attempt_count as "attemptCount"
     FROM whatsapp_notification_deliveries
     WHERE notification_type = $1 AND status = 'failed' AND attempt_count < $2
       AND (last_error IS NULL OR last_error NOT LIKE 'permanent:%')
     ORDER BY updated_at ASC
     LIMIT $3`,
    [notificationType, MAX_AUTOMATIC_ATTEMPTS, batchSize]
  )
  return rows
}
