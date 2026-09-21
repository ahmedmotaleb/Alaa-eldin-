// اختبارات تكامل حقيقية على مستوى HTTP (supertest ضد app.ts الفعلي) لسياسة CAPTCHA
// كاملة: التسجيل، نسيت كلمة المرور (مع الحفاظ على عدم كشف وجود الحساب)، تسجيل الدخول
// التكيّفي (عميل عادي مقابل حساب إداري)، والتأكد إن الـ rate limiter الحالي لسه شغّال
// جنب CAPTCHA مش بديل عنه. Cloudflare نفسها متقلّدة بالكامل (fetch mock) — مفيش أي اتصال
// حقيقي بالمزوّد هنا.
//
// turnstileConfigured بيتحسب وقت تحميل الموديول، فلازم نضبط متغيرات البيئة قبل ما نعمل
// import لـ app.js — نفس الأسلوب المتّبع في httpSecurityProduction.test.ts (import ديناميكي
// بـ top-level await بعد ضبط process.env، مش import ثابت في أول الملف).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

process.env.TURNSTILE_SITE_KEY = 'test-site-key'
process.env.TURNSTILE_SECRET_KEY = 'test-secret-key'

const { app } = await import('./app.js')
const { pool } = await import('./db.js')

const PREFIX = 'captcha-'
const STRONG_PASSWORD = 'CorrectHorse9'

function uniqueEmail(label: string): string {
  return `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`
}

