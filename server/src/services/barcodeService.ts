// خدمة الباركود — التحقق من صيغة أي باركود موجود بالفعل (بدون توليده تاني أبداً)، وتوليد
// باركود داخلي جديد بس لما يكون مفقود. المتجر مالوش بادئة GS1 حقيقية مُسجّلة، فتوليد أرقام
// EAN-13/EAN-8 مزيّفة هيخاطر بتعارض مع منتجات حقيقية عالمياً — عشان كده كل كود بيتولّد هنا
// داخلياً بصيغة Code128 نصية-رقمية واضحة (بادئة BC-)، مش EAN. أي باركود EAN موجود بالفعل
// (من منتج حقيقي مستورد مثلاً) بيتفحص ويتحقق من الـ checksum بتاعه، لكن أبداً ما بيتغيرش.
import { pool } from '../db.js'

export type BarcodeFormat = 'ean13' | 'ean8' | 'code128'

export interface BarcodeDetection {
  format: BarcodeFormat
  // للـ EAN فقط: هل الـ checksum صحيح فعلاً. Code128 مفيش checksum قياسي معروض هنا
  // (مكتبة الرسم بتحسبه تلقائياً وقت العرض)، فبترجع true طالما النص مش فاضي.
  checksumValid: boolean
}

function isDigitsOnly(s: string): boolean {
  return /^[0-9]+$/.test(s)
}

// خوارزمية GS1 القياسية لحساب رقم التحقق (check digit) لـ EAN-13/EAN-8 — من اليمين لليسار
// بأوزان متبادلة 3،1،3،1...
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

export interface BarcodeUpdateResult {
  id: string
  barcode: string
}

function isUniqueBarcodeViolation(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as { code: string }).code === '23505'
}

// أقصى عدد محاولات لو حصل تعارض تفرّد نادر جداً وقت التوليد المتزامن (احتمال شبه معدوم
// بصيغة sequence، لكن نفس مبدأ "التعامل الآمن مع التوليد المتزامن" المطلوب صراحة).
const MAX_GENERATE_ATTEMPTS = 3

async function nextInternalBarcode(): Promise<string> {
  const { rows } = await pool.query<{ n: number }>("SELECT nextval('product_barcode_seq') as n")
  return `BC-${String(rows[0].n).padStart(6, '0')}`
}

// تعديل الباركود يدوياً بأي قيمة (بما فيها مسحه) بيتم أصلاً عن طريق مسار تعديل المنتج/المتغير
// العام الموجود بالفعل (adminProducts.ts) — مفيش داعي لمسار منفصل هنا. الدالة دي مسؤولة بس
// عن التوليد التلقائي، وهي القدرة الجديدة الوحيدة المطلوبة فعلاً.

// بيولّد باركود داخلي جديد بس لو مفقود، إلا لو confirmOverwrite=true صراحة — أبداً ما بيكتبش
// فوق باركود موجود بصمت.
export async function generateBarcodeForProduct(
  productId: string, confirmOverwrite = false
): Promise<BarcodeUpdateResult | { error: string }> {
  const { rows: existingRows } = await pool.query<{ barcode: string }>(
    'SELECT barcode FROM products WHERE id = $1', [productId]
  )
  if (!existingRows[0]) return { error: 'product_not_found' }
  if (existingRows[0].barcode && !confirmOverwrite) return { error: 'barcode_already_set' }

  for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
    const barcode = await nextInternalBarcode()
    try {
      const { rows } = await pool.query<BarcodeUpdateResult>(
        'UPDATE products SET barcode = $2 WHERE id = $1 RETURNING id, barcode',
        [productId, barcode]
      )
      return rows[0]
    } catch (err) {
      if (!isUniqueBarcodeViolation(err) || attempt === MAX_GENERATE_ATTEMPTS - 1) throw err
    }
  }
  throw new Error('barcode_generation_failed')
}

export async function generateBarcodeForVariant(
  variantId: string, confirmOverwrite = false
): Promise<BarcodeUpdateResult | { error: string }> {
  const { rows: existingRows } = await pool.query<{ barcode: string }>(
    'SELECT barcode FROM product_variants WHERE id = $1', [variantId]
  )
  if (!existingRows[0]) return { error: 'variant_not_found' }
  if (existingRows[0].barcode && !confirmOverwrite) return { error: 'barcode_already_set' }

  for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
    const barcode = await nextInternalBarcode()
    try {
      const { rows } = await pool.query<BarcodeUpdateResult>(
        'UPDATE product_variants SET barcode = $2 WHERE id = $1 RETURNING id, barcode',
        [variantId, barcode]
      )
      return rows[0]
    } catch (err) {
      if (!isUniqueBarcodeViolation(err) || attempt === MAX_GENERATE_ATTEMPTS - 1) throw err
    }
  }
  throw new Error('barcode_generation_failed')
}
