import { describe, expect, it } from 'vitest'
import { calculateDeliveryFee, computeLineTotal, computeSubtotal, computeTotal, toEgp, toPiastres } from './pricingService.js'

describe('pricingService', () => {
  it('converts EGP to piastres and back without drift', () => {
    expect(toPiastres(45.5)).toBe(4550)
    expect(toEgp(4550)).toBe(45.5)
  })

  it('computes a line total from unit price and quantity', () => {
    expect(computeLineTotal(38, 5)).toBe(190)
  })

  // 0.1 + 0.2 !== 0.3 في float عادي — هنا لازم يطلع بالظبط 0.3
  it('avoids classic binary floating-point drift on repeated addition', () => {
    const subtotal = computeSubtotal([
      { unitPrice: 0.1, quantity: 1 },
      { unitPrice: 0.2, quantity: 1 }
    ])
    expect(subtotal).toBe(0.3)
  })

  it('sums many fractional line items without accumulating rounding error', () => {
    const lines = Array.from({ length: 7 }, () => ({ unitPrice: 19.99, quantity: 3 }))
    const subtotal = computeSubtotal(lines)
    expect(subtotal).toBeCloseTo(419.79, 5)
    expect(subtotal).toBe(419.79)
  })

  describe('calculateDeliveryFee', () => {
    const settings = { freeShippingThreshold: 500, deliveryFee: 30 }

    it('is free for an empty cart', () => {
      expect(calculateDeliveryFee(0, settings)).toBe(0)
    })

    it('charges the standard fee below the free-shipping threshold', () => {
      expect(calculateDeliveryFee(499.99, settings)).toBe(30)
    })

    it('is free exactly at the threshold', () => {
      expect(calculateDeliveryFee(500, settings)).toBe(0)
    })

    it('is free above the threshold', () => {
      expect(calculateDeliveryFee(1000, settings)).toBe(0)
    })
  })

  describe('computeTotal', () => {
    it('subtracts discount then adds delivery fee', () => {
      expect(computeTotal(190, 20, 30)).toBe(200)
    })

    it('never goes negative even if discount exceeds subtotal', () => {
      expect(computeTotal(50, 999, 30)).toBe(30)
    })

    it('handles zero discount and zero delivery fee', () => {
      expect(computeTotal(500, 0, 0)).toBe(500)
    })
  })
})
