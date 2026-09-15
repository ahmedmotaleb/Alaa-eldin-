// منطق فحص Origin لحماية CSRF (defense in depth فوق SameSite=Lax) — مفصول في دالة صرفة
// عشان يتقدر يتفحص بوحدة اختبار حقيقية من غير ما نحتاج نشغّل سيرفر Express كامل.
export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function isRequestOriginAllowed(
  method: string,
  origin: string | undefined,
  allowedOrigins: ReadonlySet<string>,
  isProduction: boolean,
  requestHost?: string
): boolean {
  if (SAFE_METHODS.has(method)) return true
  if (!origin) return true
  if (allowedOrigins.has(origin)) return true
  // الموقع (متجر أو لوحة) والـ API بيتقدّموا من نفس الأصل دايماً (سيرفر Express واحد) —
  // لو الـ Origin اللي المتصفح بعته بنفس الـ Host اللي الطلب جاي عليه، فده طلب "نفس الأصل"
  // فعلاً بغض النظر عن الدومين الفعلي (railway.app الافتراضي أو دومين مخصص لاحقاً)، فمحتاجش
  // نعرف الدومين مقدماً في allowedOrigins عشان نسمح بيه.
  if (requestHost) {
    try {
      if (new URL(origin).host === requestHost) return true
    } catch {
      // Origin مش رابط صحيح — نكمل ونرفض زي أي طلب مش معروف.
    }
  }
  return !isProduction
}
