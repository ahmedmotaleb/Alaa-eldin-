import { normalizeEgyptianMobile } from './phone.js'

export const DELIVERY_SLOTS = ['now', 'evening', 'tomorrow'] as const
export type DeliverySlotId = typeof DELIVERY_SLOTS[number]

// الدفع عند الاستلام هو الطريقة الوحيدة المدعومة فعلياً حالياً.
export const PAYMENT_METHOD_COD = 'COD'

export interface CheckoutItemInput {
  productId: string
  quantity: number
}

export interface CheckoutCustomerInput {
  fullName: string
  mobile: string
  governorate: string
  address: string
}

export interface CheckoutInput {
  deliverySlot: DeliverySlotId
  paymentMethod: string
  customer: CheckoutCustomerInput
  items: CheckoutItemInput[]
  discountCode?: string
}

export type CheckoutValidationError =
  | 'invalid_request'
  | 'invalid_delivery_slot'
  | 'payment_method_not_supported'
  | 'invalid_items'
  | 'invalid_discount_code'

export type CheckoutValidationResult =
  | { ok: true, data: CheckoutInput }
  | { ok: false, error: CheckoutValidationError }

const MAX_ITEM_LINES = 100

export function validateCheckoutInput(body: unknown): CheckoutValidationResult {
  const b = body as Record<string, unknown> | null
  if (!b || typeof b !== 'object') return { ok: false, error: 'invalid_request' }

  const customer = b.customer as Record<string, unknown> | undefined
  if (
    !customer ||
    typeof customer.fullName !== 'string' || !customer.fullName.trim() ||
    typeof customer.mobile !== 'string' || !customer.mobile.trim() ||
    typeof customer.governorate !== 'string' || !customer.governorate.trim() ||
    typeof customer.address !== 'string' || !customer.address.trim()
  ) {
    return { ok: false, error: 'invalid_request' }
  }

  if (typeof b.deliverySlot !== 'string' || !DELIVERY_SLOTS.includes(b.deliverySlot as DeliverySlotId)) {
    return { ok: false, error: 'invalid_delivery_slot' }
  }

  if (typeof b.paymentMethod !== 'string' || b.paymentMethod.toUpperCase() !== PAYMENT_METHOD_COD) {
    return { ok: false, error: 'payment_method_not_supported' }
  }

  if (
    !Array.isArray(b.items) || b.items.length === 0 || b.items.length > MAX_ITEM_LINES ||
    !b.items.every(item =>
      item && typeof item === 'object' &&
      typeof (item as Record<string, unknown>).productId === 'string' && (item as Record<string, unknown>).productId &&
      typeof (item as Record<string, unknown>).quantity === 'number'
    )
  ) {
    return { ok: false, error: 'invalid_items' }
  }

  if (b.discountCode !== undefined && (typeof b.discountCode !== 'string' || !b.discountCode.trim())) {
    return { ok: false, error: 'invalid_discount_code' }
  }

  // يدمج أي عناصر بنفس productId مكرّرة (بدل ما يرفض الطلب أو يقفل نفس المنتج مرتين).
  const mergedItems = new Map<string, number>()
  for (const item of b.items as CheckoutItemInput[]) {
    mergedItems.set(item.productId, (mergedItems.get(item.productId) ?? 0) + item.quantity)
  }

  // الموبايل: لو الصيغة معروفة (مصري) بيتوحّد لشكل قياسي؛ لو مش معروفة، بنسيبه زي ما هو
  // بدل ما نرفض الطلب كله بسبب صيغة رقم غير متوقعة (قد يكون رقم حقيقي بصيغة نادرة).
  const normalizedMobile = normalizeEgyptianMobile(customer.mobile.trim()) ?? customer.mobile.trim()

  return {
    ok: true,
    data: {
      deliverySlot: b.deliverySlot as DeliverySlotId,
      paymentMethod: PAYMENT_METHOD_COD,
      customer: {
        fullName: customer.fullName.trim(),
        mobile: normalizedMobile,
        governorate: customer.governorate.trim(),
        address: customer.address.trim()
      },
      items: Array.from(mergedItems, ([productId, quantity]) => ({ productId, quantity })),
      discountCode: typeof b.discountCode === 'string' ? b.discountCode.trim() : undefined
    }
  }
}
