// منطق فحص "هل المسار ده شكله زي فحص أمني/بنية تحتية" — مفصول في دالة صرفة عشان يتقدر
// يتفحص بوحدة اختبار حقيقية، نفس مبدأ csrfOriginCheck.ts وcontentTypeCheck.ts. بيُستخدم
// في fallback الـ SPA بس (app.ts) عشان مسارات زي /.git/config أو /server/ ترجع 404 حقيقي
// بدل صفحة index.html العامة بـ 200 — مفيش أي محتوى حقيقي بيتسرب أصلاً (الملفات دي مش
// موجودة جوه مجلد الـ static)، لكن رجوع 200 لمسارات زي دي بيربك أي فحص أمني آلي بيدور
// على نقاط دخول حقيقية.
const SENSITIVE_FIRST_SEGMENTS = new Set(['server', 'logs', 'backup', 'node_modules'])

export function isSensitivePath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.some(seg => seg.startsWith('.'))) return true
  // أول قطعة غير "admin" (لو المسار جوه /admin/...) — عشان /admin/server يتفحص زي /server بالظبط.
  const first = segments[0] === 'admin' ? segments[1] : segments[0]
  return first ? SENSITIVE_FIRST_SEGMENTS.has(first) : false
}
