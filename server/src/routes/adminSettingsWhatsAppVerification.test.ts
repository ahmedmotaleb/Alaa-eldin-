// اختبارات HTTP حقيقية لتغيير رقم واتساب خدمة العملاء عبر كود تحقق (OTP) — نفس أسلوب
// httpSecurityProduction.test.ts: متغيرات بيئة واتساب بتتحط قبل أول "await import('../app.js')"
// عشان whatsappPhoneVerificationReady جوه whatsappNumberVerificationService.ts يتقيّم صح وقت
// التحميل. fetch نفسها بتتقلّد بالكامل (vi.stubGlobal) — مفيش أي اتصال حقيقي بـ Meta هنا.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

process.env.WHATSAPP_ACCESS_TOKEN = 'test-token'
process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id'
process.env.WHATSAPP_PHONE_VERIFICATION_TEMPLATE = 'phone_verification_ar'

const { app } = await import('../app.js')
const { pool } = await import('../db.js')

const PREFIX = 'wanv-'
const STRONG_PASSWORD = 'CorrectHorse9'
const ORIGINAL_NUMBER = '01000000001'
const NEW_NUMBER = '01098765432'

function uniqueEmail(label: string): string {
  return `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`
}

async function registerUser(email: string): Promise<{ agent: ReturnType<typeof request.agent>, userId: string }> {
  const agent = request.agent(app)
  const res = await agent.post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'مسؤول اختبار' })
  expect(res.status).toBe(201)
  return { agent, userId: res.body.user.id as string }
}

// مدير كامل (legacy full admin) — عنده settings.manage عن طريق LEGACY_ADMIN_PERMISSIONS.
async function fullAdminAgent(label = 'admin'): Promise<{ agent: ReturnType<typeof request.agent>, userId: string }> {
  const { agent, userId } = await registerUser(uniqueEmail(label))
  await pool.query("UPDATE users SET is_admin = 1, role = 'admin', role_id = NULL WHERE id = $1", [userId])
  return { agent, userId }
}

// role-picker: دور نظام حقيقي (مُهيّأ مسبقاً) بدون settings.manage — يمثّل أدمن لوحة تحكم
// حقيقي، لكن بلا الصلاحية الدقيقة المطلوبة لتغيير رقم واتساب المتجر.
async function noSettingsPermissionAgent(label = 'picker'): Promise<{ agent: ReturnType<typeof request.agent>, userId: string }> {
  const { agent, userId } = await registerUser(uniqueEmail(label))
  await pool.query("UPDATE users SET is_admin = 1, role = 'staff', role_id = 'role-picker' WHERE id = $1", [userId])
  return { agent, userId }
}

async function resetSettingsNumber() {
  await pool.query('UPDATE store_settings SET whatsapp_number = $1 WHERE id = 1', [ORIGINAL_NUMBER])
}

