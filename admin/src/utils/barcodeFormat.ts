// نفس منطق server/src/services/barcodeService.ts بالضبط (detectBarcodeFormat) — مُكرَّر
// عمداً هنا على العميل، زي phone.ts المُكرَّر بالفعل بين المتجر/لوحة التحكم/السيرفر في نفس
// المشروع: دالة تحقق نقية صغيرة (مش بنية بحث/تطبيع معقّدة) لازم تشتغل فوراً في المتصفح
// وقت رسم الباركود، من غير رحلة شبكة لكل عنصر في قائمة الطباعة.
export type BarcodeFormat = 'ean13' | 'ean8' | 'code128'

export interface BarcodeDetection {
  format: BarcodeFormat
  checksumValid: boolean
}

function isDigitsOnly(s: string): boolean {
  return /^[0-9]+$/.test(s)
}

function eanChecksumValid(digits: string): boolean {
  const body = digits.slice(0, -1)
  const checkDigit = Number(digits[digits.length - 1])
  let sum = 0
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i])
    sum += digit * (i % 2 === 0 ? 3 : 1)
  }
  const calculated = (10 - (sum % 10)) % 10
  return calculated === checkDigit
}

export function detectBarcodeFormat(barcode: string): BarcodeDetection {
  if (isDigitsOnly(barcode) && barcode.length === 13) {
    return { format: 'ean13', checksumValid: eanChecksumValid(barcode) }
  }
  if (isDigitsOnly(barcode) && barcode.length === 8) {
    return { format: 'ean8', checksumValid: eanChecksumValid(barcode) }
  }
  return { format: 'code128', checksumValid: barcode.length > 0 }
}

export const JSBARCODE_FORMAT: Record<BarcodeFormat, string> = {
  ean13: 'EAN13',
  ean8: 'EAN8',
  code128: 'CODE128'
}
