// اختبارات أمان حقيقية على مستوى HTTP — بتشغّل تطبيق Express الفعلي (app.ts) بكل الـ
// middleware المسجّل فيه (helmet، CORS، فحص Origin، فحص Content-Type، حدود حجم الجسم،
// الكاش، المصادقة) عن طريق supertest، مش mocks لـ req/res. أول ملف في المشروع بيغطي السلوك
// ده فعلياً بدل الاعتماد على اختبارات الخدمات المعزولة بس.
//
// ملاحظة على ترتيب التنفيذ: express-rate-limit بيحتفظ بحالته في نفس العملية طول عمر
// الملف — عشان محدش يستنفذ حد تسجيل الدخول ويكسر باقي الاختبارات هنا، اختبارات الـ rate
// limit نفسها في ملف منفصل (httpSecurityRateLimit.test.ts) بيشتغل في عملية/worker مختلفة.
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { generate } from 'otplib'
import { app } from './app.js'
import { pool } from './db.js'

const PREFIX = 'httpsec-'

async function cleanup() {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${PREFIX}%`])
}

beforeEach(cleanup)

afterAll(async () => {
  await cleanup()
  await pool.end()
})

function uniqueEmail(label: string): string {
  return `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`
}

const STRONG_PASSWORD = 'CorrectHorse9'

async function registerCustomer(agent: ReturnType<typeof request.agent>, email: string) {
  const res = await agent.post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'عميل اختبار' })
  expect(res.status).toBe(201)
  return res.body.user.id as string
}

async function promoteToAdmin(userId: string, role: 'staff' | 'admin') {
  await pool.query('UPDATE users SET is_admin = 1, role = $2 WHERE id = $1', [userId, role])
}

describe('security headers', () => {
  it('sends helmet security headers on API responses', async () => {
    const res = await request(app).get('/api/products')
    expect(res.status).toBe(200)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN')
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/)
    expect(res.headers['content-security-policy']).toContain("default-src 'self'")
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'")
  })

  it('returns a generic JSON 404 for an unknown API path', async () => {
    const res = await request(app).get('/api/this-route-does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'not_found' })
  })
})

describe('cache security (private API responses)', () => {
  it('marks an unauthenticated private endpoint response as no-store', async () => {
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(401)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('marks an authenticated account endpoint response as no-store', async () => {
    const agent = request.agent(app)
    await registerCustomer(agent, uniqueEmail('cache'))
    const res = await agent.get('/api/auth/me')
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
  })
})

describe('password security', () => {
  it('rejects a weak password on registration', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: uniqueEmail('weak'), password: 'short', fullName: 'ضعيف' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'weak_password' })
  })

  it('accepts a strong password and never returns the password hash', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: uniqueEmail('strong'), password: STRONG_PASSWORD, fullName: 'قوي' })
    expect(res.status).toBe(201)
    const bodyText = JSON.stringify(res.body)
    expect(bodyText).not.toMatch(/passwordHash/i)
    expect(bodyText).not.toContain(STRONG_PASSWORD)
  })

  it('rejects an incorrect password on login without revealing whether the email exists', async () => {
    const email = uniqueEmail('login')
    await request(app).post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'م' })
    const wrongPass = await request(app).post('/api/auth/login').send({ email, password: 'WrongPass9' })
    const noSuchUser = await request(app).post('/api/auth/login').send({ email: uniqueEmail('nouser'), password: 'WrongPass9' })
    expect(wrongPass.status).toBe(401)
    expect(noSuchUser.status).toBe(401)
    expect(wrongPass.body).toEqual(noSuchUser.body)
  })

  it('never stores the password in plaintext', async () => {
    const email = uniqueEmail('plaintext')
    await request(app).post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'م' })
    const { rows } = await pool.query<{ passwordHash: string }>('SELECT password_hash as "passwordHash" FROM users WHERE email = $1', [email])
    expect(rows[0].passwordHash).not.toBe(STRONG_PASSWORD)
    expect(rows[0].passwordHash).toMatch(/^\$2[aby]\$/)
  })
})

describe('two-factor authentication', () => {
  it('requires a correct TOTP code before completing login, and rejects an incorrect one', async () => {
    const agent = request.agent(app)
    const email = uniqueEmail('2fa')
    await registerCustomer(agent, email)

    const setup = await agent.post('/api/auth/2fa/setup').send()
    expect(setup.status).toBe(200)
    const secret = setup.body.secret as string

    const validCode = await generate({ secret })
    const confirm = await agent.post('/api/auth/2fa/confirm').send({ token: validCode })
    expect(confirm.status).toBe(200)
    expect(Array.isArray(confirm.body.backupCodes)).toBe(true)

    // من غير 2FA اتفعّل، تسجيل الدخول العادي بيرجّع pendingToken بدل ما ينشئ جلسة فوراً.
    const freshAgent = request.agent(app)
    const loginStart = await freshAgent.post('/api/auth/login').send({ email, password: STRONG_PASSWORD })
    expect(loginStart.status).toBe(200)
    expect(loginStart.body.requiresTwoFactor).toBe(true)
    const pendingToken = loginStart.body.pendingToken as string

    const wrongCode = await freshAgent.post('/api/auth/2fa/verify-login').send({ pendingToken, code: '000000' })
    expect(wrongCode.status).toBe(401)
    expect(wrongCode.body.error).toBe('invalid_code')

    // pendingToken بيتستهلك لمرة واحدة حتى لو الكود غلط — لازم نسجّل دخول تاني عشان نجرّب كود صح.
    const loginRetry = await freshAgent.post('/api/auth/login').send({ email, password: STRONG_PASSWORD })
    const retryToken = loginRetry.body.pendingToken as string
    const correctCode = await generate({ secret })
    const success = await freshAgent.post('/api/auth/2fa/verify-login').send({ pendingToken: retryToken, code: correctCode })
    expect(success.status).toBe(200)
    expect(success.body.user.email).toBe(email)
    expect(success.headers['set-cookie']).toBeTruthy()
  })
})

describe('authorization (customer vs admin)', () => {
  it('rejects an unauthenticated request to an admin endpoint with 401', async () => {
    const res = await request(app).get('/api/admin/users')
    expect(res.status).toBe(401)
  })

  it('rejects a regular customer hitting an admin-only endpoint with 403', async () => {
    const agent = request.agent(app)
    await registerCustomer(agent, uniqueEmail('customer'))
    const res = await agent.get('/api/admin/users')
    expect(res.status).toBe(403)
  })

  it('rejects an admin-panel staff account (isAdmin but role=staff) from a full-admin-only endpoint', async () => {
    const agent = request.agent(app)
    const userId = await registerCustomer(agent, uniqueEmail('staff'))
    await promoteToAdmin(userId, 'staff')
    const res = await agent.get('/api/admin/users')
    expect(res.status).toBe(403)
  })

  it('allows a full admin account through to the admin-only endpoint', async () => {
    const agent = request.agent(app)
    const userId = await registerCustomer(agent, uniqueEmail('admin'))
    await promoteToAdmin(userId, 'admin')
    const res = await agent.get('/api/admin/users')
    expect(res.status).toBe(200)
  })
})

describe('IDOR protection', () => {
  it('does not let customer B read or modify customer A\'s address', async () => {
    const agentA = request.agent(app)
    await registerCustomer(agentA, uniqueEmail('idor-a'))
    const created = await agentA.post('/api/account/addresses').send({ governorate: 'القاهرة', address: 'شارع الاختبار' })
    expect(created.status).toBe(201)
    const addressId = created.body.address.id as string

    const agentB = request.agent(app)
    await registerCustomer(agentB, uniqueEmail('idor-b'))

    const readAsB = await agentB.get('/api/account/addresses')
    expect(readAsB.body.addresses).toEqual([])

    const updateAsB = await agentB.put(`/api/account/addresses/${addressId}`)
      .send({ governorate: 'الجيزة', address: 'عنوان مختلف' })
    expect(updateAsB.status).toBe(404)

    const deleteAsB = await agentB.delete(`/api/account/addresses/${addressId}`)
    expect(deleteAsB.status).toBe(404)

    // العنوان الأصلي لسه سليم ومملوك لصاحبه بعد محاولات B الفاشلة.
    const readAsA = await agentA.get('/api/account/addresses')
    expect(readAsA.body.addresses).toHaveLength(1)
    expect(readAsA.body.addresses[0].address).toBe('شارع الاختبار')
  })

  it('does not let one customer see another customer\'s order list', async () => {
    const agentA = request.agent(app)
    await registerCustomer(agentA, uniqueEmail('orders-a'))
    const agentB = request.agent(app)
    await registerCustomer(agentB, uniqueEmail('orders-b'))

    const ordersA = await agentA.get('/api/orders')
    const ordersB = await agentB.get('/api/orders')
    expect(ordersA.status).toBe(200)
    expect(ordersB.status).toBe(200)
    expect(ordersA.body.orders).toEqual([])
    expect(ordersB.body.orders).toEqual([])
  })
})

describe('injection safety', () => {
  it('treats a SQL-injection-style search string as plain text input, not as SQL', async () => {
    const res = await request(app).get('/api/products').query({ search: "' OR 1=1 --" })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.products)).toBe(true)
    // مفيش استثناء SQL اتفجّر أو تسريب — استعلام Postgres باراميتري بيعامل الإدخال كنص عادي بيدوّر عليه، مش كجزء من الأمر.
  })

  it('treats a SQL-injection-style string in the login email field as plain text, not as SQL', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: "' OR 1=1 --", password: 'whatever123' })
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'invalid_credentials' })
  })
})

describe('stored XSS safety', () => {
  it('returns a script-tag payload as inert JSON string data, never as executable HTML', async () => {
    const payload = '<script>alert(1)</script>'
    const agent = request.agent(app)
    const email = uniqueEmail('xss')
    const res = await agent.post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: payload })
    expect(res.status).toBe(201)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body.user.fullName).toBe(payload)

    const me = await agent.get('/api/auth/me')
    expect(me.headers['content-type']).toMatch(/application\/json/)
    expect(me.body.user.fullName).toBe(payload)
  })
})

describe('payload size limits', () => {
  it('rejects an oversized JSON body on a normal endpoint with 413', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: uniqueEmail('huge'), password: STRONG_PASSWORD, fullName: 'x'.repeat(400_000) })
    expect(res.status).toBe(413)
    expect(res.body).toEqual({ error: 'payload_too_large' })
  })
})

describe('Content-Type validation', () => {
  it('rejects a POST body sent with an unsupported Content-Type', async () => {
    const res = await request(app).post('/api/auth/login')
      .set('Content-Type', 'text/plain')
      .send('email=a@a.com&password=x')
    expect(res.status).toBe(415)
    expect(res.body).toEqual({ error: 'unsupported_content_type' })
  })

  it('allows a zero-body POST regardless of Content-Type', async () => {
    const res = await request(app).post('/api/auth/logout').set('Content-Type', 'text/plain')
    expect(res.status).toBe(204)
  })
})

describe('cookie security attributes', () => {
  it('sets the session cookie as HttpOnly and SameSite=Lax', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: uniqueEmail('cookie'), password: STRONG_PASSWORD, fullName: 'م' })
    const cookieHeader = res.headers['set-cookie']
    expect(cookieHeader).toBeTruthy()
    const cookieStr = Array.isArray(cookieHeader) ? cookieHeader.join(';') : String(cookieHeader)
    expect(cookieStr).toMatch(/session_token=/)
    expect(cookieStr).toMatch(/HttpOnly/i)
    expect(cookieStr).toMatch(/SameSite=Lax/i)
  })
})

describe('error handling (no internal detail leakage)', () => {
  it('responds to malformed JSON with a generic error and no stack trace, SQL, or file path', async () => {
    const res = await request(app).post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": "a@a.com", "password":')
    const bodyText = JSON.stringify(res.body)
    expect(bodyText).not.toMatch(/at\s+.*\(.*:\d+:\d+\)/) // نمط سطر stack trace نموذجي
    expect(bodyText).not.toMatch(/\/(home|tmp|usr|src)\//)
    expect(bodyText).not.toMatch(/SELECT|INSERT|UPDATE|DELETE FROM/i)
    expect(res.body.error).toBeTruthy()
  })
})

describe('admin security status endpoint (section 32)', () => {
  it('never exposes secret values, and marks its response as no-store', async () => {
    const agent = request.agent(app)
    const userId = await registerCustomer(agent, uniqueEmail('secstatus'))
    await promoteToAdmin(userId, 'admin')
    const res = await agent.get('/api/admin/security-status')
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    const bodyText = JSON.stringify(res.body)
    expect(bodyText).not.toMatch(/DATABASE_URL|postgres:\/\//i)
    expect(bodyText).not.toMatch(/secret.{0,20}:.{0,3}"[^"]{10,}/i)
  })
})
