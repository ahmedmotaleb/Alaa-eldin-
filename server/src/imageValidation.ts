// تحقق مشترك من ملفات الصور المرفوعة (المنتجات، ومرفقات تذاكر الدعم) — قيد واحد بدل ما كل
// مكان يعرّف قائمة MIME/حجم/magic bytes بتاعته لوحده. ما بيثقش في mimetype اللي بيبعتها
// المتصفح لوحدها — بيتأكد كمان من الـ magic bytes الحقيقية للملف عشان يمنع ملف متنكر.
export const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff])
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const WEBP_RIFF = Buffer.from('RIFF')
const WEBP_TAG = Buffer.from('WEBP')

export function isRealImage(buffer: Buffer, mimetype: string): boolean {
  if (buffer.length < 12) return false
  if (mimetype === 'image/jpeg') return buffer.subarray(0, 3).equals(JPEG_MAGIC)
  if (mimetype === 'image/png') return buffer.subarray(0, 4).equals(PNG_MAGIC)
  if (mimetype === 'image/webp') return buffer.subarray(0, 4).equals(WEBP_RIFF) && buffer.subarray(8, 12).equals(WEBP_TAG)
  return false
}
