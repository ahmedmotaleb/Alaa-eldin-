import { describe, expect, it } from 'vitest'
import { normalizeEgyptianMobile } from './phone.js'

describe('normalizeEgyptianMobile', () => {
  it('accepts the bare local form', () => {
    expect(normalizeEgyptianMobile('01012345678')).toBe('01012345678')
  })

  it('accepts the +20 international form', () => {
    expect(normalizeEgyptianMobile('+201012345678')).toBe('01012345678')
  })

  it('accepts the 20 form without a plus sign', () => {
    expect(normalizeEgyptianMobile('201012345678')).toBe('01012345678')
  })

  it('strips spaces and dashes', () => {
    expect(normalizeEgyptianMobile('010 1234-5678')).toBe('01012345678')
  })

  it('accepts all four Egyptian mobile network prefixes', () => {
    expect(normalizeEgyptianMobile('01012345678')).toBe('01012345678')
    expect(normalizeEgyptianMobile('01112345678')).toBe('01112345678')
    expect(normalizeEgyptianMobile('01212345678')).toBe('01212345678')
    expect(normalizeEgyptianMobile('01512345678')).toBe('01512345678')
  })

  it('returns null for a non-Egyptian-mobile-shaped input', () => {
    expect(normalizeEgyptianMobile('0223456789')).toBeNull()
    expect(normalizeEgyptianMobile('notaphone')).toBeNull()
    expect(normalizeEgyptianMobile('')).toBeNull()
  })
})
