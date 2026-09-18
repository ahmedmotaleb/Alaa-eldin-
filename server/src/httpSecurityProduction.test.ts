// اختبار منفصل بيشغّل التطبيق فعلياً بـ NODE_ENV=production (بتحميل ديناميكي بعد ضبط
// المتغيّر، عشان isProduction جوه app.ts يتقيّم صح وقت التحميل) — الملف الوحيد اللي بيقدر
// يتحقق من سلوكيات مقيّدة على الإنتاج بس: رفض Origin غير مسموح به، وCookie بعلامة Secure.
// DATABASE_URL بيتحط مسبقاً بمعرفة vitest.config.ts حتى في NODE_ENV=production، فمفيش خطر
// إن db.ts يعمل process.exit(1) بسبب غياب رابط قاعدة البيانات.
import { afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'

process.env.NODE_ENV = 'production'
const { app } = await import('./app.js')
const { pool } = await import('./db.js')

afterAll(async () => {
  await pool.end()
})

describe('CSRF/Origin protection in production mode', () => {
  it('rejects a state-changing request from an unapproved cross-site Origin', async () => {
    const res = await request(app).post('/api/auth/logout').set('Origin', 'https://evil.example.com')
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'invalid_origin' })
  })

  it('accepts a state-changing request with no Origin header (native app / same-origin browser edge case)', async () => {
    const res = await request(app).post('/api/auth/logout')
    expect(res.status).toBe(204)
  })

  it('still allows a safe GET request regardless of Origin', async () => {
    const res = await request(app).get('/api/products').set('Origin', 'https://evil.example.com')
    expect(res.status).toBe(200)
  })
})

describe('cookie security attributes in production mode', () => {
  it('marks the session cookie as Secure in production', async () => {
    const email = `prodcookie-${Date.now()}@test.local`
    const res = await request(app).post('/api/auth/register')
      .send({ email, password: 'CorrectHorse9', fullName: 'م' })
    const cookieHeader = res.headers['set-cookie']
    const cookieStr = Array.isArray(cookieHeader) ? cookieHeader.join(';') : String(cookieHeader)
    expect(cookieStr).toMatch(/Secure/i)
    expect(cookieStr).toMatch(/HttpOnly/i)
    expect(cookieStr).toMatch(/SameSite=Lax/i)
    await pool.query('DELETE FROM users WHERE email = $1', [email])
  })
})
