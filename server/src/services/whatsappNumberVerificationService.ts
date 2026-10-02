// تحقق OTP قبل تفعيل أي تغيير لرقم واتساب خدمة العملاء (store_settings.whatsapp_number) —
// الرقم القديم المؤكد يفضل هو المُستخدم فعلياً (الزرار العائم، روابط wa.me، تأكيد الطلب)
// لحد ما الرقم الجديد يتأكد بنجاح عبر كود بيتبعت فعلياً على واتساب. بيعيد استخدام بنية
// WhatsApp Cloud API الموجودة (sendWhatsAppTemplateMessage في whatsappService.ts) — قالب
// Meta معتمد منفصل تماماً عن قالب تأكيد الطلب (راجع server/docs/WHATSAPP_PHONE_VERIFICATION_TEMPLATE.md).
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { pool, withTransaction } from '../db.js'
import { isValidEgyptianMobile, toWhatsAppInternational } from '../phone.js'
import { whatsappConfigured, sendWhatsAppTemplateMessage } from './whatsappService.js'
import { logEvent, logWarn, maskPhone } from '../logger.js'
import { recordAuditLog } from './auditLogService.js'

const VERIFICATION_TEMPLATE_NAME = process.env.WHATSAPP_PHONE_VERIFICATION_TEMPLATE
const VERIFICATION_TEMPLATE_LANGUAGE = process.env.WHATSAPP_PHONE_VERIFICATION_TEMPLATE_LANGUAGE ?? 'ar'

// "جاهز" هنا يعني: نقدر نبني ونبعت رسالة قالب Meta فعلية لكود تحقق — غير whatsappConfigured
// (اللي معناها بس "نقدر نتصل بالـ API أصلاً"، كافي لتأكيد الطلب التلقائي لو قالبه مضبوط،
// بس مش بالضرورة قالب التحقق ده تحديداً).
export const whatsappPhoneVerificationReady = whatsappConfigured && !!VERIFICATION_TEMPLATE_NAME

export function getPhoneVerificationConfigStatus(): { apiConfigured: boolean; templateConfigured: boolean } {
  return { apiConfigured: whatsappConfigured, templateConfigured: !!VERIFICATION_TEMPLATE_NAME }
}

const OTP_TTL_MS = 5 * 60 * 1000
const RESEND_COOLDOWN_MS = 60 * 1000
const MAX_ATTEMPTS = 5

function generateOtp(): string {
  // crypto.randomInt آمن تشفيرياً (CSPRNG) — عكس Math.random. padStart يحافظ على الصفر
  // الأول لو ظهر (مثال: "012345") بدل ما يتحوّل لرقم بخمس خانات بالغلط.
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
}

interface VerificationRow {
  id: string
  adminUserId: string
  phone: string
  otpHash: string
  expiresAt: string
  attempts: number
  maxAttempts: number
  lastSentAt: string
  verifiedAt: string | null
  cancelledAt: string | null
}

const SELECT_VERIFICATION = `
  SELECT id, admin_user_id as "adminUserId", phone, otp_hash as "otpHash", expires_at as "expiresAt",
         attempts, max_attempts as "maxAttempts", last_sent_at as "lastSentAt",
         verified_at as "verifiedAt", cancelled_at as "cancelledAt"
  FROM whatsapp_number_verifications
`

