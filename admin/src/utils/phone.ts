// نفس قاعدة السيرفر بالظبط (server/src/phone.ts) — بادئة 01 + رمز شبكة (0/1/2/5) + 8 أرقام
// = 11 رقم بالظبط، أرقام غربية فقط. الصيغة الدولية (+20/20/0020) مرفوضة ومفيش تحويل تلقائي
// ليها — هذا التحقق للواجهة فقط (تجربة استخدام أسرع)، والتحقق الفعلي والنهائي دايماً في السيرفر.
const EGY_MOBILE_RE = /^01[0125][0-9]{8}$/

export function isValidEgyptianMobile(phone: string): boolean {
  return typeof phone === 'string' && EGY_MOBILE_RE.test(phone)
}

// تحويل للصيغة الدولية بدون علامة + — لازم فقط وقت بناء رابط/وجهة واتساب، مش للتخزين.
export function toWhatsAppInternational(phone: string): string {
  if (!isValidEgyptianMobile(phone)) return phone
  return `20${phone.slice(1)}`
}
