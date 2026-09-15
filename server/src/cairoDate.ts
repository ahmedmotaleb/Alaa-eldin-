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
