import { logWarn, logError } from './logger.js'

const RESEND_API_KEY = process.env.RESEND_API_KEY
const RESEND_FROM = process.env.RESEND_FROM ?? 'علاء الدين <onboarding@resend.dev>'
const isProduction = process.env.NODE_ENV === 'production'

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  if (!RESEND_API_KEY) {
    // رابط الاستعادة بيحتوي على توكن صالح فعلياً — ممنوع منعاً باتاً يتكتب في لوجات
    // الإنتاج (كان بيتطبع كامل هنا قبل كده، خارج redaction بتاع pino). في بيئة التطوير
    // بس بيتعرض عشان المطوّر يقدر يكمّل الفلو من غير مفتاح Resend.
    logWarn('password_reset_email_skipped', { reason: 'resend_api_key_missing' })
    if (!isProduction) console.warn(`[dev only] رابط استعادة كلمة المرور: ${resetUrl}`)
    return
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to,
      subject: 'استعادة كلمة المرور — علاء الدين',
      html: `
        <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; text-align: right; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #16A34A;">استعادة كلمة المرور</h2>
          <p>تلقينا طلبًا لإعادة تعيين كلمة المرور الخاصة بحسابك في متجر علاء الدين.</p>
          <p>
            <a href="${resetUrl}" style="background: #16A34A; color: #fff; padding: 12px 22px; border-radius: 8px; text-decoration: none; display: inline-block; font-weight: bold;">
              إعادة تعيين كلمة المرور
            </a>
          </p>
          <p style="color: #68746B; font-size: 13px;">هذا الرابط صالح لمدة ساعة واحدة فقط. لو لم تطلب استعادة كلمة المرور، تجاهل هذه الرسالة ببساطة.</p>
        </div>
      `
    })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    logError('password_reset_email_failed', { status: res.status, providerMessage: body.slice(0, 300) })
  }
}
