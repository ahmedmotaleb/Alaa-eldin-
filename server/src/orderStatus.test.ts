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
  it('allows every step of the normal forward flow', () => {
    expect(canTransitionOrderStatus('placed', 'preparing')).toBe(true)
    expect(canTransitionOrderStatus('preparing', 'ready_for_delivery')).toBe(true)
    expect(canTransitionOrderStatus('ready_for_delivery', 'out_for_delivery')).toBe(true)
    expect(canTransitionOrderStatus('out_for_delivery', 'delivered')).toBe(true)
  })

  it('blocks skipping a stage in the forward flow', () => {
    expect(canTransitionOrderStatus('preparing', 'out_for_delivery')).toBe(false)
    expect(canTransitionOrderStatus('placed', 'ready_for_delivery')).toBe(false)
    expect(canTransitionOrderStatus('placed', 'out_for_delivery')).toBe(false)
    expect(canTransitionOrderStatus('placed', 'delivered')).toBe(false)
  })

  it('blocks any backwards transition', () => {
    expect(canTransitionOrderStatus('out_for_delivery', 'preparing')).toBe(false)
    expect(canTransitionOrderStatus('ready_for_delivery', 'placed')).toBe(false)
    expect(canTransitionOrderStatus('preparing', 'placed')).toBe(false)
    expect(canTransitionOrderStatus('delivered', 'preparing')).toBe(false)
  })

  it('allows cancelling from any active pre-delivery state, including out_for_delivery', () => {
    expect(canTransitionOrderStatus('placed', 'cancelled')).toBe(true)
    expect(canTransitionOrderStatus('preparing', 'cancelled')).toBe(true)
    expect(canTransitionOrderStatus('ready_for_delivery', 'cancelled')).toBe(true)
    expect(canTransitionOrderStatus('out_for_delivery', 'cancelled')).toBe(true)
  })

  it('blocks leaving a delivered order to any other state', () => {
    expect(canTransitionOrderStatus('delivered', 'cancelled')).toBe(false)
    expect(canTransitionOrderStatus('delivered', 'placed')).toBe(false)
  })

  it('blocks leaving a cancelled order to any other state', () => {
    expect(canTransitionOrderStatus('cancelled', 'delivered')).toBe(false)
    expect(canTransitionOrderStatus('cancelled', 'placed')).toBe(false)
  })

  it('allows a no-op transition to the same state, including terminal states', () => {
    expect(canTransitionOrderStatus('cancelled', 'cancelled')).toBe(true)
    expect(canTransitionOrderStatus('delivered', 'delivered')).toBe(true)
    expect(canTransitionOrderStatus('preparing', 'preparing')).toBe(true)
  })
})
