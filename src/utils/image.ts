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

export function transformImage(url: string | undefined, size: ImageSize): string | undefined {
  if (!url) return undefined
  const marker = '/upload/'
  const idx = url.indexOf(marker)
  // مش رابط Cloudinary متوقع الشكل (أو رابط مختلف تماماً) — نرجّع الرابط الأصلي كما هو
  // بدل ما نكسره بمحاولة تعديل غير آمنة.
  if (idx === -1) return url
  const transform = `w_${SIZE_WIDTH[size]},c_limit,f_auto,q_auto`
  return url.slice(0, idx + marker.length) + transform + '/' + url.slice(idx + marker.length)
}
