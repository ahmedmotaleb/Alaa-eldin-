import { describe, expect, it } from 'vitest'
import { isSensitivePath } from './staticFallbackCheck.js'

describe('isSensitivePath', () => {
  it('flags dotfile-style path segments anywhere in the path', () => {
    expect(isSensitivePath('/.git/config')).toBe(true)
    expect(isSensitivePath('/.env')).toBe(true)
    expect(isSensitivePath('/admin/.git/config')).toBe(true)
  })

  it('flags well-known non-app infra directory names as the first segment', () => {
    expect(isSensitivePath('/server')).toBe(true)
    expect(isSensitivePath('/server/')).toBe(true)
    expect(isSensitivePath('/logs')).toBe(true)
    expect(isSensitivePath('/backup')).toBe(true)
    expect(isSensitivePath('/node_modules')).toBe(true)
  })

  it('also flags them under /admin (the admin SPA is served from the same static root)', () => {
    expect(isSensitivePath('/admin/server')).toBe(true)
    expect(isSensitivePath('/admin/logs')).toBe(true)
  })

  it('does not flag real SPA navigation routes', () => {
    expect(isSensitivePath('/')).toBe(false)
    expect(isSensitivePath('/product/tomato')).toBe(false)
    expect(isSensitivePath('/account/orders')).toBe(false)
    expect(isSensitivePath('/admin/products/edit/p01')).toBe(false)
    expect(isSensitivePath('/admin/orders/all')).toBe(false)
  })
})
