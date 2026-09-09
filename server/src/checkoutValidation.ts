import { isValidEgyptianMobile } from './phone.js'

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
  deliverySlot: string
  paymentMethod: string
  customer: CheckoutCustomerInput
  items: CheckoutItemInput[]
  discountCode?: string
}

export type CheckoutValidationError =
  | 'invalid_request'
  | 'customer_name_required'
  | 'customer_mobile_required'
  | 'customer_mobile_invalid'
  | 'customer_governorate_required'
  | 'customer_address_required'
  | 'invalid_delivery_slot'
  | 'payment_method_not_supported'
  | 'invalid_items'
  | 'invalid_discount_code'

export type CheckoutValidationResult =
  | { ok: true, data: CheckoutInput }
  | { ok: false, error: CheckoutValidationError }

const MAX_ITEM_LINES = 100
const NAME_MIN_LENGTH = 2
const NAME_MAX_LENGTH = 100
const ADDRESS_MIN_LENGTH = 5
const ADDRESS_MAX_LENGTH = 300

export function validateCheckoutInput(body: unknown): CheckoutValidationResult {
  const b = body as Record<string, unknown> | null
  if (!b || typeof b !== 'object') return { ok: false, error: 'invalid_request' }

  const customer = b.customer as Record<string, unknown> | undefined
  if (!customer || typeof customer !== 'object') return { ok: false, error: 'invalid_request' }

  // الاسم: إلزامي، بدون فراغات زيادة، بحد أدنى وأقصى منطقيين.
  const rawName = typeof customer.fullName === 'string' ? customer.fullName.trim() : ''
  if (!rawName || rawName.length < NAME_MIN_LENGTH || rawName.length > NAME_MAX_LENGTH) {
    return { ok: false, error: 'customer_name_required' }
  }

  // الموبايل: لازم صيغة مصرية محلية صحيحة بالظبط — مفيش أي تحويل تلقائي لصيغة +20/20،
  // ولا قبول جزئي لأي صيغة تانية. الفراغ يترفض بكود مختلف عن الصيغة الخاطئة عشان رسالة
  // الخطأ في الواجهة تبقى دقيقة (رقم مطلوب مقابل رقم غير صحيح).
  const rawMobile = typeof customer.mobile === 'string' ? customer.mobile.trim() : ''
  if (!rawMobile) return { ok: false, error: 'customer_mobile_required' }
  if (!isValidEgyptianMobile(rawMobile)) return { ok: false, error: 'customer_mobile_invalid' }

  // المحافظة: إلزامية زي ما كانت دايماً.
  const rawGovernorate = typeof customer.governorate === 'string' ? customer.governorate.trim() : ''
  if (!rawGovernorate) return { ok: false, error: 'customer_governorate_required' }

  // العنوان: إلزامي، بدون فراغات زيادة، بحد أدنى وأقصى منطقيين (مش مجرد فراغات).
  const rawAddress = typeof customer.address === 'string' ? customer.address.trim() : ''
  if (!rawAddress || rawAddress.length < ADDRESS_MIN_LENGTH || rawAddress.length > ADDRESS_MAX_LENGTH) {
    return { ok: false, error: 'customer_address_required' }
  }

  // الشكل بس بيتحقق هنا (نص مش فاضي) — الوجود الفعلي والتفعيل بيتأكد منه من قاعدة البيانات
  // جوه orderService.createOrder، زي أي حالة تانية محتاجة قراءة حالة حالية (المخزون، الخصم).
  const rawDeliverySlot = typeof b.deliverySlot === 'string' ? b.deliverySlot.trim() : ''
  if (!rawDeliverySlot) {
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

  return {
    ok: true,
    data: {
      deliverySlot: rawDeliverySlot,
      paymentMethod: PAYMENT_METHOD_COD,
      customer: {
        fullName: rawName,
        mobile: rawMobile,
        governorate: rawGovernorate,
        address: rawAddress
      },
      items: Array.from(mergedItems, ([productId, quantity]) => ({ productId, quantity })),
      discountCode: typeof b.discountCode === 'string' ? b.discountCode.trim() : undefined
    }
  }
}
