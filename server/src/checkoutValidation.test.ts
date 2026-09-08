import { describe, expect, it } from 'vitest'
import { validateCheckoutInput } from './checkoutValidation.js'

const validCustomer = { fullName: 'عميل اختبار', mobile: '01012345678', governorate: 'القاهرة', address: 'شارع 1' }

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

  it('rejects missing customer fields', () => {
    const result = validateCheckoutInput({
      deliverySlot: 'now',
      paymentMethod: 'COD',
      customer: { fullName: '', mobile: '01012345678', governorate: 'القاهرة', address: 'شارع 1' },
      items: [{ productId: 'p1', quantity: 1 }]
    })
    expect(result).toEqual({ ok: false, error: 'invalid_request' })
  })

  it('normalizes a valid Egyptian mobile number', () => {
    const result = validateCheckoutInput({
      deliverySlot: 'now',
      paymentMethod: 'COD',
      customer: { ...validCustomer, mobile: '+20 101 234 5678' },
      items: [{ productId: 'p1', quantity: 1 }]
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.customer.mobile).toBe('01012345678')
  })
})
