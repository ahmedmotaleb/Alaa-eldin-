// صور المنتجات مخزّنة كـ URL كامل من Cloudinary (بعد الرفع). عشان مانحملش صورة أصلية
// كبيرة على كارت صغير، بنحقن تحويل حجم/جودة داخل الرابط نفسه وقت العرض بس — الرابط
// المخزّن في قاعدة البيانات ما بيتغيرش. f_auto يخلي Cloudinary يختار WebP/AVIF حسب دعم
// المتصفح تلقائياً؛ q_auto يختار أفضل جودة/حجم متوازن.
export type ImageSize = 'thumbnail' | 'card' | 'detail'

const SIZE_WIDTH: Record<ImageSize, number> = {
  thumbnail: 200,
  card: 500,
  detail: 1000
}

// تحقق حقيقي بالـ URL parsing (host فعلي)، مش مجرد substring على "/upload/" زي قبل كده —
// رابط خارجي غريب (أو مستورد قديم) ممكن يحتوي "/upload/" في مساره بالصدفة من غير ما يكون
// رابط Cloudinary أصلاً، وكان بيتحقن فيه تحويل Cloudinary بالغلط فينتج رابط مكسور تماماً.
export function isCloudinaryDeliveryUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && (parsed.hostname === 'res.cloudinary.com' || parsed.hostname.endsWith('.cloudinary.com'))
  } catch {
    return false
  }
}

export function transformImage(url: string | undefined, size: ImageSize): string | undefined {
  if (!url) return undefined
  // مش رابط Cloudinary حقيقي — نرجّع الرابط الأصلي كما هو بدل ما نكسره بمحاولة تعديل غير آمنة.
  if (!isCloudinaryDeliveryUrl(url)) return url
  const marker = '/upload/'
  const idx = url.indexOf(marker)
  if (idx === -1) return url
  const transform = `w_${SIZE_WIDTH[size]},c_limit,f_auto,q_auto`
  return url.slice(0, idx + marker.length) + transform + '/' + url.slice(idx + marker.length)
}
