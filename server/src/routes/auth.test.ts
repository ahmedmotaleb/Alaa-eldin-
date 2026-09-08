// اختبار وحدة على isNativeClient — القرار الحرج اللي بيتحكم هل يترجع session token خام
// في جسم رد تسجيل الدخول/التسجيل ولا لأ. لازم يفضل false افتراضياً لأي طلب عادي من متصفح
// الويب (عشان الحماية httpOnly تفضل زي ما هي)، وtrue بس لما هيدر Android الصريح موجود.
import { describe, expect, it } from 'vitest'
import type { Request } from 'express'
import { isNativeClient } from './auth.js'

describe('isNativeClient', () => {
  it('is false for a normal web request with no platform header', () => {
    const req = { headers: {} } as Request
    expect(isNativeClient(req)).toBe(false)
  })

  it('is true only when the exact android platform header is present', () => {
    const req = { headers: { 'x-client-platform': 'android' } } as unknown as Request
    expect(isNativeClient(req)).toBe(true)
  })

  it('is false for an unrelated or spoofed header value', () => {
    const req = { headers: { 'x-client-platform': 'ios' } } as unknown as Request
    expect(isNativeClient(req)).toBe(false)
  })
})
