// تحقق فعلي من Cloudflare Turnstile — السر (TURNSTILE_SECRET_KEY) بيتقرا من متغيرات بيئة
// السيرفر بس، وما بيترجعش أو يتسجّل في أي log أو رد API أبداً. مفتاح الموقع العام
// (TURNSTILE_SITE_KEY) آمن يتعرض للواجهة الأمامية (ده تصميم Turnstile نفسه — المفتاح ده
// معروف بيتحط في HTML الصفحة). التحقق دايماً بيحصل هنا (سيرفر لسيرفر مباشرة مع Cloudflare)
// — الواجهة الأمامية ممكن تبعت أي توكن، الثقة الوحيدة هي رد Cloudflare نفسه.
import { logEvent, logWarn, logError } from '../logger.js'

const SITE_KEY = process.env.TURNSTILE_SITE_KEY
const SECRET_KEY = process.env.TURNSTILE_SECRET_KEY
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const VERIFY_TIMEOUT_MS = 5000

// مُفعّل فعلياً بس لو المتغيرين الاتنين موجودين — نفس مبدأ whatsappConfigured/vapid في
// باقي التكاملات (كل شيء أو ولا حاجة، مفيش حالة "نص مُفعّل").
export const turnstileConfigured = !!(SITE_KEY && SECRET_KEY)

// آمن للتعريض العام (استعمال الواجهة الأمامية لعرض الـ widget) — null لو غير مُفعّل، عشان
// الواجهة الأمامية تعرف تتجاهل الـ widget بالكامل بدل ما تحاول تعرضه بمفتاح فاضي.
export const turnstileSiteKey: string | null = turnstileConfigured ? SITE_KEY! : null

export type TurnstileVerifyResult =
  | { ok: true }
  | { ok: false, reason: 'missing_token' | 'invalid_token' | 'provider_error' | 'not_configured' }

interface TurnstileApiResponse {
  success: boolean
  'error-codes'?: string[]
  challenge_ts?: string
  hostname?: string
}

// بيتحقق فعلياً من التوكن مباشرة مع Cloudflare — مفيش أي "تحقق من الواجهة الأمامية بس" مقبول
// هنا. المُنادي (route) هو المسؤول عن تقرير "هل التحقق مطلوب لهذا الطلب أصلاً" (بناءً على
// turnstileConfigured + سياسة الـ route نفسها) قبل ما ينادي الدالة دي.
export async function verifyTurnstileToken(token: string | null | undefined, remoteIp?: string, requestId?: string): Promise<TurnstileVerifyResult> {
  if (!turnstileConfigured) {
    return { ok: false, reason: 'not_configured' }
  }
  if (typeof token !== 'string' || !token.trim()) {
    logWarn('captcha_verification_failed', { requestId, reason: 'missing_token' })
    return { ok: false, reason: 'missing_token' }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)

  let res: Response
  try {
    const body = new URLSearchParams({ secret: SECRET_KEY!, response: token })
    if (remoteIp) body.set('remoteip', remoteIp)
    res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal
    })
  } catch (err) {
    // تايم آوت أو خطأ شبكة (Cloudflare نفسه غير متاح مؤقتاً) — ما بنعتبرهوش نجاح أبداً
    // (fail-closed)، ده مسؤولية المُنادي يقرر الرد المناسب.
    logError('captcha_provider_error', { requestId, kind: err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network_error' })
    return { ok: false, reason: 'provider_error' }
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    logError('captcha_provider_error', { requestId, kind: 'http_error', status: res.status })
    return { ok: false, reason: 'provider_error' }
  }

  let data: TurnstileApiResponse
  try {
    data = await res.json() as TurnstileApiResponse
  } catch {
    // رد غير قابل للتفسير كـ JSON — تعامل معه كخطأ مزوّد، مش كتحقق ناجح أو فاشل صريح.
    logError('captcha_provider_error', { requestId, kind: 'malformed_response' })
    return { ok: false, reason: 'provider_error' }
  }

  if (typeof data?.success !== 'boolean') {
    logError('captcha_provider_error', { requestId, kind: 'malformed_response' })
    return { ok: false, reason: 'provider_error' }
  }

  if (!data.success) {
    // error-codes من Cloudflare نفسها (زي 'timeout-or-duplicate' لتوكن مُعاد استخدامه أو
    // منتهي) — قيم عامة معروفة من المزوّد، مش سرية، آمنة للتسجيل للتشخيص.
    logWarn('captcha_verification_failed', { requestId, reason: 'invalid_token', errorCodes: data['error-codes'] ?? [] })
    return { ok: false, reason: 'invalid_token' }
  }

  logEvent('captcha_verification_success', { requestId })
  return { ok: true }
}
