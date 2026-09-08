import { describe, expect, it } from 'vitest'
import { canTransitionOrderStatus, isValidOrderStatus } from './orderStatus.js'

describe('isValidOrderStatus', () => {
  it('accepts known statuses', () => {
    expect(isValidOrderStatus('placed')).toBe(true)
    expect(isValidOrderStatus('delivered')).toBe(true)
  })

  it('rejects unknown values', () => {
    expect(isValidOrderStatus('shipped')).toBe(false)
    expect(isValidOrderStatus(123)).toBe(false)
    expect(isValidOrderStatus(undefined)).toBe(false)
  })
})

describe('canTransitionOrderStatus', () => {
  it('allows normal forward progress', () => {
    expect(canTransitionOrderStatus('placed', 'preparing')).toBe(true)
    expect(canTransitionOrderStatus('preparing', 'out_for_delivery')).toBe(true)
  })

  it('allows cancelling an active order', () => {
    expect(canTransitionOrderStatus('placed', 'cancelled')).toBe(true)
  })

  it('blocks leaving a delivered order to any other state', () => {
    expect(canTransitionOrderStatus('delivered', 'cancelled')).toBe(false)
    expect(canTransitionOrderStatus('delivered', 'placed')).toBe(false)
  })

  it('blocks leaving a cancelled order to any other state', () => {
    expect(canTransitionOrderStatus('cancelled', 'delivered')).toBe(false)
    expect(canTransitionOrderStatus('cancelled', 'placed')).toBe(false)
  })

  it('allows a no-op transition to the same terminal state', () => {
    expect(canTransitionOrderStatus('cancelled', 'cancelled')).toBe(true)
    expect(canTransitionOrderStatus('delivered', 'delivered')).toBe(true)
  })
})
