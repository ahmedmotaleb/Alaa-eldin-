// كل حسابات الفلوس هنا بتتم بالقرش الصحيح (integer piastres) بدل الجنيه العشري (float) —
// جمع/طرح متكرر على float عادي ممكن ينتج أخطاء تقريب حقيقية (0.1 + 0.2 !== 0.3 في JS).
// القيم بتدخل/تخرج بالجنيه (نفس شكل NUMERIC(12,2) في القاعدة)، لكن أي عملية حسابية
// وسيطة بتتحول لقرش صحيح الأول.

export function toPiastres(egp: number): number {
  return Math.round(egp * 100)
}

export function toEgp(piastres: number): number {
  return piastres / 100
}

export interface PricedLineInput {
  unitPrice: number
  quantity: number
}

export function computeLineTotal(unitPrice: number, quantity: number): number {
  return toEgp(toPiastres(unitPrice) * quantity)
}

export function computeSubtotal(lines: PricedLineInput[]): number {
  const totalPiastres = lines.reduce((sum, line) => sum + toPiastres(line.unitPrice) * line.quantity, 0)
  return toEgp(totalPiastres)
}

export interface DeliverySettings {
  freeShippingThreshold: number
  deliveryFee: number
}

// معزولة في دالة مستقلة عمداً — عشان أي منطق شحن مستقبلي أكثر تعقيداً (مناطق توصيل مختلفة
// بأسعار مختلفة مثلاً) يقدر يستبدل الجسم من غير ما يغيّر باقي خدمة التسعير.
export function calculateDeliveryFee(subtotal: number, settings: DeliverySettings): number {
  if (subtotal <= 0) return 0
  return subtotal >= settings.freeShippingThreshold ? 0 : settings.deliveryFee
}

export function computeTotal(subtotal: number, discountAmount: number, deliveryFee: number): number {
  const afterDiscountPiastres = Math.max(0, toPiastres(subtotal) - toPiastres(discountAmount))
  const totalPiastres = afterDiscountPiastres + toPiastres(deliveryFee)
  return toEgp(totalPiastres)
}
