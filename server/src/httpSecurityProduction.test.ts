// اختبار منفصل بيشغّل التطبيق فعلياً بـ NODE_ENV=production (بتحميل ديناميكي بعد ضبط
// المتغيّر، عشان isProduction جوه app.ts يتقيّم صح وقت التحميل) — الملف الوحيد اللي بيقدر
// يتحقق من سلوكيات مقيّدة على الإنتاج بس: رفض Origin غير مسموح به، وCookie بعلامة Secure.
// DATABASE_URL بيتحط مسبقاً بمعرفة vitest.config.ts حتى في NODE_ENV=production، فمفيش خطر
// إن db.ts يعمل process.exit(1) بسبب غياب رابط قاعدة البيانات.
import { afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// اختبارات الـ SPA fallback تحت محتاجة dist/index.html وadmin/dist/index.html موجودين
// فعلياً على القرص (نفس المسارات اللي app.ts بيحسبها) — في CI، اختبارات السيرفر بتشتغل
// قبل خطوتي بناء المتجر واللوحة في الـ pipeline، فمفيش ضمان إن الملفين دول موجودين وقت
// تشغيل الاختبار ده. بننشئ نسخة placeholder بس لو مش موجودين أصلاً (وبنمسحها تاني في
// afterAll)، عشان الاختبار يفضل مستقل عن ترتيب باقي خطوات الـ pipeline ومايعتمدش على أثر
// جانبي من بناء سابق حصل بالصدفة في نفس البيئة.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.join(__dirname, '..', '..', 'dist')
const adminDistDir = path.join(__dirname, '..', '..', 'admin', 'dist')
const createdPlaceholderFiles: string[] = []
const createdPlaceholderDirs: string[] = []

for (const dir of [clientDir, adminDistDir]) {
  const indexPath = path.join(dir, 'index.html')
  if (!fs.existsSync(indexPath)) {
    if (!fs.existsSync(dir)) createdPlaceholderDirs.push(dir)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(indexPath, '<!doctype html><html><body>test placeholder</body></html>')
    createdPlaceholderFiles.push(indexPath)
  }
}

process.env.NODE_ENV = 'production'
const { app } = await import('./app.js')
const { pool } = await import('./db.js')

afterAll(async () => {
  await pool.end()
  for (const p of createdPlaceholderFiles) fs.rmSync(p, { force: true })
  // بنمسح المجلد نفسه بس لو إحنا اللي أنشأناه من الصفر (مش موجود قبل كده) وفضل فاضي —
  // عشان محدش يمسح مجلد بناء حقيقي كان موجود مسبقاً بالصدفة.
  for (const dir of createdPlaceholderDirs) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
  }
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

// الـ SPA fallback (وبالتبعية isSensitivePath) بيتفعّل بس في وضع الإنتاج (isProduction جوه
// app.ts) لما بيقدر يلاقي dist/ الحقيقي المبني فعلاً — عشان كده الاختبار هنا في نفس الملف.
describe('static file exposure paths in production mode', () => {
  it('returns a generic 404 (not the SPA shell) for dotfile-style and infra-looking paths', async () => {
    for (const p of ['/.env', '/.git/config', '/server/', '/logs/', '/backup/', '/admin/server']) {
      const res = await request(app).get(p)
      expect(res.status, `expected 404 for ${p}`).toBe(404)
      expect(res.text).not.toMatch(/<!doctype html>/i)
    }
  })

  it('still serves the SPA shell for a real client-side navigation route', async () => {
    const res = await request(app).get('/product/some-slug')
    expect(res.status).toBe(200)
    expect(res.text).toMatch(/<!doctype html>/i)
  })
})
