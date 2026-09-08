import { describe, expect, it } from 'vitest'
import { Writable } from 'node:stream'
import pino from 'pino'
import { maskPhone, REDACT_PATHS, REDACT_CENSOR } from './logger.js'

describe('maskPhone', () => {
  it('masks the middle digits, keeping first 3 and last 4', () => {
    expect(maskPhone('01012345678')).toBe('010****5678')
  })

  it('never returns the full original number unmasked', () => {
    const input = '01098765432'
    const masked = maskPhone(input)
    expect(masked).not.toBe(input)
    expect(masked).toContain('****')
  })

  it('masks short numbers entirely rather than leaking digits', () => {
    expect(maskPhone('123')).toBe('***')
  })
})

// بيبني نفس إعدادات الـ logger الحقيقية (REDACT_PATHS) على instance منفصل بيكتب على stream
// في الذاكرة، عشان نتأكد فعلياً إن القيم الحساسة بتتقنّع في ناتج JSON الفعلي — مش بس إن
// إعداد الـ redact موجود نظرياً.
function captureLogLine(fields: Record<string, unknown>): string {
  let captured = ''
  const stream = new Writable({
    write(chunk, _enc, callback) {
      captured += chunk.toString()
      callback()
    }
  })
  const testLogger = pino({ redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR } }, stream)
  testLogger.info(fields)
  return captured
}

describe('logger redaction', () => {
  it('redacts a password field instead of logging it', () => {
    const line = captureLogLine({ event: 'login_success', password: 'super-secret-123' })
    expect(line).not.toContain('super-secret-123')
    expect(line).toContain(REDACT_CENSOR)
  })

  it('redacts a session token field', () => {
    const line = captureLogLine({ event: 'x', sessionToken: 'abc123token' })
    expect(line).not.toContain('abc123token')
  })

  it('redacts a DATABASE_URL field', () => {
    const line = captureLogLine({ event: 'x', DATABASE_URL: 'postgresql://user:pass@host/db' })
    expect(line).not.toContain('postgresql://user:pass@host/db')
  })

  it('redacts an api secret field', () => {
    const line = captureLogLine({ event: 'x', apiSecret: 'sk_live_abcdef' })
    expect(line).not.toContain('sk_live_abcdef')
  })

  it('still logs non-sensitive fields in plain text', () => {
    const line = captureLogLine({ event: 'order_created', orderId: 'ord-1', total: 45 })
    expect(line).toContain('ord-1')
    expect(line).toContain('order_created')
  })
})
