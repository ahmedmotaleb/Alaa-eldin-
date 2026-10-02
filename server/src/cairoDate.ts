// كل "تواريخ التوصيل" في النظام (delivery_date، delivery_date_overrides، سعة الميعاد
// بتاريخ) بتتفسّر دايماً كتواريخ تقويمية بتوقيت القاهرة (Africa/Cairo) — بغض النظر عن
// المنطقة الزمنية اللي السيرفر نفسه شغّال بيها فعلياً (عادة UTC على Railway). الدالتين
// اللي بيتحسب فيهم "التاريخ الحالي فعلياً" (todayInCairo) بيستخدموا Intl.DateTimeFormat
// مع منطقة زمنية صريحة؛ أما حسابات التقويم الصرفة على نص تاريخ موجود بالفعل (يوم الأسبوع،
// إضافة أيام) فبتتم كحساب تقويمي بحت من غير أي تحويل منطقة زمنية إضافية، عشان تفضل نفس
// اليوم اللي العميل شافه بالظبط.

const CAIRO_TZ = 'Africa/Cairo'
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isValidCalendarDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

// "النهاردة" فعلياً بتوقيت القاهرة، كنص YYYY-MM-DD — ده بيعتمد على الوقت الحقيقي دلوقتي،
// عكس باقي الدوال اللي بتحسب على نص تاريخ ثابت من غير أي اعتماد على "دلوقتي".
export function todayInCairo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CAIRO_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

// دقائق منذ منتصف الليل بتوقيت القاهرة دلوقتي (مثال: 18:30 => 1110) — بيستخدم
// Intl.DateTimeFormat مع timeZone صريح بدل أي حساب يدوي UTC+2/+3، عشان قاعدة التوقيت
// الصيفي المصرية (اللي اتغيّرت تاريخياً أكتر من مرة) تتطبّق صح دايماً من غير ما الكود
// يعرف تفاصيلها بنفسه.
export function currentMinutesInCairo(): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: CAIRO_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0')
  return hour * 60 + minute
}

// بيحوّل نص "HH:MM" (زي إعداد آخر ميعاد توصيل نفس اليوم) لعدد دقائق منذ منتصف الليل —
// null لو النص مش بصيغة صحيحة، عشان الاستدعاء يقدر يتعامل مع قيمة فاسدة بدفاعية (من غير
// NaN بيتسرب لمقارنات لاحقة).
export function hhmmToMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

// يوم الأسبوع بمعيار ISO (1=الاثنين ... 7=الأحد) لتاريخ تقويمي معين — بيتحسب من غير أي
// تحويل منطقة زمنية (التاريخ نص صريح زي "2026-09-17"، مفيش وقت أو منطقة زمنية فيه أصلاً).
export function isoWeekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return day === 0 ? 7 : day
}

// يضيف عدد أيام تقويمية (ممكن يكون سالب) لتاريخ معين، بيرجع نص YYYY-MM-DD جديد.
export function addCalendarDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

// قايمة نصوص تواريخ من تاريخ البداية شاملاً لعدد أيام معين.
export function nextCalendarDates(startDateStr: string, count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => addCalendarDays(startDateStr, i))
}

export function parseClosedWeekdays(raw: string): number[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 7)
}

export function serializeClosedWeekdays(weekdays: number[]): string {
  const unique = Array.from(new Set(weekdays.filter(n => Number.isInteger(n) && n >= 1 && n <= 7))).sort((a, b) => a - b)
  return unique.join(',')
}
