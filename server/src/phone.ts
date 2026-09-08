// توحيد صيغ الموبايل المصري الشائعة (01xxxxxxxxx / +201xxxxxxxxx / 201xxxxxxxxx) لتمثيل
// واحد ثابت قبل التخزين: 01 + بادئة الشبكة (0/1/2/5) + 8 أرقام = 11 رقم بالظبط.
const EGY_MOBILE_RE = /^(?:\+?20)?(?:0)?1([0125]\d{8})$/

export function normalizeEgyptianMobile(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, '')
  const match = digits.match(EGY_MOBILE_RE)
  return match ? `01${match[1]}` : null
}
