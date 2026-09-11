// مصدر الحقيقة الوحيد لأصل المتجر العام (canonical origin) — مُستخدم في sitemap.xml،
// robots.txt، رابط استعادة كلمة المرور، وأي مكان تاني محتاج رابط مطلق للمتجر. لو صاحب
// المتجر ربط دومين مخصص، تغيير PUBLIC_APP_URL بس كفاية عشان كل الأماكن دي تتظبط تلقائياً
// من غير أي تعديل كود، ومن غير ما نخلط أكتر من أصل واحد في نفس الوقت.
const DEFAULT_PUBLIC_APP_URL = 'http://localhost:5173'

// بيشيل أي "/" زيادة في الآخر (تهيئة خاطئة زي "https://example.com/") عشان الروابط
// المبنية بإلحاق "/path" بعد الأصل ما تطلعش فيها "//" مزدوجة.
export function publicOrigin(): string {
  const raw = process.env.PUBLIC_APP_URL ?? DEFAULT_PUBLIC_APP_URL
  return raw.replace(/\/+$/, '')
}
