import { describe, expect, it } from 'vitest'
import { computeDiscountAmount, validateDiscountAgainstSubtotal, type DiscountRow } from './discounts.js'

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
})
