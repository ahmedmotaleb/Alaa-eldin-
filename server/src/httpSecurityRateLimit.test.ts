// اختبار منفصل عمداً عن httpSecurity.test.ts: express-rate-limit بيحتفظ بحالته في نفس
// العملية طول تنفيذ ملف الاختبار، فاستنفاذ حد تسجيل الدخول هنا ما بيأثرش على أي ملف تاني
// (كل ملف اختبار بيشتغل في worker/عملية منفصلة تماماً).
import { afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { app } from './app.js'
import { pool } from './db.js'

afterAll(async () => {
  await pool.end()
})

describe('login rate limiting', () => {
  it('blocks further login attempts after repeated failures from the same client', async () => {
    const email = `ratelimit-login-${Date.now()}@test.local`
    const attempts = Array.from({ length: 11 }, () =>
      request(app).post('/api/auth/login').send({ email, password: 'wrong-password-1' })
    )
    const results = []
    for (const attempt of attempts) results.push(await attempt)

    const statuses = results.map(r => r.status)
    expect(statuses.slice(0, 10).every(s => s === 401)).toBe(true)
    expect(statuses[10]).toBe(429)
  })
})

describe('forgot-password rate limiting', () => {
  it('blocks further password-reset requests after repeated attempts from the same client', async () => {
    const results = []
    for (let i = 0; i < 6; i++) {
      results.push(await request(app).post('/api/auth/forgot-password').send({ email: `ratelimit-forgot-${i}@test.local` }))
    }
    const statuses = results.map(r => r.status)
    expect(statuses.slice(0, 5).every(s => s === 204)).toBe(true)
    expect(statuses[5]).toBe(429)
  })
})