async function findActivePendingForAdmin(adminUserId: string): Promise<VerificationRow | null> {
  const { rows } = await pool.query<VerificationRow>(
    `${SELECT_VERIFICATION} WHERE admin_user_id = $1 AND verified_at IS NULL AND cancelled_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [adminUserId]
  )
  return rows[0] ?? null
}

export type RequestVerificationResult =
  | { ok: false; reason: 'invalid_phone' }
  | { ok: false; reason: 'whatsapp_verification_not_configured' }
  | { ok: false; reason: 'resend_cooldown'; retryAfterSeconds: number }
  | { ok: false; reason: 'send_failed' }
  | { ok: true; verificationId: string; phone: string }

// بيطلب كود تحقق جديد (أو يعيد إرسال نفس الكود لو نفس الرقم ولسه جوه فترة الصلاحية) —
// أبداً ما بيلمس store_settings.whatsapp_number هنا، بس بيبعت الكود ويخزّن hash منه.
export async function requestWhatsAppNumberVerification(adminUserId: string, rawPhone: unknown): Promise<RequestVerificationResult> {
  const phone = typeof rawPhone === 'string' ? rawPhone.trim() : ''
  if (!isValidEgyptianMobile(phone)) return { ok: false, reason: 'invalid_phone' }
  if (!whatsappPhoneVerificationReady) return { ok: false, reason: 'whatsapp_verification_not_configured' }

  const existing = await findActivePendingForAdmin(adminUserId)
  const now = Date.now()

  if (existing && existing.phone === phone) {
    const elapsedMs = now - new Date(existing.lastSentAt).getTime()
    if (elapsedMs < RESEND_COOLDOWN_MS) {
      return { ok: false, reason: 'resend_cooldown', retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - elapsedMs) / 1000) }
    }
  }

  const otp = generateOtp()
  const otpHash = bcrypt.hashSync(otp, 10)
  const expiresAt = new Date(now + OTP_TTL_MS).toISOString()

  let verificationId: string
  if (existing && existing.phone === phone) {
    // إعادة إرسال لنفس الرقم — نفس صف التحقق، كود جديد، عداد محاولات اتصفّر، صلاحية جديدة.
    verificationId = existing.id
    await pool.query(
      `UPDATE whatsapp_number_verifications
       SET otp_hash = $2, expires_at = $3, attempts = 0, last_sent_at = now()
       WHERE id = $1`,
      [verificationId, otpHash, expiresAt]
    )
  } else {
    // رقم مختلف عن أي تحقق معلّق سابق (أو مفيش تحقق معلّق أصلاً) — نلغي أي تحقق معلّق قديم
    // لنفس الأدمن (راجع "invalidate any other pending verification") ونبدأ صف جديد.
    if (existing) {
      await pool.query('UPDATE whatsapp_number_verifications SET cancelled_at = now() WHERE id = $1', [existing.id])
    }
    verificationId = 'wanv-' + crypto.randomBytes(12).toString('hex')
    await pool.query(
      `INSERT INTO whatsapp_number_verifications (id, admin_user_id, phone, otp_hash, expires_at, attempts, max_attempts, last_sent_at)
       VALUES ($1, $2, $3, $4, $5, 0, $6, now())`,
      [verificationId, adminUserId, phone, otpHash, expiresAt, MAX_ATTEMPTS]
    )
  }

  const toInternational = toWhatsAppInternational(phone)
  const result = await sendWhatsAppTemplateMessage({
    toNumber: phone,
    templateName: VERIFICATION_TEMPLATE_NAME!,
    languageCode: VERIFICATION_TEMPLATE_LANGUAGE,
    components: [{ type: 'body', parameters: [{ type: 'text', text: otp }] }],
    previewBody: `كود تأكيد تغيير رقم واتساب خدمة العملاء`,
    createdByUserId: adminUserId,
    notificationType: 'whatsapp_number_verification'
  })

  logEvent('whatsapp_number_verification_requested', {
    adminUserId, verificationId, maskedPhone: maskPhone(phone), resend: !!(existing && existing.phone === phone)
  })
  await recordAuditLog({
    adminUserId, action: 'whatsapp_number_verification_requested', entityType: 'store_settings', entityId: '1',
    newValues: { verificationId, maskedPhone: maskPhone(phone) }
  })

  if (!result.ok || !result.sent) {
    logWarn('whatsapp_number_verification_send_failed', { adminUserId, verificationId, maskedPhone: maskPhone(phone) })
    return { ok: false, reason: 'send_failed' }
  }

  // لا داعي للتحويل الدولي هنا فعلياً — sendWhatsAppTemplateMessage بيعمله داخلياً؛ السطر
  // فوق (toInternational) موجود فقط لو احتجنا نسجّله لاحقاً، من غير ما يتسجّل في أي log حالياً.
  void toInternational
  return { ok: true, verificationId, phone }
}

export type VerifyCodeResult =
  | { error: 'verification_not_found' }
  | { error: 'verification_code_expired' }
  | { error: 'verification_attempts_exceeded' }
  | { error: 'invalid_verification_code' }
  | { verifiedPhone: string }

// بيتحقق من الكود، وبس لو صح فعلياً بيحدّث store_settings.whatsapp_number جوه transaction
// واحدة — القفل (FOR UPDATE) بيمنع سباق بين محاولتين متزامنتين بنفس الكود الصحيح. الراوت
// المنادي هو المسؤول عن إعادة قراءة/تسلسل الإعدادات الكاملة بعد النجاح (نفس نمط PATCH
// الموجود في adminSettings.ts) — الدالة دي ما بترجعش شكل settings الكامل عشان تفادي تمرير
// استعلام/دالة تسلسل من بره، وتفادي ازدواج منطق serialize الموجود بالفعل في الراوت.
export async function verifyWhatsAppNumberCode(adminUserId: string, verificationId: string, rawCode: unknown): Promise<VerifyCodeResult> {
  const code = typeof rawCode === 'string' ? rawCode.trim() : ''

  const { rows } = await pool.query<VerificationRow>(
    `${SELECT_VERIFICATION} WHERE id = $1 AND admin_user_id = $2`,
    [verificationId, adminUserId]
  )
  const row = rows[0]
  if (!row || row.verifiedAt || row.cancelledAt) return { error: 'verification_not_found' }
  if (new Date(row.expiresAt).getTime() <= Date.now()) return { error: 'verification_code_expired' }
  if (row.attempts >= row.maxAttempts) return { error: 'verification_attempts_exceeded' }

  const codeMatches = /^\d{6}$/.test(code) && bcrypt.compareSync(code, row.otpHash)
  if (!codeMatches) {
    await pool.query('UPDATE whatsapp_number_verifications SET attempts = attempts + 1 WHERE id = $1', [verificationId])
    return { error: 'invalid_verification_code' }
  }

  const { rows: oldSettingsRows } = await pool.query<{ whatsappNumber: string }>('SELECT whatsapp_number as "whatsappNumber" FROM store_settings WHERE id = 1')
  const oldNumber = oldSettingsRows[0]?.whatsappNumber ?? ''

  const verifiedPhone = await withTransaction(async client => {
    const { rows: lockedRows } = await client.query<VerificationRow>(
      `${SELECT_VERIFICATION} WHERE id = $1 FOR UPDATE`,
      [verificationId]
    )
    const locked = lockedRows[0]
    if (!locked || locked.verifiedAt || locked.cancelledAt || locked.attempts >= locked.maxAttempts || new Date(locked.expiresAt).getTime() <= Date.now()) {
      throw new Error('verification_no_longer_valid')
    }

    await client.query('UPDATE store_settings SET whatsapp_number = $1 WHERE id = 1', [locked.phone])
    await client.query('UPDATE whatsapp_number_verifications SET verified_at = now() WHERE id = $1', [verificationId])
    await client.query(
      `UPDATE whatsapp_number_verifications SET cancelled_at = now()
       WHERE admin_user_id = $1 AND id != $2 AND verified_at IS NULL AND cancelled_at IS NULL`,
      [adminUserId, verificationId]
    )
    return locked.phone
  }).catch(err => {
    if (err instanceof Error && err.message === 'verification_no_longer_valid') return null
    throw err
  })

  if (!verifiedPhone) return { error: 'verification_not_found' }

  logEvent('store_whatsapp_number_changed', {
    adminUserId, verificationId, oldMaskedPhone: maskPhone(oldNumber), newMaskedPhone: maskPhone(verifiedPhone)
  })
  await recordAuditLog({
    adminUserId, action: 'store_whatsapp_number_changed', entityType: 'store_settings', entityId: '1',
    oldValues: { maskedPhone: maskPhone(oldNumber) },
    newValues: { maskedPhone: maskPhone(verifiedPhone), verificationId }
  })

  return { verifiedPhone }
}

// إلغاء صريح من الأدمن ("إلغاء" في الواجهة) — بيمنع إعادة استخدام نفس الكود لاحقاً حتى لو
// لسه جوه فترة الصلاحية، ومفيش أي تأثير على الرقم الحالي في store_settings أبداً.
export async function cancelWhatsAppNumberVerification(adminUserId: string, verificationId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE whatsapp_number_verifications SET cancelled_at = now()
     WHERE id = $1 AND admin_user_id = $2 AND verified_at IS NULL AND cancelled_at IS NULL`,
    [verificationId, adminUserId]
  )
  return (rowCount ?? 0) > 0
}