async function cleanup() {
  await pool.query('DELETE FROM login_failure_tracking WHERE email LIKE $1', [`${PREFIX}%`])
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${PREFIX}%`])
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await cleanup()
})

afterAll(async () => {
  await pool.end()
})

function mockCloudflareSuccess() {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
}
function mockCloudflareFailure() {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }) })
}

async function registerCustomer(email: string) {
  mockCloudflareSuccess()
  const res = await request(app).post('/api/auth/register')
    .send({ email, password: STRONG_PASSWORD, fullName: 'عميل اختبار', captchaToken: 'ok' })
  expect(res.status).toBe(201)
  return res.body.user.id as string
}

describe('registration CAPTCHA', () => {
  it('rejects registration with a missing token and does not create the user, without calling Cloudflare', async () => {
    const email = uniqueEmail('reg-missing')
    const res = await request(app).post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'a' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'captcha_required' })
    expect(fetchMock).not.toHaveBeenCalled()
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email])
    expect(rows).toHaveLength(0)
  })

  it('rejects registration when Cloudflare reports the token invalid, without creating the user', async () => {
    mockCloudflareFailure()
    const email = uniqueEmail('reg-invalid')
    const res = await request(app).post('/api/auth/register')
      .send({ email, password: STRONG_PASSWORD, fullName: 'a', captchaToken: 'bad-token' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'captcha_required' })
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email])
    expect(rows).toHaveLength(0)
  })

  it('fails closed (rejects, does not create the user) when Cloudflare is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    const email = uniqueEmail('reg-providerdown')
    const res = await request(app).post('/api/auth/register')
      .send({ email, password: STRONG_PASSWORD, fullName: 'a', captchaToken: 'any-token' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'captcha_required' })
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email])
    expect(rows).toHaveLength(0)
  })

  it('allows registration once Cloudflare verifies the token successfully', async () => {
    const email = uniqueEmail('reg-valid')
    const userId = await registerCustomer(email)
    expect(userId).toBeTruthy()
  })
})

describe('forgot-password CAPTCHA (preserves anti-enumeration)', () => {
  it('returns the identical generic captcha error for an existing and a non-existing email', async () => {
    const existingEmail = uniqueEmail('fp-exists')
    await registerCustomer(existingEmail)

    mockCloudflareFailure()
    const resExisting = await request(app).post('/api/auth/forgot-password').send({ email: existingEmail, captchaToken: 'bad' })
    const resMissing = await request(app).post('/api/auth/forgot-password').send({ email: uniqueEmail('fp-missing'), captchaToken: 'bad' })

    expect(resExisting.status).toBe(400)
    expect(resExisting.body).toEqual({ error: 'captcha_required' })
    expect(resMissing.status).toBe(resExisting.status)
    expect(resMissing.body).toEqual(resExisting.body)
  })

  it('returns the identical generic 204 for an existing and a non-existing email once captcha passes', async () => {
    const existingEmail = uniqueEmail('fp-exists2')
    await registerCustomer(existingEmail)

    mockCloudflareSuccess()
    const resExisting = await request(app).post('/api/auth/forgot-password').send({ email: existingEmail, captchaToken: 'ok' })
    const resMissing = await request(app).post('/api/auth/forgot-password').send({ email: uniqueEmail('fp-missing2'), captchaToken: 'ok' })

    expect(resExisting.status).toBe(204)
    expect(resMissing.status).toBe(204)
  })
})

describe('adaptive login CAPTCHA — customer account (threshold: 3 failures)', () => {
  it('does not require captcha for the first two failed attempts', async () => {
    const email = uniqueEmail('login-customer-early')
    await registerCustomer(email)

    for (let i = 0; i < 2; i++) {
      const res = await request(app).post('/api/auth/login').send({ email, password: 'WrongPassword1' })
      expect(res.status).toBe(401)
    }
    // لسه تحت الحد (2 فشل بس) — تسجيل الدخول الصحيح لازم ينجح من غير أي captchaToken
    const res = await request(app).post('/api/auth/login').send({ email, password: STRONG_PASSWORD })
    expect(res.status).toBe(200)
  })

  it('requires captcha after reaching the 3-failure threshold, and accepts it once solved', async () => {
    const email = uniqueEmail('login-customer-threshold')
    await registerCustomer(email)

    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/api/auth/login').send({ email, password: 'WrongPassword1' })
      expect(res.status).toBe(401)
    }

    // الآن الحد اتعدى — محاولة بكلمة سر صحيحة بس من غير captchaToken المفروض ترفض
    const withoutCaptcha = await request(app).post('/api/auth/login').send({ email, password: STRONG_PASSWORD })
    expect(withoutCaptcha.status).toBe(400)
    expect(withoutCaptcha.body).toEqual({ error: 'captcha_required' })

    // بعد حل الـ captcha بنجاح، تسجيل الدخول لازم ينجح وترجع الجلسة
    mockCloudflareSuccess()
    const withCaptcha = await request(app).post('/api/auth/login').send({ email, password: STRONG_PASSWORD, captchaToken: 'ok' })
    expect(withCaptcha.status).toBe(200)
    expect(withCaptcha.body.user.email).toBe(email)
  })
})

describe('adaptive login CAPTCHA — admin account (earlier threshold: 1 failure)', () => {
  it('requires captcha after just one failed attempt for an admin account', async () => {
    const email = uniqueEmail('login-admin')
    const userId = await registerCustomer(email)
    await pool.query('UPDATE users SET is_admin = 1, role = $2 WHERE id = $1', [userId, 'admin'])

    const failRes = await request(app).post('/api/auth/login').send({ email, password: 'WrongPassword1' })
    expect(failRes.status).toBe(401)

    const secondAttempt = await request(app).post('/api/auth/login').send({ email, password: STRONG_PASSWORD })
    expect(secondAttempt.status).toBe(400)
    expect(secondAttempt.body).toEqual({ error: 'captcha_required' })

    mockCloudflareSuccess()
    const withCaptcha = await request(app).post('/api/auth/login').send({ email, password: STRONG_PASSWORD, captchaToken: 'ok' })
    expect(withCaptcha.status).toBe(200)
  })

  it('does not require captcha for a regular customer after only one failed attempt (below the customer threshold)', async () => {
    const email = uniqueEmail('login-customer-1fail')
    await registerCustomer(email)

    const failRes = await request(app).post('/api/auth/login').send({ email, password: 'WrongPassword1' })
    expect(failRes.status).toBe(401)

    const secondAttempt = await request(app).post('/api/auth/login').send({ email, password: STRONG_PASSWORD })
    expect(secondAttempt.status).toBe(200)
  })
})

describe('rate limiting remains active alongside CAPTCHA', () => {
  it('exposes standard rate-limit headers on /login even when captcha is not yet required', async () => {
    const email = uniqueEmail('login-ratelimit-headers')
    await registerCustomer(email)

    const res = await request(app).post('/api/auth/login').send({ email, password: STRONG_PASSWORD })
    expect(res.status).toBe(200)
    expect(res.headers['ratelimit-limit'] ?? res.headers['x-ratelimit-limit']).toBeTruthy()
  })
})

describe('provider secret is never exposed', () => {
  it('never includes the Turnstile secret key in any auth response body', async () => {
    mockCloudflareFailure()
    const email = uniqueEmail('secret-leak-check')
    const res = await request(app).post('/api/auth/register')
      .send({ email, password: STRONG_PASSWORD, fullName: 'a', captchaToken: 'bad' })
    expect(JSON.stringify(res.body)).not.toContain('test-secret-key')
  })

  it('exposes only the public site key on /api/settings, never the secret', async () => {
    const res = await request(app).get('/api/settings')
    expect(res.status).toBe(200)
    expect(res.body.captcha).toEqual({ turnstileSiteKey: 'test-site-key' })
    expect(JSON.stringify(res.body)).not.toContain('test-secret-key')
  })

  it('reports captcha as configured on the admin security-status page, without ever exposing the secret', async () => {
    const agent = request.agent(app)
    const email = uniqueEmail('secstatus-admin')
    mockCloudflareSuccess()
    const regRes = await agent.post('/api/auth/register')
      .send({ email, password: STRONG_PASSWORD, fullName: 'a', captchaToken: 'ok' })
    expect(regRes.status).toBe(201)
    await pool.query('UPDATE users SET is_admin = 1, role = $2 WHERE id = $1', [regRes.body.user.id, 'admin'])

    const res = await agent.get('/api/admin/security-status')
    expect(res.status).toBe(200)
    expect(res.body.captcha).toEqual({ configured: true })
    expect(JSON.stringify(res.body)).not.toContain('test-secret-key')
  })
})
