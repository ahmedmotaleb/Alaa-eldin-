import { describe, expect, it } from 'vitest'
import { isStrongPassword } from './passwordPolicy.js'

describe('isStrongPassword', () => {
  it('accepts a password with 8+ chars, a letter, and a digit', () => {
    expect(isStrongPassword('abcd1234')).toBe(true)
    expect(isStrongPassword('Passw0rd')).toBe(true)
  })

  it('rejects a password shorter than 8 characters', () => {
    expect(isStrongPassword('abc123')).toBe(false)
  })

  it('rejects a password with only digits', () => {
    expect(isStrongPassword('12345678')).toBe(false)
  })

  it('rejects a password with only letters', () => {
    expect(isStrongPassword('abcdefgh')).toBe(false)
  })

  it('accepts a password longer than 8 with mixed content', () => {
    expect(isStrongPassword('mySecurePass99')).toBe(true)
  })
})
