import { describe, expect, it } from 'vitest'
import { isRequestOriginAllowed } from './csrfOriginCheck.js'

const ALLOWED = new Set(['http://localhost:5173'])

describe('isRequestOriginAllowed', () => {
  it('always allows safe methods regardless of origin', () => {
    expect(isRequestOriginAllowed('GET', 'https://evil.example', ALLOWED, true)).toBe(true)
    expect(isRequestOriginAllowed('HEAD', 'https://evil.example', ALLOWED, true)).toBe(true)
    expect(isRequestOriginAllowed('OPTIONS', 'https://evil.example', ALLOWED, true)).toBe(true)
  })

  it('allows a state-changing request with no Origin header at all (curl, native apps)', () => {
    expect(isRequestOriginAllowed('POST', undefined, ALLOWED, true)).toBe(true)
  })

  it('allows a state-changing request from an explicitly allowed origin', () => {
    expect(isRequestOriginAllowed('POST', 'http://localhost:5173', ALLOWED, true)).toBe(true)
  })

  it('rejects a state-changing request from a foreign origin in production', () => {
    expect(isRequestOriginAllowed('POST', 'https://evil.example', ALLOWED, true)).toBe(false)
    expect(isRequestOriginAllowed('PATCH', 'https://evil.example', ALLOWED, true)).toBe(false)
    expect(isRequestOriginAllowed('DELETE', 'https://evil.example', ALLOWED, true)).toBe(false)
  })

  it('allows a state-changing request from any origin outside production (local dev)', () => {
    expect(isRequestOriginAllowed('POST', 'https://evil.example', ALLOWED, false)).toBe(true)
  })
})
