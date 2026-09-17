import { describe, expect, it } from 'vitest'
import {
  computeDiscountAmount, validateDiscountAgainstSubtotal, eligibleCartItems, computeEligibleSubtotal,
  computeEligibleQuantity, type DiscountRow, type DiscountCartItem
} from './discounts.js'

function makeDiscount(overrides: Partial<DiscountRow> = {}): DiscountRow {
  return {
    code: 'TEST10',
    type: 'percentage',
    value: 10,
    minOrder: 0,
    maxUses: null,
    usedCount: 0,
    active: 1,
    expiresAt: null,
    createdAt: new Date().toISOString(),
    startsAt: null,
    scope: 'order',
    scopeId: null,
    minQuantity: null,
    firstOrderOnly: 0,
    freeDelivery: 0,
    maxUsesPerCustomer: null,
    ...overrides
  }
}

describe('computeDiscountAmount', () => {
  it('computes a percentage discount', () => {
    expect(computeDiscountAmount(makeDiscount({ type: 'percentage', value: 10 }), 200)).toBe(20)
  })

  it('computes a fixed discount', () => {
    expect(computeDiscountAmount(makeDiscount({ type: 'fixed', value: 20 }), 200)).toBe(20)
  })

  it('never exceeds the subtotal', () => {
    expect(computeDiscountAmount(makeDiscount({ type: 'fixed', value: 999 }), 50)).toBe(50)
  })

  it('rounds to the nearest piastre', () => {
    expect(computeDiscountAmount(makeDiscount({ type: 'percentage', value: 33.33 }), 10)).toBe(3.33)
  })
})

describe('validateDiscountAgainstSubtotal', () => {
  it('rejects a missing discount', () => {
    const result = validateDiscountAgainstSubtotal(undefined, 100)
    expect(result).toEqual({ ok: false, error: 'discount_not_found' })
  })

  it('rejects an inactive discount', () => {
    const result = validateDiscountAgainstSubtotal(makeDiscount({ active: 0 }), 100)
    expect(result).toEqual({ ok: false, error: 'discount_inactive' })
  })

  it('rejects an expired discount', () => {
    const result = validateDiscountAgainstSubtotal(makeDiscount({ expiresAt: '2000-01-01' }), 100)
    expect(result).toEqual({ ok: false, error: 'discount_expired' })
  })

  it('accepts a discount expiring in the future', () => {
    const result = validateDiscountAgainstSubtotal(makeDiscount({ expiresAt: '2099-01-01' }), 100)
    expect(result.ok).toBe(true)
  })

  it('rejects when max uses already reached', () => {
    const result = validateDiscountAgainstSubtotal(makeDiscount({ maxUses: 5, usedCount: 5 }), 100)
    expect(result).toEqual({ ok: false, error: 'discount_max_uses' })
  })

  it('accepts when under max uses', () => {
    const result = validateDiscountAgainstSubtotal(makeDiscount({ maxUses: 5, usedCount: 4 }), 100)
    expect(result.ok).toBe(true)
  })

  it('rejects below minimum order', () => {
    const result = validateDiscountAgainstSubtotal(makeDiscount({ minOrder: 200 }), 100)
    expect(result).toEqual({ ok: false, error: 'discount_min_order', minOrder: 200 })
  })

  it('accepts at exactly the minimum order', () => {
    const result = validateDiscountAgainstSubtotal(makeDiscount({ minOrder: 100 }), 100)
    expect(result.ok).toBe(true)
  })

  it('rejects a discount that has not started yet', () => {
    const result = validateDiscountAgainstSubtotal(makeDiscount({ startsAt: '2099-01-01' }), 100)
    expect(result).toEqual({ ok: false, error: 'discount_not_started' })
  })

  it('accepts a discount that already started', () => {
    const result = validateDiscountAgainstSubtotal(makeDiscount({ startsAt: '2000-01-01' }), 100)
    expect(result.ok).toBe(true)
  })

  it('rejects when the eligible quantity is below the minimum required', () => {
    const result = validateDiscountAgainstSubtotal(makeDiscount({ minQuantity: 3 }), 100, 100, 2)
    expect(result).toEqual({ ok: false, error: 'discount_min_quantity', minQuantity: 3 })
  })

  it('accepts when the eligible quantity meets the minimum required', () => {
    const result = validateDiscountAgainstSubtotal(makeDiscount({ minQuantity: 3 }), 100, 100, 3)
    expect(result.ok).toBe(true)
  })

  it('computes the amount from the eligible subtotal, not the whole-cart subtotal', () => {
    // نطاق مقيّد بفئة معيّنة، الإجمالي المؤهّل (50) أقل من إجمالي السلة كله (100) — المبلغ
    // لازم يتحسب من الـ 50 بس.
    const result = validateDiscountAgainstSubtotal(makeDiscount({ type: 'percentage', value: 10, scope: 'category', scopeId: 'cat-a' }), 100, 50)
    expect(result).toEqual({ ok: true, discount: expect.any(Object), amount: 5 })
  })
})

describe('eligibleCartItems / computeEligibleSubtotal / computeEligibleQuantity', () => {
  const items: DiscountCartItem[] = [
    { productId: 'p1', categoryId: 'cat-a', quantity: 2, unitPrice: 10 },
    { productId: 'p2', categoryId: 'cat-b', quantity: 3, unitPrice: 20 }
  ]

  it('an order-scoped discount treats the whole cart as eligible', () => {
    const discount = makeDiscount({ scope: 'order' })
    expect(eligibleCartItems(discount, items)).toEqual(items)
    expect(computeEligibleSubtotal(discount, items)).toBe(2 * 10 + 3 * 20)
    expect(computeEligibleQuantity(discount, items)).toBe(5)
  })

  it('a category-scoped discount only counts items in that category', () => {
    const discount = makeDiscount({ scope: 'category', scopeId: 'cat-b' })
    expect(eligibleCartItems(discount, items)).toEqual([items[1]])
    expect(computeEligibleSubtotal(discount, items)).toBe(60)
    expect(computeEligibleQuantity(discount, items)).toBe(3)
  })

  it('a product-scoped discount only counts that specific product', () => {
    const discount = makeDiscount({ scope: 'product', scopeId: 'p1' })
    expect(eligibleCartItems(discount, items)).toEqual([items[0]])
    expect(computeEligibleSubtotal(discount, items)).toBe(20)
    expect(computeEligibleQuantity(discount, items)).toBe(2)
  })

  it('a scoped discount with no matching items has zero eligible subtotal/quantity', () => {
    const discount = makeDiscount({ scope: 'product', scopeId: 'does-not-exist' })
    expect(computeEligibleSubtotal(discount, items)).toBe(0)
    expect(computeEligibleQuantity(discount, items)).toBe(0)
  })
})
