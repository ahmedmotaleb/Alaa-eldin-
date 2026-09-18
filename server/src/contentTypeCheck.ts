// منطق فحص Content-Type لطلبات API — مفصول في دالة صرفة عشان يتقدر يتفحص بوحدة اختبار
// حقيقية من غير ما نحتاج نشغّل سيرفر Express كامل، نفس مبدأ csrfOriginCheck.ts.
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])
const ALLOWED_CONTENT_TYPE_PREFIXES = ['application/json', 'multipart/form-data']

// أي طلب من غير جسم فعلي (زي أغلب أزرار "تفعيل"/"تسجيل خروج" اللي بتبعت POST بدون body)
// مسموح بغض النظر عن الـ Content-Type، لأنه مفيش حاجة هيتفحصها أصلاً.
function hasBody(contentLength: string | undefined): boolean {
  if (!contentLength) return false
  const n = Number(contentLength)
  return Number.isFinite(n) && n > 0
}

export function isContentTypeAllowed(method: string, contentLength: string | undefined, contentType: string | undefined): boolean {
  if (!BODY_METHODS.has(method)) return true
  if (!hasBody(contentLength)) return true
  if (!contentType) return false
  const normalized = contentType.toLowerCase()
  return ALLOWED_CONTENT_TYPE_PREFIXES.some(prefix => normalized.startsWith(prefix))
}
