import { describe, expect, it } from 'vitest'
import { validateCheckoutInput } from './checkoutValidation.js'

const validCustomer = { fullName: 'عميل اختبار', mobile: '01012345678', governorate: 'القاهرة', address: 'شارع الاختبار رقم 1' }

function withCustomer(overrides: Partial<typeof validCustomer>) {
  return {
    deliverySlot: 'now' as const,
    paymentMethod: 'COD',
    customer: { ...validCustomer, ...overrides },
    items: [{ productId: 'p1', quantity: 1 }]
  }
}

describe('validateCheckoutInput', () => {
  it('accepts a well-formed request and strips it down to the safe shape', () => {
    const result = validateCheckoutInput({
      deliverySlot: 'now',
      paymentMethod: 'COD',
      customer: validCustomer,
      items: [{ productId: 'p1', quantity: 2 }]
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.items).toEqual([{ productId: 'p1', quantity: 2 }])
    }
  })

  // الاختبار المحوري: حتى لو العميل (متصفح متلاعب، مش تطبيقنا) بعت جسم JSON خام فيه
  // حقول فلوس زايفة، شكل البيانات اللي بيرجعها validateCheckoutInput لا يحتوي عليها إطلاقاً —
  // مفيش أي مسار ممكن ينقل unitPrice/subtotal/deliveryFee/total من الطلب لـ orderService.
  it('never lets client-submitted price fields through, even when present in the raw JSON', () => {
    const maliciousBody = {
      deliverySlot: 'now',
      paymentMethod: 'COD',
      customer: validCustomer,
      items: [{ productId: 'p1', quantity: 2, unitPrice: 0.01, lineTotal: 0.02, name: 'مزوّر', unit: 'وحدة' }],
      subtotal: 0.01,
      deliveryFee: 0,
      total: 0.01,
      discountCode: 'X'
    }
    const result = validateCheckoutInput(maliciousBody)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.items).toEqual([{ productId: 'p1', quantity: 2 }])
    expect('subtotal' in result.data).toBe(false)
    expect('deliveryFee' in result.data).toBe(false)
    expect('total' in result.data).toBe(false)
    expect((result.data.items[0] as unknown as Record<string, unknown>).unitPrice).toBeUndefined()
  })

  it('merges duplicate productId lines instead of locking the same product twice', () => {
    const result = validateCheckoutInput({
      deliverySlot: 'now',
      paymentMethod: 'COD',
      customer: validCustomer,
      items: [{ productId: 'p1', quantity: 2 }, { productId: 'p1', quantity: 3 }]
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.items).toEqual([{ productId: 'p1', quantity: 5 }])
  })

  it('rejects an unknown delivery slot', () => {
    const result = validateCheckoutInput({
      deliverySlot: 'yesterday',
      paymentMethod: 'COD',
      customer: validCustomer,
      items: [{ productId: 'p1', quantity: 1 }]
    })
    expect(result).toEqual({ ok: false, error: 'invalid_delivery_slot' })
  })

  it('rejects a payment method other than COD', () => {
    const result = validateCheckoutInput({
      deliverySlot: 'now',
      paymentMethod: 'CREDIT_CARD',
      customer: validCustomer,
      items: [{ productId: 'p1', quantity: 1 }]
    })
    expect(result).toEqual({ ok: false, error: 'payment_method_not_supported' })
  })

  it('rejects an empty items array', () => {
    const result = validateCheckoutInput({
      deliverySlot: 'now',
      paymentMethod: 'COD',
      customer: validCustomer,
      items: []
    })
    expect(result).toEqual({ ok: false, error: 'invalid_items' })
  })

  // ---- الحقول الإلزامية (الاسم/الموبايل/المحافظة/العنوان) ----

  it('rejects a missing name', () => {
    const result = validateCheckoutInput(withCustomer({ fullName: undefined as unknown as string }))
    expect(result).toEqual({ ok: false, error: 'customer_name_required' })
  })

  it('rejects a blank (whitespace-only) name', () => {
    const result = validateCheckoutInput(withCustomer({ fullName: '   ' }))
    expect(result).toEqual({ ok: false, error: 'customer_name_required' })
  })

  it('rejects a single-character name (below minimum length)', () => {
    const result = validateCheckoutInput(withCustomer({ fullName: 'ا' }))
    expect(result).toEqual({ ok: false, error: 'customer_name_required' })
  })

  it('rejects a missing phone', () => {
    const result = validateCheckoutInput(withCustomer({ mobile: undefined as unknown as string }))
    expect(result).toEqual({ ok: false, error: 'customer_mobile_required' })
  })

  it('rejects a blank phone', () => {
    const result = validateCheckoutInput(withCustomer({ mobile: '   ' }))
    expect(result).toEqual({ ok: false, error: 'customer_mobile_required' })
  })

  it('rejects an invalid phone (wrong length)', () => {
    const result = validateCheckoutInput(withCustomer({ mobile: '0101234567' }))
    expect(result).toEqual({ ok: false, error: 'customer_mobile_invalid' })
  })

  // القاعدة الحرجة الجديدة: أرقام +20/20 الدولية بقت مرفوضة تماماً، ومفيش أي تحويل تلقائي
  // ليها — العميل لازم يدخل الرقم بالصيغة المحلية المصرية من الأساس.
  it('rejects the +20 international format instead of silently converting it', () => {
    const result = validateCheckoutInput(withCustomer({ mobile: '+201012345678' }))
    expect(result).toEqual({ ok: false, error: 'customer_mobile_invalid' })
  })

  it('rejects the 20 international format without a plus sign', () => {
    const result = validateCheckoutInput(withCustomer({ mobile: '201012345678' }))
    expect(result).toEqual({ ok: false, error: 'customer_mobile_invalid' })
  })

  it('rejects a missing governorate', () => {
    const result = validateCheckoutInput(withCustomer({ governorate: undefined as unknown as string }))
    expect(result).toEqual({ ok: false, error: 'customer_governorate_required' })
  })

  it('rejects a blank governorate', () => {
    const result = validateCheckoutInput(withCustomer({ governorate: '   ' }))
    expect(result).toEqual({ ok: false, error: 'customer_governorate_required' })
  })

  it('rejects a missing address', () => {
    const result = validateCheckoutInput(withCustomer({ address: undefined as unknown as string }))
    expect(result).toEqual({ ok: false, error: 'customer_address_required' })
  })

  it('rejects a blank (whitespace-only) address', () => {
    const result = validateCheckoutInput(withCustomer({ address: '     ' }))
    expect(result).toEqual({ ok: false, error: 'customer_address_required' })
  })

  it('rejects an address below the minimum sensible length', () => {
    const result = validateCheckoutInput(withCustomer({ address: 'شق' }))
    expect(result).toEqual({ ok: false, error: 'customer_address_required' })
  })

  it('accepts a fully valid request with all mandatory fields present', () => {
    const result = validateCheckoutInput(withCustomer({}))
    expect(result.ok).toBe(true)
  })
})
