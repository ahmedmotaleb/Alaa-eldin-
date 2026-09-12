// منطق فحص Origin لحماية CSRF (defense in depth فوق SameSite=Lax) — مفصول في دالة صرفة
// عشان يتقدر يتفحص بوحدة اختبار حقيقية من غير ما نحتاج نشغّل سيرفر Express كامل.
export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function isRequestOriginAllowed(
  method: string,
  origin: string | undefined,
  allowedOrigins: ReadonlySet<string>,
  isProduction: boolean
): boolean {
  if (SAFE_METHODS.has(method)) return true
  if (!origin) return true
  if (allowedOrigins.has(origin)) return true
  return !isProduction
}