async function cleanup() {
  await pool.query(`DELETE FROM whatsapp_number_verifications WHERE admin_user_id IN (SELECT id FROM users WHERE email LIKE $1)`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM whatsapp_messages WHERE created_by_user_id IN (SELECT id FROM users WHERE email LIKE $1)`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM audit_logs WHERE admin_user_id IN (SELECT id FROM users WHERE email LIKE $1)`, [`${PREFIX}%`])
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${PREFIX}%`])
  await resetSettingsNumber()
}

let fetchMock: ReturnType<typeof vi.fn>

function mockFetchSuccess() {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'wamid.test123' }] }) })
  vi.stubGlobal('fetch', fetchMock)
}

beforeEach(async () => {
  mockFetchSuccess()
  await resetSettingsNumber()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(async () => {
  await cleanup()
  await pool.end()
})

async function requestVerification(agent: ReturnType<typeof request.agent>, phone: string) {
  return agent.post('/api/admin/settings/whatsapp-number/request-verification').send({ phone })
}

function extractSentOtp(): string {
  const [, options] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit]
  const body = JSON.parse(options.body as string)
  return body.template.components[0].parameters[0].text as string
}

describe('POST /api/admin/settings/whatsapp-number/request-verification', () => {
  it('rejects an invalid Egyptian mobile number', async () => {
    const { agent } = await fullAdminAgent()
    const res = await requestVerification(agent, '0123456789')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_phone')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is permission-protected — an admin without settings.manage is rejected', async () => {
    const { agent } = await noSettingsPermissionAgent()
    const res = await requestVerification(agent, NEW_NUMBER)
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post('/api/admin/settings/whatsapp-number/request-verification').send({ phone: NEW_NUMBER })
    expect(res.status).toBe(401)
  })

  it('never returns the OTP in the API response', async () => {
    const { agent } = await fullAdminAgent()
    const res = await requestVerification(agent, NEW_NUMBER)
    expect(res.status).toBe(201)
    expect(res.body.verificationId).toBeTruthy()
    expect(JSON.stringify(res.body)).not.toMatch(/\b\d{6}\b/)
  })

  it('stores the OTP hashed, never in plaintext', async () => {
    const { agent } = await fullAdminAgent()
    const res = await requestVerification(agent, NEW_NUMBER)
    const sentOtp = extractSentOtp()
    const { rows } = await pool.query<{ otpHash: string }>('SELECT otp_hash as "otpHash" FROM whatsapp_number_verifications WHERE id = $1', [res.body.verificationId])
    expect(rows[0].otpHash).not.toBe(sentOtp)
    expect(rows[0].otpHash.startsWith('$2')).toBe(true) // bcrypt hash prefix
  })

  it('does not change store_settings.whatsapp_number merely by requesting a code', async () => {
    const { agent } = await fullAdminAgent()
    await requestVerification(agent, NEW_NUMBER)
    const { rows } = await pool.query<{ whatsappNumber: string }>('SELECT whatsapp_number as "whatsappNumber" FROM store_settings WHERE id = 1')
    expect(rows[0].whatsappNumber).toBe(ORIGINAL_NUMBER)
  })

  it('enforces a 60-second resend cooldown for the same number', async () => {
    const { agent } = await fullAdminAgent()
    const first = await requestVerification(agent, NEW_NUMBER)
    expect(first.status).toBe(201)
    const second = await requestVerification(agent, NEW_NUMBER)
    expect(second.status).toBe(429)
    expect(second.body.error).toBe('resend_cooldown')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns whatsapp_verification_not_configured when the template env var is missing, without touching the number', async () => {
    const originalTemplate = process.env.WHATSAPP_PHONE_VERIFICATION_TEMPLATE
    delete process.env.WHATSAPP_PHONE_VERIFICATION_TEMPLATE
    vi.resetModules()
    const { app: freshApp } = await import('../app.js')
    const { agent } = await (async () => {
      const a = request.agent(freshApp)
      const email = uniqueEmail('notconfigured')
      const r = await a.post('/api/auth/register').send({ email, password: STRONG_PASSWORD, fullName: 'مسؤول اختبار' })
      await pool.query("UPDATE users SET is_admin = 1, role = 'admin', role_id = NULL WHERE id = $1", [r.body.user.id])
      return { agent: a }
    })()

    const res = await agent.post('/api/admin/settings/whatsapp-number/request-verification').send({ phone: NEW_NUMBER })
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('whatsapp_verification_not_configured')
    expect(fetchMock).not.toHaveBeenCalled()

    process.env.WHATSAPP_PHONE_VERIFICATION_TEMPLATE = originalTemplate
    vi.resetModules()
  })
})

describe('POST /api/admin/settings/whatsapp-number/verify', () => {
  it('changes store_settings.whatsapp_number only after a valid OTP, and writes an audit log', async () => {
    const { agent, userId } = await fullAdminAgent()
    const reqRes = await requestVerification(agent, NEW_NUMBER)
    const otp = extractSentOtp()

    // الرقم القديم لسه نشط قبل التحقق.
    const before = await pool.query<{ whatsappNumber: string }>('SELECT whatsapp_number as "whatsappNumber" FROM store_settings WHERE id = 1')
    expect(before.rows[0].whatsappNumber).toBe(ORIGINAL_NUMBER)

    const verifyRes = await agent.post('/api/admin/settings/whatsapp-number/verify').send({ verificationId: reqRes.body.verificationId, code: otp })
    expect(verifyRes.status).toBe(200)
    expect(verifyRes.body.settings.whatsappNumber).toBe(NEW_NUMBER)

    const after = await pool.query<{ whatsappNumber: string }>('SELECT whatsapp_number as "whatsappNumber" FROM store_settings WHERE id = 1')
    expect(after.rows[0].whatsappNumber).toBe(NEW_NUMBER)

    const { rows: auditRows } = await pool.query(
      `SELECT action FROM audit_logs WHERE admin_user_id = $1 AND action = 'store_whatsapp_number_changed'`,
      [userId]
    )
    expect(auditRows.length).toBeGreaterThan(0)
  })

  it('a wrong OTP does not change the number and increments attempts', async () => {
    const { agent } = await fullAdminAgent()
    const reqRes = await requestVerification(agent, NEW_NUMBER)

    const res = await agent.post('/api/admin/settings/whatsapp-number/verify').send({ verificationId: reqRes.body.verificationId, code: '000000' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_verification_code')

    const { rows } = await pool.query<{ whatsappNumber: string }>('SELECT whatsapp_number as "whatsappNumber" FROM store_settings WHERE id = 1')
    expect(rows[0].whatsappNumber).toBe(ORIGINAL_NUMBER)

    const { rows: verifRows } = await pool.query<{ attempts: number }>('SELECT attempts FROM whatsapp_number_verifications WHERE id = $1', [reqRes.body.verificationId])
    expect(verifRows[0].attempts).toBe(1)
  })

  it('an expired OTP does not change the number', async () => {
    const { agent } = await fullAdminAgent()
    const reqRes = await requestVerification(agent, NEW_NUMBER)
    const otp = extractSentOtp()
    await pool.query("UPDATE whatsapp_number_verifications SET expires_at = now() - interval '1 minute' WHERE id = $1", [reqRes.body.verificationId])

    const res = await agent.post('/api/admin/settings/whatsapp-number/verify').send({ verificationId: reqRes.body.verificationId, code: otp })
    expect(res.status).toBe(410)
    expect(res.body.error).toBe('verification_code_expired')

    const { rows } = await pool.query<{ whatsappNumber: string }>('SELECT whatsapp_number as "whatsappNumber" FROM store_settings WHERE id = 1')
    expect(rows[0].whatsappNumber).toBe(ORIGINAL_NUMBER)
  })

  it('enforces max attempts (5 wrong codes) and rejects a 6th attempt even with the correct code', async () => {
    const { agent } = await fullAdminAgent()
    const reqRes = await requestVerification(agent, NEW_NUMBER)
    const otp = extractSentOtp()

    for (let i = 0; i < 5; i++) {
      const wrong = await agent.post('/api/admin/settings/whatsapp-number/verify').send({ verificationId: reqRes.body.verificationId, code: '111111' })
      expect(wrong.status).toBe(400)
    }

    const exceeded = await agent.post('/api/admin/settings/whatsapp-number/verify').send({ verificationId: reqRes.body.verificationId, code: otp })
    expect(exceeded.status).toBe(429)
    expect(exceeded.body.error).toBe('verification_attempts_exceeded')

    const { rows } = await pool.query<{ whatsappNumber: string }>('SELECT whatsapp_number as "whatsappNumber" FROM store_settings WHERE id = 1')
    expect(rows[0].whatsappNumber).toBe(ORIGINAL_NUMBER)
  })

  it('a verification cannot be reused after a successful verification', async () => {
    const { agent } = await fullAdminAgent()
    const reqRes = await requestVerification(agent, NEW_NUMBER)
    const otp = extractSentOtp()

    const first = await agent.post('/api/admin/settings/whatsapp-number/verify').send({ verificationId: reqRes.body.verificationId, code: otp })
    expect(first.status).toBe(200)

    const second = await agent.post('/api/admin/settings/whatsapp-number/verify').send({ verificationId: reqRes.body.verificationId, code: otp })
    expect(second.status).toBe(404)
    expect(second.body.error).toBe('verification_not_found')
  })

  it('one admin cannot verify another admin\'s pending verification', async () => {
    const { agent: adminA } = await fullAdminAgent('a')
    const { agent: adminB } = await fullAdminAgent('b')
    const reqRes = await requestVerification(adminA, NEW_NUMBER)
    const otp = extractSentOtp()

    const res = await adminB.post('/api/admin/settings/whatsapp-number/verify').send({ verificationId: reqRes.body.verificationId, code: otp })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('verification_not_found')

    const { rows } = await pool.query<{ whatsappNumber: string }>('SELECT whatsapp_number as "whatsappNumber" FROM store_settings WHERE id = 1')
    expect(rows[0].whatsappNumber).toBe(ORIGINAL_NUMBER)
  })

  it('is permission-protected — an admin without settings.manage cannot verify', async () => {
    const { agent: fullAdmin } = await fullAdminAgent()
    const reqRes = await requestVerification(fullAdmin, NEW_NUMBER)
    const otp = extractSentOtp()

    const { agent: picker } = await noSettingsPermissionAgent()
    const res = await picker.post('/api/admin/settings/whatsapp-number/verify').send({ verificationId: reqRes.body.verificationId, code: otp })
    expect(res.status).toBe(403)
  })
})

describe('POST /api/admin/settings/whatsapp-number/cancel', () => {
  it('discards a pending verification — old number stays, and the cancelled code can no longer be used', async () => {
    const { agent } = await fullAdminAgent()
    const reqRes = await requestVerification(agent, NEW_NUMBER)
    const otp = extractSentOtp()

    const cancelRes = await agent.post('/api/admin/settings/whatsapp-number/cancel').send({ verificationId: reqRes.body.verificationId })
    expect(cancelRes.status).toBe(204)

    const verifyRes = await agent.post('/api/admin/settings/whatsapp-number/verify').send({ verificationId: reqRes.body.verificationId, code: otp })
    expect(verifyRes.status).toBe(404)

    const { rows } = await pool.query<{ whatsappNumber: string }>('SELECT whatsapp_number as "whatsappNumber" FROM store_settings WHERE id = 1')
    expect(rows[0].whatsappNumber).toBe(ORIGINAL_NUMBER)
  })
})

describe('PATCH /api/admin/settings cannot bypass OTP verification', () => {
  it('silently ignores (rejects) a different whatsappNumber passed directly, while saving other fields normally', async () => {
    const { agent } = await fullAdminAgent()
    const getRes = await agent.get('/api/admin/settings')
    const currentSettings = getRes.body.settings

    const res = await agent.patch('/api/admin/settings').send({ ...currentSettings, whatsappNumber: NEW_NUMBER, name: 'اسم محدّث اختباراً' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('whatsapp_number_requires_verification')

    const { rows } = await pool.query<{ whatsappNumber: string, name: string }>('SELECT whatsapp_number as "whatsappNumber", name FROM store_settings WHERE id = 1')
    expect(rows[0].whatsappNumber).toBe(ORIGINAL_NUMBER)
  })

  it('still allows saving other settings fields when whatsappNumber is left unchanged', async () => {
    const { agent } = await fullAdminAgent()
    const getRes = await agent.get('/api/admin/settings')
    const currentSettings = getRes.body.settings

    const res = await agent.patch('/api/admin/settings').send({ ...currentSettings, name: 'اسم محدّث فعلاً' })
    expect(res.status).toBe(200)
    expect(res.body.settings.whatsappNumber).toBe(ORIGINAL_NUMBER)
    expect(res.body.settings.name).toBe('اسم محدّث فعلاً')
  })
})
