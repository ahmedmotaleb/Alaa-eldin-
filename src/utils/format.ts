// معيار التنسيق الموحّد للمشروع كله: نص عربي، أرقام غربية دايماً (0-9)، مش أرقام هندية/فارسية
// شرقية (٠-٩). 'ar-EG' لوحدها بترجع أرقام شرقية افتراضياً في أغلب المتصفحات (Chrome على
// أندرويد بلغة عربية تحديداً) — امتداد Unicode -u-nu-latn بيجبر نظام الأرقام يبقى لاتيني
// مع الحفاظ على كل الصياغة العربية (أسماء الشهور، ص/م...إلخ) زي ما هي.
const NUMERIC_LOCALE = 'ar-EG-u-nu-latn'

const EASTERN_TO_WESTERN: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
}

// شبكة أمان أخيرة: بتحوّل أي رقم هندي/فارسي شارد لرقم غربي — مفيش أي مصدر معروف في المشروع
// بيولّد أرقام هندية غير الأماكن اللي بنصلحها هنا، لكن الدالة دي بتغطي أي مصدر مستقبلي
// (بيانات مُدخلة يدوياً، نسخ/لصق من مصدر خارجي...إلخ).
export function toWesternDigits(input: string): string {
  return input.replace(/[٠-٩]/g, d => EASTERN_TO_WESTERN[d] ?? d)
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(NUMERIC_LOCALE, options).format(value)
}

export function formatCurrency(value: number, currency: string): string {
  return `${formatNumber(Math.round(value))} ${currency}`
}

export function formatPercent(value: number): string {
  return `${formatNumber(value)}%`
}

export function formatQuantity(value: number): string {
  return formatNumber(value)
}

export function formatPhone(value: string): string {
  return toWesternDigits(value)
}

export function formatDate(value: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat(NUMERIC_LOCALE, options ?? { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

export function formatTime(value: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat(NUMERIC_LOCALE, options ?? { hour: 'numeric', minute: '2-digit' }).format(date)
}

export function formatDateTime(value: string | Date): string {
  return `${formatDate(value)} ${formatTime(value)}`
}

// بيحوّل وقت "HH:MM" (24 ساعة، من إعدادات المتجر) لنص عربي مقروء — مُستخدم في بانر "اطلب
// قبل" على الصفحة الرئيسية. حالات خاصة لمنتصف الليل والظهر بدل "12 مساءً"/"12 صباحاً" الملتبسة.
export function formatCutoffTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (h === 0 && m === 0) return 'منتصف الليل'
  if (h === 12 && m === 0) return 'الظهر'
  const period = h < 12 ? 'صباحاً' : 'مساءً'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  const hourText = formatNumber(hour12)
  return m === 0 ? `${hourText} ${period}` : `${hourText}:${String(m).padStart(2, '0')} ${period}`
}

// فحص تقريبي من جوه المتصفح بس (لعرض نص إرشادي زي بانر الصفحة الرئيسية) — مش المرجع الفعلي
// لقبول/رفض طلب. المرجع الحقيقي الوحيد لإتاحة توصيل نفس اليوم هو السيرفر (GET
// /api/delivery/availability وقت الإنشاء الفعلي للطلب)، اللي بيستخدم توقيت القاهرة من
// Intl.DateTimeFormat بدل أي حساب يدوي UTC+2/+3 — نفس المنطق هنا لتجنب اختلاف يدوي عن
// السيرفر، لكن بيفضل بس تلميح واجهة، مش بوابة أمنية.
export function isPastCairoCutoff(hhmm: string): boolean {
  const [cutoffH, cutoffM] = hhmm.split(':').map(Number)
  if (!Number.isFinite(cutoffH) || !Number.isFinite(cutoffM)) return false
  const cutoffMinutes = cutoffH * 60 + cutoffM
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const nowH = Number(parts.find(p => p.type === 'hour')?.value ?? '0')
  const nowM = Number(parts.find(p => p.type === 'minute')?.value ?? '0')
  const nowMinutes = nowH * 60 + nowM
  return nowMinutes >= cutoffMinutes
}
