import { describe, expect, it } from 'vitest'
import { isValidEgyptianMobile, toWhatsAppInternational } from './phone.js'

describe('isValidEgyptianMobile', () => {
  it('accepts all four valid Egyptian mobile network prefixes at exactly 11 digits', () => {
    expect(isValidEgyptianMobile('01012345678')).toBe(true)
    expect(isValidEgyptianMobile('01112345678')).toBe(true)
    expect(isValidEgyptianMobile('01212345678')).toBe(true)
    expect(isValidEgyptianMobile('01512345678')).toBe(true)
  })

  it('rejects a 10-digit number (missing one digit)', () => {
    expect(isValidEgyptianMobile('0101234567')).toBe(false)
  })

  it('rejects a 12-digit number (one digit too many)', () => {
    expect(isValidEgyptianMobile('010123456789')).toBe(false)
  })

  it('rejects a number missing the leading zero', () => {
    expect(isValidEgyptianMobile('1012345678')).toBe(false)
  })

  it('rejects the +20 international format', () => {
    expect(isValidEgyptianMobile('+201012345678')).toBe(false)
  })

  it('rejects the 20 international format without a plus sign', () => {
    expect(isValidEgyptianMobile('201012345678')).toBe(false)
  })

  it('rejects the 0020 international format', () => {
    expect(isValidEgyptianMobile('00201012345678')).toBe(false)
  })

  it('rejects invalid network prefixes (013, 014, 016)', () => {
    expect(isValidEgyptianMobile('01312345678')).toBe(false)
    expect(isValidEgyptianMobile('01412345678')).toBe(false)
    expect(isValidEgyptianMobile('01612345678')).toBe(false)
  })

  it('rejects letters mixed into the number', () => {
    expect(isValidEgyptianMobile('01012abc678')).toBe(false)
  })

  it('rejects spaces inside the number', () => {
    expect(isValidEgyptianMobile('010 1234 5678')).toBe(false)
  })

  it('rejects Eastern Arabic-Indic digits', () => {
    expect(isValidEgyptianMobile('٠١٠١٢٣٤٥٦٧٨')).toBe(false)
  })

  it('rejects empty and non-phone strings', () => {
    expect(isValidEgyptianMobile('')).toBe(false)
    expect(isValidEgyptianMobile('notaphone')).toBe(false)
  })
})

describe('toWhatsAppInternational', () => {
  it('converts a valid local number to international format without a plus sign', () => {
    expect(toWhatsAppInternational('01012345678')).toBe('201012345678')
    expect(toWhatsAppInternational('01512345678')).toBe('201512345678')
  })

  it('does not mutate an already-invalid/legacy stored value — returns it unchanged', () => {
    expect(toWhatsAppInternational('not-a-real-number')).toBe('not-a-real-number')
  })
})
