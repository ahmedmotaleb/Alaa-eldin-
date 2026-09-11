import type { Response } from 'express'

// كل رد /api/* بيتحدد افتراضياً Cache-Control: no-store (راجع index.ts) — الدوال دي
// بتتنادى داخل نفس الـ handler لتجاوز القيمة دي بس لـ endpoints عامة آمنة (بدون مصادقة،
// بدون بيانات مستخدم، بطيئة التغيّر). الكاش هنا public دايماً لأن الرد نفس القيمة لأي زائر.
export function setShortPublicCache(res: Response, maxAgeSeconds: number, staleWhileRevalidateSeconds?: number) {
  const directives = [`public`, `max-age=${maxAgeSeconds}`]
  if (staleWhileRevalidateSeconds) directives.push(`stale-while-revalidate=${staleWhileRevalidateSeconds}`)
  res.setHeader('Cache-Control', directives.join(', '))
}
